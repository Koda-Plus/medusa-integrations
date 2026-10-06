/**
 * THE DRAFT ORDER WRITER: an accepted price becomes a Medusa draft order.
 *
 * Off by default, two switches (`lib/writers.ts`): the option
 * `writers.draftOrders` and the toggle a person arms in Settings. Plan
 * first:
 *
 *   1. A thread accepted while the writer is armed is queued (a row in
 *      `negotiation_draft_order`, unique per thread); a person may queue an
 *      older accepted thread from its drawer. Arming the writer never sweeps
 *      the history.
 *   2. The plan (Settings, Writers) shows every queued thread with the exact
 *      input of `createOrderWorkflow`, or why it cannot become a draft. The
 *      dry run returns the same without writing.
 *   3. A run (every 10 minutes while armed, or "Create now") takes at most
 *      `draftOrders.maxPerRun` rows: claim (one process wins), create,
 *      record the draft order id. A failure is kept with Medusa's message
 *      and retried by the job three times, then waits for a person. A
 *      process that died mid-create leaves the row `unknown`: the next run
 *      looks for a draft order with the thread's id in its metadata before
 *      anything else, and adopts it or tries again.
 *
 * Demo mode writes nothing to Medusa: the run "creates" a simulated draft
 * with a number derived from the thread.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { DRAFT_ORDER_MAX_ATTEMPTS, LEASE_MS } from "../../modules/negotiations/lib/constants"
import type { DraftRunResponse, PlanItemDto, RunTrigger, WriterDto } from "../../modules/negotiations/lib/contract"
import { money } from "../../modules/negotiations/lib/dto"
import { buildDraftOrderInput, draftAddress, pickRegion, simulatedDraftOrder, type DraftContext, type DraftOrderInput } from "../../modules/negotiations/lib/draft-order"
import { formatAmount } from "../../modules/negotiations/lib/money"
import type { DraftOrderRow } from "../../modules/negotiations/lib/rows"
import type { Thread } from "../../modules/negotiations/lib/thread"
import { readWriterSetting, writerSettingKey, writerState, WRITERS, type WriterKey, type WriterState } from "../../modules/negotiations/lib/writers"
import { ActionError, envOf, exclusive, graph, newId, normalize, recordRun, resolveOptional, storeDefaults, type Env, type Scope } from "./runtime"

/* ------------------------------------------------------------------ */
/* Switches                                                            */
/* ------------------------------------------------------------------ */

export async function writerStates(scope: Scope, given?: Env): Promise<Record<WriterKey, WriterState>> {
  const env = given ?? (await envOf(scope))
  const keys = WRITERS.map((w) => writerSettingKey(w, env.options.demo))
  const rows = await env.stores.settings.get(keys)
  const out = {} as Record<WriterKey, WriterState>
  for (const w of WRITERS) out[w] = writerState(w, env.options.writers, readWriterSetting(rows.find((r) => r.key === writerSettingKey(w, env.options.demo)) ?? null))
  return out
}

export function toWriterDto(s: WriterState): WriterDto {
  return { key: s.key, allowed: s.allowed, on: s.on, armed: s.armed, updatedBy: s.updatedBy, updatedAt: s.updatedAt }
}

/** Arms or disarms a writer. Refused when the options forbid it. */
export async function setWriter(scope: Scope, writer: WriterKey, on: boolean, actor: string | null): Promise<WriterState> {
  const env = await envOf(scope)
  if (on && !env.options.writers[writer]) {
    throw new ActionError(409, "writer_forbidden", `The ${writer} writer is turned off in the plugin options (writers.${writer}: false).`)
  }
  await env.stores.settings.put(writerSettingKey(writer, env.options.demo), { on }, actor, env.now)
  return (await writerStates(scope, env))[writer]
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

/** After an accept: queues the thread when the writer is armed. Never throws: the accept already happened. */
export async function queueOnAccept(scope: Scope, thread: Thread, actor: string | null): Promise<void> {
  try {
    if (thread.status !== "accepted") return
    const env = await envOf(scope)
    if (!(await writerStates(scope, env)).draftOrders.armed) return
    await env.stores.drafts.queue({ id: newId("negdo"), negotiation_id: thread.id, demo: env.options.demo, requested_by: actor, now: env.now })
  } catch (err) {
    try {
      ;(await envOf(scope)).svc.getLogger().warn(`[negotiations] Could not queue the draft order of ${thread.ref}: ${(err as Error)?.message ?? String(err)}`)
    } catch {
      /* ignore */
    }
  }
}

/**
 * A person asks for the draft order of an accepted thread (older than the
 * writer, or one that failed or was blocked): queued, or set back to
 * pending. The run still needs the writer armed.
 */
export async function queueDraftOrder(scope: Scope, threadId: string, actor: string | null): Promise<DraftOrderRow> {
  const env = await envOf(scope)
  const row = await env.stores.threads.getThread(threadId)
  if (!row || Boolean(row.demo) !== env.options.demo) throw new ActionError(404, "not_found", "Negotiation not found.")
  if (row.status !== "accepted") throw new ActionError(409, "not_accepted", "Only an accepted negotiation becomes a draft order.")
  const queued = await env.stores.drafts.queue({ id: newId("negdo"), negotiation_id: threadId, demo: env.options.demo, requested_by: actor, now: env.now })
  if (queued) return queued
  const [existing] = await env.stores.drafts.byThreads([threadId], env.options.demo)
  if (!existing) throw new ActionError(409, "conflict", "The draft order of this negotiation changed in the meantime.")
  if (existing.state === "failed" || existing.state === "blocked") {
    const back = await env.stores.drafts.transition(existing.id, ["failed", "blocked"], { state: "pending", attempts: 0, error: null, requested_by: actor }, env.now)
    if (back) return back
  }
  return existing
}

/* ------------------------------------------------------------------ */
/* Medusa: create and look up                                          */
/* ------------------------------------------------------------------ */

/** What the writer needs from Medusa. Registered under `DRAFT_CREATOR_KEY` in tests. */
export interface DraftCreator {
  create(input: DraftOrderInput): Promise<{ id: string; displayId: number | null }>
  /** A draft order this writer made for the thread, created after `since`. */
  find(threadId: string, since: Date): Promise<{ id: string; displayId: number | null } | null>
}

export const DRAFT_CREATOR_KEY = "negotiationsDraftCreator"

function medusaCreator(scope: Scope): DraftCreator {
  return {
    async create(input) {
      /* Loaded on use: the core flows are only needed by an armed live writer. */
      const coreFlows = (await import("@medusajs/medusa/core-flows")) as unknown as Record<string, unknown>
      /* The singular name on newer Medusa, the deprecated plural on older 2.x. */
      const flow = (coreFlows.createOrderWorkflow ?? coreFlows.createOrdersWorkflow) as
        | ((container: MedusaContainer) => { run(args: { input: unknown }): Promise<{ result: unknown }> })
        | undefined
      if (typeof flow !== "function") throw new Error("createOrderWorkflow is not available in this Medusa version.")
      const { result } = await flow(scope as MedusaContainer).run({ input })
      const created = result as { id?: string; display_id?: number | string | null }
      if (!created?.id) throw new Error("Medusa created no order.")
      return { id: created.id, displayId: created.display_id === null || created.display_id === undefined ? null : Number(created.display_id) }
    },
    async find(threadId, since) {
      const rows = await graph<{ id: string; display_id?: number | string | null; metadata?: Record<string, unknown> | null }>(scope, {
        entity: "order",
        fields: ["id", "display_id", "metadata", "created_at"],
        filters: { is_draft_order: true, created_at: { $gte: new Date(since.getTime() - 60_000) } },
        pagination: { take: 200, order: { created_at: "DESC" } },
      })
      const hit = rows.find((o) => o.metadata?.negotiation_id === threadId)
      return hit ? { id: hit.id, displayId: hit.display_id === null || hit.display_id === undefined ? null : Number(hit.display_id) } : null
    },
  }
}

function creatorFor(scope: Scope): DraftCreator {
  return resolveOptional<DraftCreator>(scope, DRAFT_CREATOR_KEY) ?? medusaCreator(scope)
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

interface CustomerRecord {
  id: string
  email?: string | null
  addresses?: Array<(Record<string, unknown> & { is_default_shipping?: boolean | null; is_default_billing?: boolean | null }) | null> | null
}

const ADDRESS_FIELDS = ["first_name", "last_name", "company", "address_1", "address_2", "city", "province", "postal_code", "country_code", "phone", "is_default_shipping", "is_default_billing"]

/** Reads regions, customers and variants once per plan, for every queued thread. */
async function contextLoader(scope: Scope, env: Env): Promise<(t: Thread) => Promise<DraftContext>> {
  const regions = await graph<{ id: string; name?: string | null; currency_code?: string | null }>(scope, { entity: "region", fields: ["id", "name", "currency_code"] })
  const salesChannelId = env.options.draftOrders.salesChannelId ?? (await storeDefaults(scope)).salesChannelId
  const customers = new Map<string, CustomerRecord | null>()
  const variants = new Map<string, { id: string; title?: string | null; product?: { title?: string | null } | null } | null>()
  return async (t) => {
    if (t.customerId && !customers.has(t.customerId)) {
      const rows = await graph<CustomerRecord>(scope, { entity: "customer", fields: ["id", "email", ...ADDRESS_FIELDS.map((f) => `addresses.${f}`)], filters: { id: t.customerId } })
      customers.set(t.customerId, rows[0] ?? null)
    }
    if (t.variantId && !variants.has(t.variantId)) {
      const rows = await graph<{ id: string; title?: string | null; product?: { title?: string | null } | null }>(scope, {
        entity: "product_variant",
        fields: ["id", "title", "product.title"],
        filters: { id: t.variantId },
      })
      variants.set(t.variantId, rows[0] ?? null)
    }
    const c = t.customerId ? (customers.get(t.customerId) ?? null) : null
    const addresses = (c?.addresses ?? []).filter((a): a is NonNullable<typeof a> => Boolean(a))
    const v = t.variantId ? (variants.get(t.variantId) ?? null) : null
    return {
      region: pickRegion(regions, t.currencyCode, env.options.draftOrders.regionId),
      salesChannelId,
      customer: c
        ? {
            id: c.id,
            email: c.email ?? null,
            shippingAddress: draftAddress(addresses.find((a) => a.is_default_shipping) ?? null),
            billingAddress: draftAddress(addresses.find((a) => a.is_default_billing) ?? null),
          }
        : null,
      variant: v ? { id: v.id, title: v.title ?? null, productTitle: v.product?.title ?? null } : null,
      taxInclusive: env.options.taxInclusive,
      simulate: env.options.demo,
    }
  }
}

const OPEN_STATES = ["pending", "failed", "blocked", "unknown", "creating"] as const

interface PlanEntry {
  row: DraftOrderRow
  thread: Thread | null
  build: ReturnType<typeof buildDraftOrderInput> | null
  item: PlanItemDto
}

async function planOf(scope: Scope, env: Env): Promise<PlanEntry[]> {
  const rows = await env.stores.drafts.list(env.options.demo, OPEN_STATES, 200)
  const contextFor = await contextLoader(scope, env)
  const out: PlanEntry[] = []
  for (const row of rows) {
    const threadRow = await env.stores.threads.getThread(row.negotiation_id)
    const thread = threadRow && Boolean(threadRow.demo) === env.options.demo ? normalize(env, threadRow) : null
    const ctx = thread ? await contextFor(thread) : null
    const build = thread && ctx ? buildDraftOrderInput(thread, ctx) : null
    const customerName = ctx?.customer?.email ?? thread?.customerId ?? null
    out.push({
      row,
      thread,
      build,
      item: {
        outboxId: row.id,
        thread: {
          id: row.negotiation_id,
          ref: thread?.ref ?? row.negotiation_id,
          customer: customerName,
          title: thread?.title ?? thread?.sku ?? null,
          qty: thread?.qty ?? 0,
          price: thread ? money(thread.agreed ?? thread.price, thread.digits) : null,
          currencyCode: thread?.currencyCode ?? null,
        },
        state: row.state as PlanItemDto["state"],
        ready: Boolean(build?.ok) && (row.state === "pending" || row.state === "failed" || row.state === "blocked"),
        blocked: !thread ? "not_found" : build && !build.ok ? build.reason : null,
        error: row.error ?? null,
        attempts: Number(row.attempts) || 0,
        input: build && build.ok ? (build.input as unknown as Record<string, unknown>) : null,
      },
    })
  }
  return out
}

export async function draftPlan(scope: Scope): Promise<{ writer: WriterDto; items: PlanItemDto[] }> {
  const env = await envOf(scope)
  const writer = (await writerStates(scope, env)).draftOrders
  return { writer: toWriterDto(writer), items: (await planOf(scope, env)).map((p) => p.item) }
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

function clip(text: string, max = 500): string {
  const s = text.replace(/\s+/g, " ").trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

async function recordOnThread(env: Env, thread: Thread, body: string): Promise<void> {
  try {
    await env.stores.threads.act({
      id: thread.id,
      demo: env.options.demo,
      from: ["accepted"],
      patch: {},
      countMessage: false,
      message: {
        id: newId("negmsg"),
        negotiation_id: thread.id,
        author_type: "system",
        author_id: null,
        kind: "draft_order",
        body,
        amount: null,
        internal: true,
        metadata: null,
        created_at: env.now,
      },
      now: env.now,
    })
  } catch {
    /* the record on the thread is a courtesy; the outbox row holds the truth */
  }
}

function draftLabel(displayId: number | null, id: string): string {
  return displayId !== null ? `#${displayId}` : id
}

export async function runDraftOrders(scope: Scope, opts: { dryRun: boolean; trigger: RunTrigger }): Promise<DraftRunResponse> {
  const env = await envOf(scope)
  const writer = (await writerStates(scope, env)).draftOrders
  if (opts.dryRun) return { dryRun: true, items: (await planOf(scope, env)).map((p) => p.item), run: null }
  if (!writer.armed) {
    throw new ActionError(409, "writer_off", writer.allowed ? "Arm the draft order writer in Settings first." : "The draft order writer is turned off in the plugin options.")
  }
  const done = await exclusive("draft-orders", async () => {
    const started = new Date()
    const counts = { created: 0, adopted: 0, failed: 0, blocked: 0, retried: 0 }
    const creator = creatorFor(scope)
    const demo = env.options.demo

    /* A process that died mid-create: its rows are looked up first. */
    await env.stores.drafts.expireLeases(env.now, demo)
    for (const p of await planOf(scope, env)) {
      if (p.row.state !== "unknown" || !p.thread) continue
      const since = p.row.claimed_at ? new Date(p.row.claimed_at as string) : new Date(p.row.created_at as string)
      const found = demo ? simulatedDraftOrder(p.thread.id) : await creator.find(p.thread.id, since)
      if (found) {
        const moved = await env.stores.drafts.transition(p.row.id, ["unknown"], { state: "created", draft_order_id: found.id, display_id: found.displayId, error: null }, env.now)
        if (moved) {
          counts.adopted += 1
          await recordOnThread(env, p.thread, `Draft order ${draftLabel(found.displayId, found.id)} found after an interrupted run.`)
        }
      } else {
        await env.stores.drafts.transition(p.row.id, ["unknown"], { state: "failed", error: "No draft order found after an interrupted run; it is created again." }, env.now)
        counts.retried += 1
      }
    }

    let budget = env.options.draftOrders.maxPerRun
    for (const p of await planOf(scope, env)) {
      if (budget <= 0) break
      if (!p.thread || !["pending", "failed", "blocked"].includes(p.row.state)) continue
      if (p.row.state === "failed" && opts.trigger === "schedule" && (Number(p.row.attempts) || 0) >= DRAFT_ORDER_MAX_ATTEMPTS) continue
      const build = p.build
      if (!build) continue
      if (!build.ok) {
        if (p.row.state !== "blocked" || p.row.error !== build.reason) {
          await env.stores.drafts.transition(p.row.id, ["pending", "failed", "blocked"], { state: "blocked", error: build.reason }, env.now)
        }
        counts.blocked += 1
        continue
      }
      if (p.row.state === "blocked") {
        if (!(await env.stores.drafts.transition(p.row.id, ["blocked"], { state: "pending", error: null }, env.now))) continue
      }
      const token = newId("claim")
      const claimed = await env.stores.drafts.claim(p.row.id, { now: env.now, leaseUntil: new Date(env.now.getTime() + LEASE_MS), token })
      if (!claimed) continue
      budget -= 1
      try {
        const created = demo ? simulatedDraftOrder(p.thread.id) : await creator.create(build.input)
        await env.stores.drafts.finish(p.row.id, token, { state: "created", draft_order_id: created.id, display_id: created.displayId, error: null, payload: build.input }, new Date())
        counts.created += 1
        const price = p.thread.agreed ?? p.thread.price
        await recordOnThread(
          env,
          p.thread,
          `Draft order ${draftLabel(created.displayId, created.id)} created${demo ? " (simulated)" : ""}: ${p.thread.qty} x ${price === null ? "" : formatAmount(price, p.thread.digits)} ${String(p.thread.currencyCode ?? "").toUpperCase()}.`,
        )
      } catch (err) {
        await env.stores.drafts.finish(p.row.id, token, { state: "failed", error: clip((err as Error)?.message ?? String(err)), payload: build.input }, new Date())
        counts.failed += 1
      }
    }
    return recordRun(scope, demo, {
      kind: "draft_orders",
      trigger: opts.trigger,
      status: counts.failed > 0 ? (counts.created + counts.adopted > 0 ? "partial" : "error") : "ok",
      startedAt: started,
      counts,
    })
  })
  return { dryRun: false, items: (await planOf(scope, env)).map((p) => p.item), run: done }
}
