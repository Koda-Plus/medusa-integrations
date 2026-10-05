/**
 * ONE RUN OF ONE WRITER: a dry run (what would be sent, nothing goes out) or
 * an applied run (look, write once, record the answer).
 *
 * BEFORE ANYTHING IS APPLIED:
 *   both switches on (option and admin toggle), and in live mode a connected
 *   account whose token carries the `write` scope; OLX is not blocking our IP;
 *   the lifecycle plan was made from complete reads and is not held by the
 *   mass guard (a person may override the guard for one manual run).
 *
 * THEN, IN THIS ORDER: expired leases become `unknown`, unknown rows are read
 * on OLX and settled, and at most `cap` due rows are applied through
 * `lib/apply.ts`. Live writes go through the client with exactly this writer
 * in the barrier's allow list; demo writes go to the simulated account.
 */

import { generateEntityId } from "@medusajs/framework/utils"
import { randomBytes } from "node:crypto"
import type OlxModuleService from "../../modules/olx/service"
import {
  applyLifecycle,
  applyPrices,
  emptyReport,
  publishOnce,
  reconcileLifecycle,
  reconcilePrices,
  reconcilePublications,
  type AdvertSnapshot,
  type ApplyReport,
  type FoundAdvert,
  type PlanItem,
  type PublicationItem,
} from "../../modules/olx/lib/apply"
import { ipBlockedUntil } from "../../modules/olx/lib/block"
import { getConnectionRow, isConnected } from "../../modules/olx/lib/connection"
import { QUARANTINE_AFTER, WRITER_RUNS_TO_KEEP, olxUrls, type WriterKey } from "../../modules/olx/lib/constants"
import type { OlxWriterRunDto } from "../../modules/olx/lib/contract"
import { createDemoTransport, type DemoAdvertState } from "../../modules/olx/lib/demo-transport"
import { toWriterRunDto, type AdvertRow, type PlanItemRow, type PublicationRow, type WriterRunRow } from "../../modules/olx/lib/dto"
import {
  createAdvert,
  findAdvertsByExternalId,
  readAdvert,
  sendAdvertCommand,
  updateAdvert,
} from "../../modules/olx/lib/partner-api"
import { hasWriteScope } from "../../modules/olx/lib/security"
import { createPlanItemStore, createPublicationStore, PUBLICATION_CLAIMABLE } from "../../modules/olx/lib/store"
import { dueItems, toggleKey, writerSwitchState, type WriterToggle } from "../../modules/olx/lib/writers"
import { planStateKey, runOlxPlan, type StoredPlanSummary } from "./plan"
import { chunks, errorText, getState, olxServiceOf, sqlOf, withLock, isLocked, type Scope } from "./runtime"

export type WriterTrigger = "schedule" | "manual" | "auto"

export interface WriterRunInput {
  writer: WriterKey
  dryRun?: boolean
  trigger?: WriterTrigger
  /** Who started a manual run (admin user e-mail). */
  actor?: string | null
  /** Run the lifecycle plan although the mass guard holds it (manual runs only). */
  overrideGuard?: boolean
}

export function isWriterRunning(writer: WriterKey): boolean {
  return isLocked(`writer:${writer}`)
}

/* ------------------------------------------------------------------ */
/* Switch state                                                        */
/* ------------------------------------------------------------------ */

export async function writerSwitch(svc: OlxModuleService, writer: WriterKey) {
  const o = svc.getOptions()
  const toggle = await getState<WriterToggle>(svc, toggleKey(writer, o.demo))
  let connected = false
  let writeScope = false
  if (!o.demo && svc.isConfigured()) {
    const row = await getConnectionRow(svc)
    connected = Boolean(row?.refresh_token_enc)
    writeScope = hasWriteScope(row?.scope)
  }
  return {
    toggle,
    connected,
    writeScope,
    state: writerSwitchState({ allowedByConfig: o.writers[writer], toggle, demo: o.demo, connected, writeScope }),
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot updates after a write                                      */
/* ------------------------------------------------------------------ */

async function patchSnapshot(svc: OlxModuleService, demo: boolean, olxId: string, snap: AdvertSnapshot): Promise<void> {
  const rows = (await svc.listOlxAdverts({ olx_id: olxId, demo } as never, { take: 1 })) as unknown as AdvertRow[]
  const row = rows[0]
  if (!row) return
  const patch: Record<string, unknown> = {}
  if (snap.status && snap.status !== row.status) patch.status = snap.status
  if (snap.price && JSON.stringify({ value: Number(row.price?.value), currency: row.price?.currency }) !== JSON.stringify(snap.price)) {
    patch.price = { value: snap.price.value, currency: snap.price.currency }
  }
  if (Object.keys(patch).length > 0) await svc.updateOlxAdverts({ id: row.id, ...patch } as never)
}

async function addPublishedToSnapshot(svc: OlxModuleService, demo: boolean, item: PublicationItem, advert: FoundAdvert): Promise<void> {
  const existing = (await svc.listOlxAdverts({ olx_id: advert.olxId } as never, { take: 1, select: ["id"] })) as unknown as Array<{ id: string }>
  if (existing.length > 0) return
  const pub = (await svc.listOlxPublications({ id: item.id } as never, { take: 1 })) as unknown as PublicationRow[]
  const p = pub[0]
  const payload = p?.payload && typeof p.payload === "object" ? (p.payload as Record<string, unknown>) : {}
  const price = payload.price && typeof payload.price === "object" ? (payload.price as Record<string, unknown>) : null
  await svc.createOlxAdverts({
    olx_id: advert.olxId,
    title: p?.title ?? item.sku,
    url: advert.url ?? "",
    status: advert.status ?? "new",
    external_id: item.sku,
    description_sku: null,
    match_key: item.sku.trim().toUpperCase(),
    match_source: "external_id",
    variant_id: item.variant_id,
    product_id: p?.product_id ?? null,
    sku: item.sku,
    product_title: p?.title ?? null,
    is_primary: true,
    price: price && Number.isFinite(Number(price.value)) ? { value: Number(price.value), currency: String(price.currency ?? "") } : null,
    category_id: p?.olx_category_id ?? null,
    olx_created_at: new Date(),
    demo,
  } as never)
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

function describe(writer: WriterKey, row: Record<string, any>): string {
  if (writer === "publish") return `POST /adverts external_id=${row.sku}`
  if (writer === "price") {
    const to = row.to_value as { value?: number; currency?: string } | null
    return `PUT /adverts/${row.olx_id} price=${to?.value ?? "?"} ${to?.currency ?? ""}`.trim()
  }
  return `POST /adverts/${row.olx_id}/commands ${row.action}`
}

async function record(
  svc: OlxModuleService,
  args: {
    writer: WriterKey
    mode: "dry_run" | "apply"
    trigger: WriterTrigger
    status: OlxWriterRunDto["status"]
    planned: number
    report: ApplyReport
    message: string | null
    actor: string | null
    startedAt: Date
    demo: boolean
  },
): Promise<OlxWriterRunDto> {
  const finishedAt = new Date()
  const r = args.report
  const row = (await svc.createOlxWriterRuns({
    writer: args.writer,
    mode: args.mode,
    trigger: args.trigger,
    status: args.status,
    planned: args.planned,
    attempted: r.attempted,
    succeeded: r.succeeded,
    failed: r.failed,
    quarantined: r.quarantined,
    unknown: r.unknown,
    skipped: r.skipped,
    message: args.message,
    items: r.items.slice(0, 50).map((i) => ({ action: i.action, olxId: i.olxId, variantId: i.variantId, outcome: i.outcome, detail: i.detail })),
    actor: args.actor,
    duration_ms: finishedAt.getTime() - args.startedAt.getTime(),
    started_at: args.startedAt,
    finished_at: finishedAt,
    demo: args.demo,
  } as never)) as unknown as WriterRunRow
  const old = (await svc.listOlxWriterRuns({ writer: args.writer } as never, {
    order: { started_at: "DESC" },
    skip: WRITER_RUNS_TO_KEEP,
    take: 200,
    select: ["id"],
  })) as unknown as Array<{ id: string }>
  for (const part of chunks(old.map((o) => o.id), 200)) await svc.deleteOlxWriterRuns(part)
  return toWriterRunDto(row)
}

function merge(a: ApplyReport, b: ApplyReport): ApplyReport {
  return {
    attempted: a.attempted + b.attempted,
    succeeded: a.succeeded + b.succeeded,
    failed: a.failed + b.failed,
    quarantined: a.quarantined + b.quarantined,
    unknown: a.unknown + b.unknown,
    skipped: a.skipped + b.skipped,
    busy: a.busy + b.busy,
    stoppedBy: a.stoppedBy ?? b.stoppedBy,
    items: [...a.items, ...b.items],
  }
}

export async function runOlxWriter(scope: Scope, input: WriterRunInput): Promise<OlxWriterRunDto | null> {
  const svc = olxServiceOf(scope)
  const o = svc.getOptions()
  const demo = o.demo
  const writer = input.writer
  const trigger: WriterTrigger = input.trigger ?? "manual"
  const dryRun = input.dryRun === true
  const actor = input.actor ?? null
  const manual = trigger === "manual"

  if (manual) await runOlxPlan(scope, { trigger: "auto" })

  const result = await withLock(`writer:${writer}`, async (): Promise<OlxWriterRunDto | null> => {
    const startedAt = new Date()
    const base = { writer, trigger, actor, startedAt, demo }
    const sw = await writerSwitch(svc, writer)
    const summary = await getState<StoredPlanSummary>(svc, planStateKey(demo))

    if (!dryRun) {
      if (!sw.state.active) {
        return manual
          ? record(svc, { ...base, mode: "apply", status: "skipped", planned: 0, report: emptyReport(), message: `blocked:${sw.state.blockers.join(",")}` })
          : null
      }
      const blocked = ipBlockedUntil(Date.now())
      if (blocked && !demo) {
        return manual
          ? record(svc, { ...base, mode: "apply", status: "skipped", planned: 0, report: emptyReport(), message: `ip_blocked:${new Date(blocked).toISOString()}` })
          : null
      }
    }

    const sql = sqlOf(scope)
    const now = () => new Date()
    const newToken = () => randomBytes(16).toString("hex")
    const mask = (t: string) => svc.mask(t)
    const cap = o.caps[writer]

    /* ---- publish -------------------------------------------------- */
    if (writer === "publish") {
      const store = createPublicationStore(sql, () => generateEntityId(undefined, "olxpub"))
      if (!dryRun) await store.expireLeases(new Date(), demo)
      const rows = (await svc.listOlxPublications({ demo } as never, { take: null, order: { planned_at: "ASC" } })) as unknown as PublicationRow[]
      const unknown = rows.filter((r) => r.state === "unknown")
      const due = rows.filter((r) => PUBLICATION_CLAIMABLE.includes(r.state) && r.attempts < QUARANTINE_AFTER).slice(0, cap)
      if (dryRun) {
        const report = emptyReport()
        for (const r of unknown) report.items.push({ id: r.id, olxId: r.olx_id, variantId: r.variant_id, action: "lookup", outcome: "unknown", detail: `GET /adverts?external_id=${r.sku}` })
        for (const r of due) report.items.push({ id: r.id, olxId: null, variantId: r.variant_id, action: "publish", outcome: "planned", detail: describe(writer, r) })
        return record(svc, { ...base, mode: "dry_run", status: "ok", planned: due.length, report, message: null })
      }
      if (unknown.length === 0 && due.length === 0 && !manual) return null
      const snapshot = demo ? await demoSeed(svc) : []
      const demoTransport = demo ? createDemoTransport(snapshot, { market: o.market, host: olxUrls(o.market).host, now }) : null
      const deps = {
        store,
        now,
        newToken,
        mask,
        sleep: demo ? undefined : (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
        rescanDelayMs: 5000,
        transport: demoTransport ?? {
          findByExternalId: (ext: string) => findAdvertsByExternalId(svc, ext),
          create: (payload: Record<string, unknown>) => createAdvert(svc, payload, ["publish"]),
        },
        onPublished: (item: PublicationItem, advert: FoundAdvert) => addPublishedToSnapshot(svc, demo, item, advert),
      }
      const settled = await reconcilePublications(unknown as unknown as PublicationItem[], deps)
      const fresh = (await svc.listOlxPublications({ demo } as never, { take: null, order: { planned_at: "ASC" } })) as unknown as PublicationRow[]
      const settledIds = new Set(settled.items.map((i) => i.id))
      const nextDue = fresh.filter((r) => PUBLICATION_CLAIMABLE.includes(r.state) && r.attempts < QUARANTINE_AFTER && !settledIds.has(r.id)).slice(0, cap)
      const report = merge(settled, await publishOnce(nextDue as unknown as PublicationItem[], deps))
      const run = await record(svc, {
        ...base,
        mode: "apply",
        status: report.stoppedBy || report.failed + report.quarantined + report.unknown > 0 ? "partial" : "ok",
        planned: nextDue.length,
        report,
        message: report.stoppedBy ? `stopped:${report.stoppedBy}` : null,
      })
      if (report.succeeded > 0) await runOlxPlan(scope, { trigger: "auto" })
      return run
    }

    /* ---- lifecycle and prices -------------------------------------- */
    const store = createPlanItemStore(sql)
    if (!dryRun) await store.expireLeases(new Date(), demo)
    const rows = (await svc.listOlxPlanItems({ writer, demo } as never, { take: null })) as unknown as PlanItemRow[]
    const unknown = rows.filter((r) => r.state === "unknown")
    let holdEndings = false
    let heldMessage: string | null = null
    if (writer === "lifecycle") {
      if (summary?.lifecycleSkipped) {
        const message = `plan_skipped:${summary.lifecycleSkipped}`
        if (dryRun || manual) return record(svc, { ...base, mode: dryRun ? "dry_run" : "apply", status: "skipped", planned: 0, report: emptyReport(), message })
        return null
      }
      if (summary?.guard?.held && !(input.overrideGuard && manual)) {
        holdEndings = true
        heldMessage = `guard:${summary.guard.endings}/${summary.guard.liveLinked}`
      }
    }
    const due = dueItems(rows, cap, { holdEndings })
    if (dryRun) {
      const report = emptyReport()
      for (const r of unknown) report.items.push({ id: r.id, olxId: r.olx_id, variantId: r.variant_id, action: "lookup", outcome: "unknown", detail: `GET /adverts/${r.olx_id}` })
      for (const r of due) report.items.push({ id: r.id, olxId: r.olx_id, variantId: r.variant_id, action: r.action, outcome: "planned", detail: describe(writer, r) })
      return record(svc, { ...base, mode: "dry_run", status: holdEndings ? "held" : "ok", planned: due.length, report, message: heldMessage })
    }
    if (unknown.length === 0 && due.length === 0 && !manual) return null

    const snapshot = demo ? await demoSeed(svc) : []
    const demoTransport = demo ? createDemoTransport(snapshot, { market: o.market, host: olxUrls(o.market).host, now }) : null
    const onAdvert = (olxId: string, snap: AdvertSnapshot) => patchSnapshot(svc, demo, olxId, snap)
    let report: ApplyReport
    if (writer === "lifecycle") {
      const deps = {
        store,
        now,
        newToken,
        mask,
        isSuccess: o.deactivateAsSold,
        onAdvert,
        transport: demoTransport ?? {
          read: (id: string) => readAdvert(svc, id),
          command: (id: string, command: "activate" | "deactivate" | "finish", isSuccess: boolean) =>
            sendAdvertCommand(svc, id, command, isSuccess, ["lifecycle"]),
        },
      }
      const settled = await reconcileLifecycle(unknown as unknown as PlanItem[], deps)
      const fresh = (await svc.listOlxPlanItems({ writer, demo } as never, { take: null })) as unknown as PlanItemRow[]
      const settledIds = new Set(settled.items.map((i) => i.id))
      const nextDue = dueItems(fresh.filter((r) => !settledIds.has(r.id)), cap, { holdEndings })
      report = merge(settled, await applyLifecycle(nextDue as unknown as PlanItem[], deps))
    } else {
      const deps = {
        store,
        now,
        newToken,
        mask,
        onAdvert,
        transport: demoTransport ?? {
          read: (id: string) => readAdvert(svc, id),
          put: (id: string, body: Record<string, unknown>) => updateAdvert(svc, id, body, ["price"]),
        },
      }
      const settled = await reconcilePrices(unknown as unknown as PlanItem[], deps)
      const fresh = (await svc.listOlxPlanItems({ writer, demo } as never, { take: null })) as unknown as PlanItemRow[]
      const settledIds = new Set(settled.items.map((i) => i.id))
      const nextDue = dueItems(fresh.filter((r) => !settledIds.has(r.id)), cap)
      report = merge(settled, await applyPrices(nextDue as unknown as PlanItem[], deps))
    }
    const failures = report.failed + report.quarantined + report.unknown
    const status: OlxWriterRunDto["status"] = report.stoppedBy || failures > 0 ? "partial" : holdEndings && report.attempted === 0 ? "held" : "ok"
    const run = await record(svc, {
      ...base,
      mode: "apply",
      status,
      planned: due.length,
      report,
      message: report.stoppedBy ? `stopped:${report.stoppedBy}` : heldMessage,
    })
    if (report.succeeded > 0) await runOlxPlan(scope, { trigger: "auto" })
    return run
  })
  return result
}

/** The simulated account as the snapshot shows it, for the demo transport. */
async function demoSeed(svc: OlxModuleService): Promise<DemoAdvertState[]> {
  const rows = (await svc.listOlxAdverts({ demo: true } as never, { take: null })) as unknown as AdvertRow[]
  return rows.map((r) => ({
    olxId: r.olx_id,
    status: r.status,
    price: r.price ? { value: Number(r.price.value), currency: String(r.price.currency).toUpperCase() } : null,
    /* Like `GET /adverts?external_id=`: only the field itself, never a SKU found in the description. */
    externalId: r.external_id,
    title: r.title,
    url: r.url,
  }))
}

/** Whether a writer may run on its own now (used by the scheduled cycle). */
export async function writerIsActive(svc: OlxModuleService, writer: WriterKey): Promise<boolean> {
  if (!svc.isDemo() && !(await isConnected(svc))) return false
  return (await writerSwitch(svc, writer)).state.active
}

export function writerError(svc: OlxModuleService, err: unknown): string {
  return errorText(svc, err)
}
