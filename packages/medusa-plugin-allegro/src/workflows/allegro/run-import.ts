/**
 * THE ORDER IMPORT: Allegro checkout forms into Medusa orders, exactly once.
 *
 *   drain     the order event journal (`GET /order/events?from=`) becomes one
 *             row per checkout form in `allegro_order_import`; the cursor
 *             moves only after the rows are written, to the last event of
 *             the page (event ids are opaque, never compared). A fresh
 *             install starts at the newest event: history comes in through
 *             the catch-up import, deliberately.
 *   process   every due row is claimed atomically, looked up in Medusa
 *             (`metadata.marketplace_order_ref`), read fresh from Allegro and
 *             mapped (`lib/import.ts`); then, holding the shared lock
 *             `marketplace-order-ref:allegro:<id>` and after a second
 *             lookup, created as a draft, placed (reservations,
 *             `order.placed`) and paid (`import-order.ts`), or held with
 *             the reason. A demo order is never placed or paid.
 *   cancel    a cancellation on Allegro cancels the Medusa order only when
 *             nothing was fulfilled; otherwise the row asks for a person.
 *   refresh   a status change on Allegro updates the row.
 *
 * The orders writer must be armed for any of it to run: disarmed, the
 * journal is not read at all, the cursor holds, nothing is skipped.
 */

import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import * as coreFlows from "@medusajs/medusa/core-flows"
import type AllegroModuleService from "../../modules/allegro/service"
import { getCheckoutForm, getCheckoutFormsByPurchase, getOrderEvents, getOrderEventStats } from "../../modules/allegro/lib/api"
import { checkoutFormFromApi, type CheckoutForm } from "../../modules/allegro/lib/checkout"
import { isConnected } from "../../modules/allegro/lib/connection"
import {
  DEMO_SALES_CHANNEL,
  EVENTS_PAGE_SIZE,
  EVENT_RETENTION_DAYS,
  IMPORT_LEASE_MS,
  REF_LOCK_SECONDS,
  MAX_EVENT_PAGES,
  ORDERS_PAGE_SIZE,
  WINDOW_MAX_DAYS,
  WINDOW_MAX_FORMS,
  marketplaceRef,
  refLockKey,
} from "../../modules/allegro/lib/constants"
import type { AllegroImportRunResponse, AllegroImportWindowResponse, AllegroRunDto } from "../../modules/allegro/lib/contract"
import { dayStart, demoEventId, demoEventsAfter, demoSeedsUntil } from "../../modules/allegro/lib/demo-stream"
import type { ImportRow as ImportRowDb } from "../../modules/allegro/lib/dto"
import { cursorExpired, drainJournal, eventsAfter, eventsFromApi, intentsByForm, latestEventId, type OrderEvent } from "../../modules/allegro/lib/events"
import {
  buyerChange,
  cancelDecision,
  drainAction,
  importDetails,
  planImport,
  processImport,
  type ImportContext,
  type ImportDecision,
  type ImportOutcome,
  type ImportPorts,
  type LineVariant,
} from "../../modules/allegro/lib/import"
import { normalizeKey } from "../../modules/allegro/lib/matching"
import { emitAllegroEvent } from "../../modules/allegro/lib/notify"
import { planReservations } from "../../modules/allegro/lib/reservations"
import { ordersByRef, type ImportStore } from "../../modules/allegro/lib/store"
import { channelLocationIds, loadCatalog, loadVariantInventory, type QueryLike } from "./catalog"
import { demoFormFromStream, demoStream, type DemoStream } from "./demo-sim"
import { cancelDemoOrder, completeAllegroOrder, createAllegroDraft } from "./import-order"
import { allegroOf, errorText, exclusive, getState, importStoreOf, queryOf, recordRun, requireSql, setState } from "./runtime"
import { armedWriters, recordOutcome, touchWriterRun } from "./writers"

/** The event cursor, one per mode: a demo cursor must never steer a real account connected later. */
export const cursorId = (demo: boolean): string => (demo ? "order_events_cursor:demo" : "order_events_cursor")
const CURSOR_ID = cursorId(false)
const DEMO_CURSOR_ID = cursorId(true)
const DAY_MS = 24 * 60 * 60 * 1000

interface Cursor {
  id: string
  /** When the event at the cursor happened (Allegro keeps 60 days). */
  at: string | null
  updatedAt: string
  note?: string | null
}

export interface ImportRunInput {
  trigger?: "schedule" | "manual" | "auto" | "event"
  /** plan: a dry run that previews the waiting forms; apply / auto: drain and import (only when armed). */
  mode?: "plan" | "apply" | "auto"
}

export interface ImportRunResult {
  skipped: null | "running" | "not_configured" | "not_connected" | "not_armed"
  preview: AllegroImportRunResponse["preview"]
  counts: Record<string, number>
  message: string | null
  run: AllegroRunDto | null
}

/* ------------------------------------------------------------------ */
/* Where imported orders land                                          */
/* ------------------------------------------------------------------ */

interface Target {
  regionId: string | null
  currency: string | null
  regionName: string | null
  salesChannelId: string | null
  salesChannelName: string | null
  /** English sentences, for hold reasons and the API. */
  warnings: string[]
  /** The same, as codes the admin translates. */
  notes: TargetNote[]
}

export type TargetNoteCode = "region_missing" | "no_region" | "channel_missing" | "demo_channel" | "default_channel" | "no_channel" | "no_shipping"
export type TargetNote = { code: TargetNoteCode; value?: string }

async function firstRegionIn(query: QueryLike, currency: string): Promise<{ id: string; name: string | null; currency: string } | null> {
  const { data } = await query.graph({ entity: "region", fields: ["id", "name", "currency_code"], pagination: { take: 100 } })
  const hit = (data as Array<{ id: string; name?: string | null; currency_code?: string | null }>).find(
    (r) => String(r.currency_code ?? "").toLowerCase() === currency.toLowerCase(),
  )
  return hit ? { id: hit.id, name: hit.name ?? null, currency: String(hit.currency_code).toLowerCase() } : null
}

/**
 * The demo sales channel "Allegro (demo)", created on first use and linked
 * to the stock locations of the store's default channel, so the stock check
 * of a simulated order sees the store's stock. Nothing is reserved: demo
 * orders are never placed (`import-order.ts`).
 */
async function ensureDemoChannel(container: MedusaContainer, query: QueryLike): Promise<{ id: string; name: string } | null> {
  const { data } = await query.graph({ entity: "sales_channel", fields: ["id", "name"], filters: { name: DEMO_SALES_CHANNEL } })
  const found = (data as Array<{ id: string; name: string }>)[0]
  if (found) return found
  const { result } = await coreFlows.createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: DEMO_SALES_CHANNEL, description: "Simulated Allegro orders of the demo (Allegro by Koda Plus)." }] },
  })
  const channel = (result as Array<{ id: string; name: string }>)[0]
  if (!channel) return null
  const { data: stores } = await query.graph({ entity: "store", fields: ["id", "default_sales_channel_id"], pagination: { take: 1 } })
  const defaultChannel = (stores as Array<{ default_sales_channel_id?: string | null }>)[0]?.default_sales_channel_id ?? null
  let locations = defaultChannel ? await channelLocationIds(query, defaultChannel) : []
  if (locations.length === 0) {
    const { data: all } = await query.graph({ entity: "stock_location", fields: ["id"], pagination: { take: 20 } })
    locations = (all as Array<{ id: string }>).map((l) => l.id)
  }
  for (const id of locations) {
    await coreFlows.linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id, add: [channel.id] } })
  }
  return channel
}

export async function resolveTarget(container: MedusaContainer, svc: AllegroModuleService, currency = "pln", create = false): Promise<Target> {
  const o = svc.getOptions()
  const query = queryOf(container)
  const warnings: string[] = []
  const notes: TargetNote[] = []
  const warn = (code: TargetNoteCode, text: string, value?: string) => {
    warnings.push(text)
    notes.push(value === undefined ? { code } : { code, value })
  }
  let regionId: string | null = null
  let regionName: string | null = null
  let regionCurrency: string | null = null
  if (o.orderImport.regionId) {
    const { data } = await query.graph({ entity: "region", fields: ["id", "name", "currency_code"], filters: { id: o.orderImport.regionId } })
    const r = (data as Array<{ id: string; name?: string | null; currency_code?: string | null }>)[0]
    if (r) {
      regionId = r.id
      regionName = r.name ?? null
      regionCurrency = String(r.currency_code ?? "").toLowerCase()
    } else warn("region_missing", `orderImport.regionId ${o.orderImport.regionId} does not exist.`, o.orderImport.regionId)
  } else {
    const r = await firstRegionIn(query, currency)
    if (r) {
      regionId = r.id
      regionName = r.name
      regionCurrency = r.currency
    } else warn("no_region", `No region in ${currency.toUpperCase()}. Create one or set orderImport.regionId.`, currency.toUpperCase())
  }

  let salesChannelId: string | null = null
  let salesChannelName: string | null = null
  if (o.orderImport.salesChannelId) {
    const { data } = await query.graph({ entity: "sales_channel", fields: ["id", "name"], filters: { id: o.orderImport.salesChannelId } })
    const c = (data as Array<{ id: string; name: string }>)[0]
    if (c) {
      salesChannelId = c.id
      salesChannelName = c.name
    } else warn("channel_missing", `orderImport.salesChannelId ${o.orderImport.salesChannelId} does not exist.`, o.orderImport.salesChannelId)
  } else if (o.demo) {
    const { data } = await query.graph({ entity: "sales_channel", fields: ["id", "name"], filters: { name: DEMO_SALES_CHANNEL } })
    const c = (data as Array<{ id: string; name: string }>)[0] ?? (create ? await ensureDemoChannel(container, query) : null)
    if (c) {
      salesChannelId = c.id
      salesChannelName = c.name
    } else if (!create) {
      salesChannelName = DEMO_SALES_CHANNEL
      warn("demo_channel", `The "${DEMO_SALES_CHANNEL}" sales channel is created on the first import.`, DEMO_SALES_CHANNEL)
    }
  } else {
    const { data } = await query.graph({ entity: "sales_channel", fields: ["id", "name"], pagination: { take: 100 } })
    const channels = data as Array<{ id: string; name: string }>
    const allegro = channels.find((c) => c.name.trim().toLowerCase() === "allegro")
    if (allegro) {
      salesChannelId = allegro.id
      salesChannelName = allegro.name
    } else {
      const { data: stores } = await query.graph({ entity: "store", fields: ["id", "default_sales_channel_id"], pagination: { take: 1 } })
      const def = (stores as Array<{ default_sales_channel_id?: string | null }>)[0]?.default_sales_channel_id ?? null
      const c = channels.find((x) => x.id === def)
      if (c) {
        salesChannelId = c.id
        salesChannelName = c.name
        warn("default_channel", `Allegro orders go to the default sales channel "${c.name}". Create a channel named "Allegro" (or set orderImport.salesChannelId) to keep them apart.`, c.name)
      } else warn("no_channel", "No sales channel for Allegro orders. Set orderImport.salesChannelId.")
    }
  }
  if (!o.orderImport.shippingOptionId && Object.keys(o.orderImport.shippingOptions).length === 0) {
    warn("no_shipping", "No shipping option is put on imported orders: pick one in the Medusa fulfillment form, or set orderImport.shippingOptionId.")
  }
  return { regionId, currency: regionCurrency, regionName, salesChannelId, salesChannelName, warnings, notes }
}

/** The variant maps: offer links from the snapshot first, SKUs of the whole catalog second. */
async function lineMaps(svc: AllegroModuleService, query: QueryLike, demo: boolean): Promise<{ byOffer: Map<string, LineVariant>; bySku: Map<string, LineVariant> }> {
  const offers = (await svc.listAllegroOffers({ demo, variant_id: { $ne: null } } as never, {
    take: null,
    select: ["allegro_id", "variant_id", "product_id", "sku", "product_title"],
  })) as unknown as Array<{ allegro_id: string; variant_id: string; product_id: string; sku: string; product_title: string | null }>
  const byOffer = new Map<string, LineVariant>(offers.map((o) => [o.allegro_id, { id: o.variant_id, productId: o.product_id, sku: o.sku, productTitle: o.product_title }]))
  const bySku = new Map<string, LineVariant>()
  for (const v of await loadCatalog(query, [])) {
    const k = normalizeKey(v.sku)
    if (k && !bySku.has(k)) bySku.set(k, { id: v.id, productId: v.productId, sku: v.sku, productTitle: v.productTitle })
  }
  return { byOffer, bySku }
}

/* ------------------------------------------------------------------ */
/* Drain                                                               */
/* ------------------------------------------------------------------ */

async function applyIntents(
  svc: AllegroModuleService,
  store: ImportStore,
  intents: ReturnType<typeof intentsByForm>,
  demo: boolean,
  source: string,
): Promise<number> {
  const ids = [...intents.keys()]
  if (ids.length === 0) return 0
  const existing = (await svc.listAllegroOrderImports({ checkout_form_id: ids } as never, { take: null, select: ["id", "checkout_form_id", "status"] })) as unknown as Array<{
    id: string
    checkout_form_id: string
    status: string
  }>
  const byForm = new Map(existing.map((r) => [r.checkout_form_id, r]))
  let touched = 0
  const now = new Date()
  for (const [form, info] of intents) {
    const row = byForm.get(form) ?? null
    const action = drainAction(row, info.intent)
    const event = { last_event_id: info.lastEventId, last_event_type: info.lastType }
    switch (action.kind) {
      case "insert":
        await store.insertIgnore({
          checkout_form_id: form,
          status: action.status,
          source,
          demo,
          reason_code: action.reasonCode ?? null,
          reason: action.reason ?? null,
          last_event_id: info.lastEventId,
          last_event_type: info.lastType,
        })
        touched += 1
        break
      case "nudge":
        await store.transition((row as { id: string }).id, ["pending", "unknown"], { next_attempt_at: null, ...event })
        touched += 1
        break
      case "cancel_before_import":
        await store.transition((row as { id: string }).id, ["pending", "unknown", "held"], {
          status: "skipped",
          reason_code: "cancelled",
          reason: "Cancelled on Allegro before it was imported.",
          cancelled_on_allegro_at: now,
          ...event,
        })
        touched += 1
        break
      case "request_cancel":
        await store.transition((row as { id: string }).id, ["importing", "imported"], { cancel_requested: true, cancelled_on_allegro_at: now, ...event })
        touched += 1
        break
      case "request_refresh":
        await store.transition((row as { id: string }).id, ["imported"], { refresh_requested: true, ...event })
        touched += 1
        break
      default:
        break
    }
  }
  return touched
}

async function drainLive(svc: AllegroModuleService, store: ImportStore): Promise<{ read: number; touched: number; note: string | null }> {
  let cursor = await getState<Cursor>(svc, CURSOR_ID)
  const now = new Date()
  if (!cursor || cursorExpired(cursor.at ? new Date(cursor.at) : null, now, EVENT_RETENTION_DAYS)) {
    /* A fresh start, or a pause longer than Allegro keeps events: begin at the newest event. */
    const latest = latestEventId(await getOrderEventStats(svc))
    const note = cursor ? "The import was paused longer than Allegro keeps order events (60 days). It restarted at the newest event: bring the gap in with the catch-up import." : null
    await setState(svc, CURSOR_ID, { id: latest ?? "0", at: now.toISOString(), updatedAt: now.toISOString(), note } satisfies Cursor)
    return { read: 0, touched: 0, note: note ?? "Started at the newest Allegro order event. Earlier orders come in with the catch-up import." }
  }
  const from = cursor.id
  const drained = await drainJournal({
    from,
    pageSize: EVENTS_PAGE_SIZE,
    maxPages: MAX_EVENT_PAGES,
    fetchPage: async (after) => eventsFromApi(await getOrderEvents(svc, after, EVENTS_PAGE_SIZE)),
    apply: (events) => applyIntents(svc, store, intentsByForm(events), false, "events"),
    save: (c) => setState(svc, CURSOR_ID, { id: c.id, at: c.at, updatedAt: new Date().toISOString(), note: null } satisfies Cursor),
  })
  return { read: drained.read, touched: drained.touched, note: null }
}

async function drainDemo(svc: AllegroModuleService, store: ImportStore, stream: DemoStream): Promise<{ read: number; touched: number; note: string | null }> {
  let cursor = await getState<Cursor>(svc, DEMO_CURSOR_ID)
  let note: string | null = null
  if (!cursor) {
    /* The demo starts at the beginning of today, so arming shows today's purchases at once. */
    const today = dayStart(stream.now)
    cursor = { id: demoEventId(today, 0, 0), at: today.toISOString(), updatedAt: new Date().toISOString() }
    note = "Demo: started at the beginning of today."
  }
  const start: Cursor = cursor
  if (note) await setState(svc, DEMO_CURSOR_ID, start)
  const drained = await drainJournal({
    from: start.id,
    pageSize: EVENTS_PAGE_SIZE,
    maxPages: MAX_EVENT_PAGES,
    fetchPage: async (after) => eventsFromApi({ events: demoEventsAfter(stream.seeds, stream.now, after, EVENTS_PAGE_SIZE) }),
    apply: (events) => applyIntents(svc, store, intentsByForm(events), true, "demo"),
    save: (c) => setState(svc, DEMO_CURSOR_ID, { id: c.id, at: c.at, updatedAt: new Date().toISOString() } satisfies Cursor),
  })
  return { read: drained.read, touched: drained.touched, note }
}

/* ------------------------------------------------------------------ */
/* Process                                                             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* The shared marketplace reference lock                               */
/* ------------------------------------------------------------------ */

const REF_LOCKS = Symbol.for("koda.allegro.refLocks")
type RefLockHolder = typeof globalThis & { [REF_LOCKS]?: Set<string> }

interface LockingLike {
  acquire(keys: string | string[], args?: { ownerId?: string | null; expire?: number }): Promise<void>
  release(keys: string | string[], args?: { ownerId?: string | null }): Promise<boolean>
}

/**
 * Runs `fn` holding `marketplace-order-ref:<ref>`: an in-process guard plus
 * the Medusa Locking module, as a try-lock released in `finally` and expiring
 * after five minutes if the process dies. The key is the one the BaseLinker
 * plugin takes for the same marketplace order, so the two never create it
 * both; with a distributed locking provider (Redis, Postgres) the server and
 * the worker exclude each other too. Null when somebody else holds it: the
 * row comes back in a minute and the holder finishes the job.
 */
export async function withRefLock<T>(container: MedusaContainer, ref: string, fn: () => Promise<T>): Promise<T | null> {
  const key = refLockKey(ref)
  const holder = globalThis as RefLockHolder
  const local = holder[REF_LOCKS] ?? (holder[REF_LOCKS] = new Set<string>())
  if (local.has(key)) return null
  local.add(key)
  const ownerId = randomUUID()
  let locking: LockingLike | null = null
  try {
    locking = container.resolve(Modules.LOCKING) as unknown as LockingLike
  } catch {
    locking = null
  }
  try {
    if (locking) {
      try {
        await locking.acquire(key, { ownerId, expire: REF_LOCK_SECONDS })
      } catch {
        return null
      }
    }
    try {
      return await fn()
    } finally {
      if (locking) await locking.release(key, { ownerId }).catch(() => false)
    }
  } finally {
    local.delete(key)
  }
}

function portsFor(
  container: MedusaContainer,
  svc: AllegroModuleService,
  store: ImportStore,
  ctx: ImportContext | { hold: { code: "no_region" | "no_channel"; reason: string } },
  stream: DemoStream | null,
): ImportPorts {
  const sql = requireSql(container)
  const query = queryOf(container)
  return {
    now: () => new Date(),
    token: () => randomUUID(),
    claim: async (row, token) => {
      const now = new Date()
      return (await store.claim(row.id, { now, leaseUntil: new Date(now.getTime() + IMPORT_LEASE_MS), token })) as never
    },
    finish: (row, token, patch) => store.finish(row.id, token, patch),
    progress: (row, token, patch) => store.progress(row.id, token, patch),
    findOrderByRef: async (ref) => (await ordersByRef(sql, [ref]))[0] ?? null,
    fetchForm: async (id) => {
      const raw = stream ? demoFormFromStream(stream, id) : await getCheckoutForm(svc, id)
      if (!raw) throw Object.assign(new Error("The simulated checkout form is no longer in the demo stream."), { status: 404 })
      const form = checkoutFormFromApi(raw)
      if (!form) throw Object.assign(new Error("Allegro answered a checkout form without an id."), { status: 404 })
      return form
    },
    context: async () => ctx,
    precheckStock: async (decision: Extract<ImportDecision, { kind: "create" }>, c: ImportContext) => {
      const variants = await loadVariantInventory(query, [...new Set(decision.lines.map((l) => l.variantId))])
      const locations = await channelLocationIds(query, c.salesChannelId)
      const plan = planReservations(
        decision.lines.map((l) => ({ lineItemId: l.allegroLineId, variantId: l.variantId, quantity: l.quantity })),
        variants,
        locations,
      )
      return plan.problems.length > 0 ? plan.problems.join(" ") : null
    },
    createDraft: (decision: Extract<ImportDecision, { kind: "create" }>) => createAllegroDraft(container, decision.order),
    complete: (orderId, args) => completeAllegroOrder(container, orderId, { ...args, demo: svc.isDemo() }),
    withRefLock: (ref, fn) => withRefLock(container, ref, fn),
  }
}

async function buildContext(
  container: MedusaContainer,
  svc: AllegroModuleService,
  demo: boolean,
): Promise<ImportContext | { hold: { code: "no_region" | "no_channel"; reason: string } }> {
  const o = svc.getOptions()
  const target = await resolveTarget(container, svc, "pln", true)
  if (!target.regionId || !target.currency) return { hold: { code: "no_region", reason: target.warnings.join(" ") || "No region for Allegro orders." } }
  if (!target.salesChannelId) return { hold: { code: "no_channel", reason: target.warnings.join(" ") || "No sales channel for Allegro orders." } }
  const { byOffer, bySku } = await lineMaps(svc, queryOf(container), demo)
  return {
    regionId: target.regionId,
    currency: target.currency,
    salesChannelId: target.salesChannelId,
    byOffer,
    bySku,
    shippingOptionId: o.orderImport.shippingOptionId,
    shippingOptions: o.orderImport.shippingOptions,
    demo,
  }
}

async function dueRows(svc: AllegroModuleService, demo: boolean, take: number): Promise<ImportRowDb[]> {
  const now = new Date()
  return (await svc.listAllegroOrderImports(
    {
      status: ["pending", "unknown"],
      demo,
      $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
    } as never,
    { take, order: { created_at: "ASC" } },
  )) as unknown as ImportRowDb[]
}

async function processDue(
  container: MedusaContainer,
  svc: AllegroModuleService,
  store: ImportStore,
  demo: boolean,
  stream: DemoStream | null,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  await store.expireLeases(new Date())
  const rows = await dueRows(svc, demo, svc.getOptions().orderImport.perRun)
  if (rows.length === 0) return counts
  const ctx = await buildContext(container, svc, demo)
  const ports = portsFor(container, svc, store, ctx, stream)
  for (const row of rows) {
    const armed = await armedWriters(svc)
    if (!armed.has("orders")) {
      counts.stopped = (counts.stopped ?? 0) + 1
      break
    }
    let outcome: ImportOutcome
    try {
      outcome = await processImport(row, ports, (s) => svc.mask(s))
    } catch (err) {
      /* An error outside the decisions (the database, the lookup): the lease expires and the lookup runs again. */
      svc.getLogger().error(`[allegro] import of ${row.checkout_form_id} failed: ${errorText(svc, err)}`)
      counts.error = (counts.error ?? 0) + 1
      continue
    }
    counts[outcome.kind] = (counts[outcome.kind] ?? 0) + 1
    if (outcome.kind === "held") {
      await emitAllegroEvent(svc, "allegro.import.held", { import_id: row.id, checkout_form_id: row.checkout_form_id, reason_code: outcome.code, demo })
    }
    if (outcome.kind === "imported") {
      svc.getLogger().info(`[allegro] imported ${marketplaceRef(row.checkout_form_id)} as order ${outcome.displayId ?? outcome.orderId}`)
    }
  }
  return counts
}

/* ------------------------------------------------------------------ */
/* Cancellations and refreshes                                         */
/* ------------------------------------------------------------------ */

async function processCancels(container: MedusaContainer, svc: AllegroModuleService, store: ImportStore, demo: boolean): Promise<number> {
  const rows = (await svc.listAllegroOrderImports({ status: "imported", cancel_requested: true, demo } as never, { take: 25 })) as unknown as ImportRowDb[]
  const query = queryOf(container)
  let done = 0
  for (const row of rows) {
    if (!row.order_id) continue
    const { data } = await query.graph({ entity: "order", fields: ["id", "status", "fulfillments.id", "fulfillments.canceled_at"], filters: { id: row.order_id } })
    const order = (data as Array<{ id: string; status: string; fulfillments?: Array<{ canceled_at?: string | null } | null> | null }>)[0]
    const decision = cancelDecision(
      order ? { status: order.status, activeFulfillments: (order.fulfillments ?? []).filter((f) => f && !f.canceled_at).length } : null,
    )
    if (decision.kind === "cancel") {
      try {
        if (demo) await cancelDemoOrder(container, row.order_id)
        else await coreFlows.cancelOrderWorkflow(container).run({ input: { order_id: row.order_id, no_notification: true } })
        await store.transition(row.id, ["imported"], { status: "cancelled", cancel_requested: false, reason_code: "cancelled_on_allegro", reason: "Cancelled on Allegro; the Medusa order was cancelled and its stock released." })
        done += 1
      } catch (err) {
        await store.transition(row.id, ["imported"], { cancel_requested: false, attention: `Cancelled on Allegro, but Medusa refused to cancel the order: ${errorText(svc, err)}` })
      }
    } else if (decision.kind === "already") {
      await store.transition(row.id, ["imported"], { status: "cancelled", cancel_requested: false })
    } else if (decision.kind === "attention") {
      await store.transition(row.id, ["imported"], { cancel_requested: false, attention: decision.reason })
    } else {
      await store.transition(row.id, ["imported"], { cancel_requested: false, attention: "Cancelled on Allegro; the Medusa order no longer exists." })
    }
  }
  return done
}

async function processRefreshes(svc: AllegroModuleService, store: ImportStore, demo: boolean, stream: DemoStream | null): Promise<number> {
  const rows = (await svc.listAllegroOrderImports({ status: "imported", refresh_requested: true, demo } as never, { take: 25 })) as unknown as ImportRowDb[]
  let done = 0
  for (const row of rows) {
    try {
      const raw = stream ? demoFormFromStream(stream, row.checkout_form_id) : await getCheckoutForm(svc, row.checkout_form_id)
      const form = raw ? checkoutFormFromApi(raw) : null
      if (!form) {
        await store.transition(row.id, ["imported"], { refresh_requested: false })
        continue
      }
      const changed = buyerChange(row.details, form)
      await store.transition(row.id, ["imported"], {
        refresh_requested: false,
        allegro_status: form.status,
        fulfillment_status: form.fulfillmentStatus,
        /* The login and the delivery for the order card; a row from 0.2 gets them on its first refresh. */
        details: { ...(row.details ?? {}), ...importDetails(form) },
        ...(changed ? { attention: changed } : {}),
        ...(form.status === "CANCELLED" ? { cancel_requested: true, cancelled_on_allegro_at: new Date() } : {}),
      })
      done += 1
    } catch {
      /* Tried again on the next run. */
    }
  }
  return done
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

async function streamFor(container: MedusaContainer, svc: AllegroModuleService, days = 7): Promise<DemoStream> {
  const query = queryOf(container)
  return demoStream(svc, query, await loadCatalog(query, svc.getOptions().stockLocationIds), days)
}

const PREVIEW_MAX = 20

/**
 * Forms the next armed run would queue: the events after the cursor, READ
 * WITHOUT MOVING IT (one page). Before the first armed run there is no
 * cursor: that run starts at the newest event, so the preview says so.
 */
async function peekNewForms(svc: AllegroModuleService, demo: boolean, stream: DemoStream | null): Promise<{ forms: string[]; note: string | null }> {
  let events: OrderEvent[] = []
  let note: string | null = null
  if (demo && stream) {
    const cursor = await getState<Cursor>(svc, DEMO_CURSOR_ID)
    const from = cursor?.id ?? demoEventId(dayStart(stream.now), 0, 0)
    events = eventsAfter(eventsFromApi({ events: demoEventsAfter(stream.seeds, stream.now, from, EVENTS_PAGE_SIZE) }), from)
  } else {
    const cursor = await getState<Cursor>(svc, CURSOR_ID)
    if (!cursor) return { forms: [], note: "The first armed run starts at the newest Allegro order event; orders bought before it come in with the catch-up import." }
    if (cursorExpired(cursor.at ? new Date(cursor.at) : null, new Date(), EVENT_RETENTION_DAYS)) {
      return { forms: [], note: "The cursor is older than Allegro keeps order events (60 days): the next run restarts at the newest event." }
    }
    const after = cursor.id === "0" ? null : cursor.id
    events = eventsAfter(eventsFromApi(await getOrderEvents(svc, after, EVENTS_PAGE_SIZE)), after)
    if (events.length >= EVENTS_PAGE_SIZE) note = `Only the first ${EVENTS_PAGE_SIZE} new events were read for the preview.`
  }
  const wanted = [...intentsByForm(events)].filter(([, info]) => info.intent === "import").map(([form]) => form)
  if (wanted.length === 0) return { forms: [], note }
  const known = (await svc.listAllegroOrderImports({ checkout_form_id: wanted } as never, { take: null, select: ["checkout_form_id"] })) as unknown as Array<{ checkout_form_id: string }>
  const seen = new Set(known.map((r) => r.checkout_form_id))
  return { forms: wanted.filter((f) => !seen.has(f)), note }
}

/**
 * What the next run would do: the waiting forms and the new ones after the
 * cursor. Nothing is claimed, nothing created, the cursor does not move.
 */
async function preview(container: MedusaContainer, svc: AllegroModuleService, demo: boolean): Promise<{ items: AllegroImportRunResponse["preview"]; note: string | null }> {
  const rows = (await svc.listAllegroOrderImports({ status: ["pending", "unknown", "held"], demo } as never, { take: PREVIEW_MAX, order: { created_at: "ASC" } })) as unknown as ImportRowDb[]
  const stream = demo ? await streamFor(container, svc) : null
  const peek = await peekNewForms(svc, demo, stream).catch((err) => ({ forms: [] as string[], note: `Reading new order events failed: ${errorText(svc, err)}` }))
  const ids = [...rows.map((r) => r.checkout_form_id), ...peek.forms].slice(0, PREVIEW_MAX)
  if (ids.length === 0) return { items: [], note: peek.note }
  const ctx = await buildContext(container, svc, demo).catch(() => null)
  const sql = requireSql(container)
  const out: AllegroImportRunResponse["preview"] = []
  for (const id of ids) {
    const existing = (await ordersByRef(sql, [marketplaceRef(id)]))[0]
    if (existing) {
      out.push({ checkoutFormId: id, decision: "duplicate", reason: existing.ours ? "Already in Medusa, would be adopted." : "Imported by another integration.", lines: 0 })
      continue
    }
    let form: CheckoutForm | null = null
    try {
      const raw = stream ? demoFormFromStream(stream, id) : await getCheckoutForm(svc, id)
      form = raw ? checkoutFormFromApi(raw) : null
    } catch (err) {
      out.push({ checkoutFormId: id, decision: "wait", reason: `Reading the form failed: ${errorText(svc, err)}`, lines: 0 })
      continue
    }
    if (!form) {
      out.push({ checkoutFormId: id, decision: "hold", reason: "The checkout form is not available.", lines: 0 })
      continue
    }
    if (!ctx || "hold" in ctx) {
      out.push({ checkoutFormId: id, decision: "hold", reason: ctx && "hold" in ctx ? ctx.hold.reason : "No region or sales channel.", lines: form.lines.length })
      continue
    }
    const d = planImport(form, ctx)
    out.push({
      checkoutFormId: id,
      decision: d.kind,
      reason: d.kind === "create" ? `${d.paid ? "Paid" : "Not paid"}, ${d.order.items.length} line(s), total ${d.total ? `${d.total.value} ${d.total.currency}` : "unknown"}.` : d.reason,
      lines: form.lines.length,
    })
  }
  return { items: out, note: peek.note }
}

export async function runOrderImport(container: MedusaContainer, input: ImportRunInput = {}): Promise<ImportRunResult> {
  const result = await exclusive("import", async (): Promise<ImportRunResult> => {
    const svc = allegroOf(container)
    const o = svc.getOptions()
    const trigger = input.trigger ?? "manual"
    const mode = input.mode ?? "auto"
    const startedAt = new Date()
    if (!o.demo) {
      if (!svc.isConfigured()) return { skipped: "not_configured", preview: [], counts: {}, message: null, run: null }
      if (!(await isConnected(svc))) return { skipped: "not_connected", preview: [], counts: {}, message: null, run: null }
    }
    if (mode === "plan") {
      const { items: list, note } = await preview(container, svc, o.demo)
      const summary = `Dry run: ${list.filter((p) => p.decision === "create").length} of ${list.length} form(s) would be created.`
      const run = await recordRun(svc, {
        kind: "import",
        source: o.demo ? "demo" : "api",
        trigger,
        status: "ok",
        dryRun: true,
        items: list.length,
        message: note ? `${summary} ${note}` : summary,
        startedAt,
      })
      return { skipped: null, preview: list, counts: {}, message: note, run }
    }
    const armed = await armedWriters(svc)
    if (!armed.has("orders")) return { skipped: "not_armed", preview: [], counts: {}, message: "The orders writer is not armed.", run: null }

    await touchWriterRun(svc, "orders")
    const store = importStoreOf(container)
    const counts: Record<string, number> = {}
    let message: string | null = null
    let failed = false
    try {
      const stream = o.demo ? await streamFor(container, svc) : null
      const drain = o.demo ? await drainDemo(svc, store, stream as DemoStream) : await drainLive(svc, store)
      counts.events = drain.read
      counts.queued = drain.touched
      message = drain.note
      Object.assign(counts, await processDue(container, svc, store, o.demo, stream))
      counts.cancelled = await processCancels(container, svc, store, o.demo)
      counts.refreshed = await processRefreshes(svc, store, o.demo, stream)
      await recordOutcome(svc, "orders", { kind: "ok" })
    } catch (err) {
      failed = true
      message = errorText(svc, err)
      await recordOutcome(svc, "orders", { kind: "systemic", message })
    }
    /*
     * The import runs every two minutes: a run that only found nothing to do
     * leaves no row, or the history would show nothing else. The freshness
     * the mirror stock push needs is the writer's `last_success_at`, set by
     * `recordOutcome` above on every healthy run, recorded or not.
     */
    const busy = Object.entries(counts).some(([k, v]) => k !== "events" && v > 0)
    if (!failed && !message && !busy && trigger !== "manual") return { skipped: null, preview: [], counts, message, run: null }
    const run = await recordRun(svc, {
      kind: "import",
      source: o.demo ? "demo" : "api",
      trigger,
      status: failed ? "error" : (counts.held ?? 0) > 0 ? "partial" : "ok",
      items: (counts.imported ?? 0) + (counts.adopted ?? 0) + (counts.held ?? 0) + (counts.waiting ?? 0) + (counts.retry ?? 0),
      created: counts.imported ?? 0,
      issues: counts.held ?? 0,
      statuses: counts,
      message,
      startedAt,
    })
    return { skipped: null, preview: [], counts, message, run }
  })
  return result ?? { skipped: "running", preview: [], counts: {}, message: null, run: null }
}

/**
 * The catch-up import: checkout forms bought between two dates, ready for
 * processing, queued as import rows (once each), for orders from before the
 * import was armed or from a pause longer than Allegro keeps events. They are
 * imported by the next armed run. The event cursor is not touched: this fills
 * a gap behind it. (The route stays /admin/allegro/imports/window and the
 * rows keep `source: "window"`.)
 */
export async function queueCatchUpImport(container: MedusaContainer, from: Date, to: Date): Promise<AllegroImportWindowResponse> {
  const svc = allegroOf(container)
  const o = svc.getOptions()
  if (!(from.getTime() < to.getTime())) return { queued: 0, known: 0, read: 0, complete: true, message: "The start must be before the end." }
  if (to.getTime() - from.getTime() > WINDOW_MAX_DAYS * DAY_MS) return { queued: 0, known: 0, read: 0, complete: true, message: `At most ${WINDOW_MAX_DAYS} days at once.` }
  const store = importStoreOf(container)
  const ids: string[] = []
  let complete = true
  if (o.demo) {
    const query = queryOf(container)
    const variants = await loadCatalog(query, o.stockLocationIds)
    const stream = await demoStream(svc, query, variants, 7)
    const days = Math.min(7, Math.ceil((to.getTime() - from.getTime()) / DAY_MS) + 1)
    const seeds = demoSeedsUntil(stream.offers, Array.from({ length: days }, (_, i) => new Date(dayStart(to).getTime() - i * DAY_MS)), new Date())
    for (const s of seeds) {
      if (s.boughtAt >= from && s.boughtAt <= to && (!s.cancelAt || s.cancelAt > new Date()) && s.readyAt <= new Date()) ids.push(s.id)
    }
  } else {
    if (!svc.isConfigured() || !(await isConnected(svc))) return { queued: 0, known: 0, read: 0, complete: false, message: "Connect the Allegro account first." }
    for (let offset = 0; offset < WINDOW_MAX_FORMS; offset += ORDERS_PAGE_SIZE) {
      const page = await getCheckoutFormsByPurchase(svc, from, to, offset)
      const forms = Array.isArray(page.checkoutForms) ? page.checkoutForms : []
      for (const f of forms) {
        const id = (f as { id?: unknown })?.id
        if (typeof id === "string" && id) ids.push(id)
      }
      if (forms.length < ORDERS_PAGE_SIZE) break
      if (offset + ORDERS_PAGE_SIZE >= WINDOW_MAX_FORMS) complete = false
    }
  }
  let queued = 0
  for (const id of [...new Set(ids)]) {
    const row = await store.insertIgnore({ checkout_form_id: id, status: "pending", source: "window", demo: o.demo })
    if (row) queued += 1
  }
  return {
    queued,
    known: ids.length - queued,
    read: ids.length,
    complete,
    message: complete ? null : `Stopped at ${WINDOW_MAX_FORMS} forms; run the catch-up import again with a later start.`,
  }
}

/** A person retries a held (or skipped) form: back to pending, attempts reset. */
export async function retryImport(container: MedusaContainer, id: string): Promise<boolean> {
  const svc = allegroOf(container)
  const store = importStoreOf(container)
  const [current] = (await svc.listAllegroOrderImports({ id } as never, { take: 1 })) as unknown as ImportRowDb[]
  /* A duplicate written by 0.2 kept the other integration's order in order_id; that id moves to details, so it never reads as ours. */
  const legacyDuplicate =
    current?.reason_code === "duplicate_ref" && current.order_id
      ? { order_id: null, display_id: null, details: { ...(current.details ?? {}), duplicate_order_id: current.order_id, duplicate_display_id: current.display_id } }
      : {}
  const row = await store.transition(id, ["held", "skipped"], { status: "pending", attempts: 0, next_attempt_at: null, reason_code: null, reason: null, ...legacyDuplicate })
  return Boolean(row)
}

/**
 * A person checked an order that needed attention (changed or cancelled on
 * Allegro after the import, a total that differs): the flag goes, the reason
 * stays, the row says who and when. Only rows with something to handle.
 */
export async function markImportHandled(container: MedusaContainer, id: string, actorId: string | null): Promise<boolean> {
  const svc = allegroOf(container)
  const [row] = (await svc.listAllegroOrderImports({ id } as never, { take: 1 })) as unknown as ImportRowDb[]
  if (!row || (!row.attention && !row.total_mismatch)) return false
  const store = importStoreOf(container)
  const done = await store.transition(id, ["imported", "cancelled", "held", "skipped", "pending", "unknown"], {
    attention: null,
    total_mismatch: false,
    details: { ...(row.details ?? {}), handled_at: new Date().toISOString(), handled_by: actorId },
  })
  return Boolean(done)
}
