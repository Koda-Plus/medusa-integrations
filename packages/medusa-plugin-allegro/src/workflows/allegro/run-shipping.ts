/**
 * PARCELS AND SELLER STATUS BACK TO ALLEGRO, for imported orders.
 *
 *   enqueue   a Medusa fulfillment (`order.fulfillment_created`) or shipment
 *             (`shipment.created`) of an imported order becomes outbox rows:
 *             one per tracking number, plus READY_FOR_SHIPMENT on the
 *             fulfillment and SENT once every Allegro line is shipped. Rows
 *             are queued while `writes.shipping` allows the writer and sent
 *             only while it is armed; a status Allegro already shows (or a
 *             later one) is never set again, so a backlog cannot move an
 *             order back.
 *   send      every row once, after a lookup on Allegro, through the generic
 *             outbox state machine (`lib/outbox.ts`).
 *
 * In demo mode a simulated courier ships every imported demo order a couple
 * of hours after it was imported, so the whole path can be watched.
 */

import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import type AllegroModuleService from "../../modules/allegro/service"
import { getCarriers, getCheckoutForm, getShipments } from "../../modules/allegro/lib/api"
import { checkoutFormFromApi } from "../../modules/allegro/lib/checkout"
import { AllegroApiError } from "../../modules/allegro/lib/client"
import { apiSend } from "../../modules/allegro/lib/connection"
import { OUTBOX_LEASE_MS } from "../../modules/allegro/lib/constants"
import { demoCarriersRaw, demoWaybill } from "../../modules/allegro/lib/demo-stream"
import type { ImportRow, OutboxRow } from "../../modules/allegro/lib/dto"
import { processOutboxItem, type OutboxOutcome, type OutboxPorts } from "../../modules/allegro/lib/outbox"
import { itemQuantity } from "../../modules/allegro/lib/reservations"
import {
  allShipped,
  carriersFromApi,
  hasWaybill,
  parcelKey,
  parcelsOf,
  shouldSetStatus,
  statusKey,
  waybillsFromApi,
  type Carrier,
} from "../../modules/allegro/lib/shipping"
import type { OutboxStore } from "../../modules/allegro/lib/store"
import { loadOverlay, updateOverlay } from "./demo-sim"
import { allegroOf, errorText, exclusive, getState, outboxStoreOf, queryOf, recordRun, setState } from "./runtime"
import { armedWriters, recordOutcome, touchWriterRun } from "./writers"

const CARRIERS_ID = "carriers"
const DAY_MS = 24 * 60 * 60 * 1000
const DEMO_SHIP_AFTER_MS = 2 * 60 * 60 * 1000

export async function carriersOf(svc: AllegroModuleService): Promise<Carrier[]> {
  if (svc.isDemo()) return carriersFromApi(demoCarriersRaw())
  const cached = await getState<{ at: string; carriers: Carrier[] }>(svc, CARRIERS_ID)
  if (cached && Date.now() - Date.parse(cached.at) < DAY_MS && cached.carriers.length > 0) return cached.carriers
  try {
    const carriers = carriersFromApi(await getCarriers(svc))
    if (carriers.length > 0) await setState(svc, CARRIERS_ID, { at: new Date().toISOString(), carriers })
    return carriers
  } catch {
    return cached?.carriers ?? []
  }
}

interface FulfillmentRecord {
  id: string
  provider_id?: string | null
  shipped_at?: string | null
  canceled_at?: string | null
  labels?: Array<{ tracking_number?: string | null } | null> | null
  items?: Array<{ line_item_id?: string | null; quantity?: number | string | null } | null> | null
}

interface OrderRecord {
  id: string
  items?: Array<{ id: string; quantity?: unknown; detail?: { quantity?: unknown } | null; raw_quantity?: { value?: unknown } | null; metadata?: Record<string, unknown> | null } | null> | null
  fulfillments?: FulfillmentRecord[] | null
}

/**
 * Turns the fulfillments of an imported order into outbox rows. Safe to call
 * many times: every row has a unique key, and an existing key is left alone.
 */
export async function enqueueForOrder(container: MedusaContainer, orderId: string, reason: "fulfillment" | "shipment"): Promise<number> {
  const svc = allegroOf(container)
  const imports = (await svc.listAllegroOrderImports({ order_id: orderId, status: "imported" } as never, { take: 1 })) as unknown as ImportRow[]
  const imp = imports[0]
  if (!imp) return 0
  /* Queued while the options allow the writer; sent only while it is armed. */
  if (!svc.getOptions().writes.shipping) return 0
  const query = queryOf(container)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      "version",
      "items.quantity",
      "items.raw_quantity",
      "items.detail.quantity",
      "items.metadata",
      "fulfillments.id",
      "fulfillments.provider_id",
      "fulfillments.shipped_at",
      "fulfillments.canceled_at",
      "fulfillments.labels.tracking_number",
      "fulfillments.items.line_item_id",
      "fulfillments.items.quantity",
    ],
    filters: { id: orderId },
  })
  const order = (data as OrderRecord[])[0]
  if (!order) return 0
  const allegroLines = new Map<string, string>()
  const ordered = new Map<string, number>()
  for (const item of order.items ?? []) {
    const allegroId = item?.metadata?.allegro_line_item_id
    if (!item || typeof allegroId !== "string") continue
    allegroLines.set(item.id, allegroId)
    ordered.set(allegroId, (ordered.get(allegroId) ?? 0) + itemQuantity(item))
  }
  const carriers = await carriersOf(svc)
  const store = outboxStoreOf(container)
  let queued = 0
  const shipped = new Map<string, number>()
  let anyActive = false
  for (const f of order.fulfillments ?? []) {
    if (!f || f.canceled_at) continue
    anyActive = true
    const parcels = parcelsOf(
      {
        providerId: f.provider_id ?? null,
        canceled: false,
        labels: (f.labels ?? []).map((l) => ({ trackingNumber: l?.tracking_number ?? null })),
        items: (f.items ?? []).map((i) => ({ lineItemId: i?.line_item_id ?? null, quantity: Number(i?.quantity) || 0 })),
      },
      allegroLines,
      carriers,
      svc.getOptions().carriers,
    )
    for (const p of parcels) {
      const row = await store.insertIgnore({
        writer: "shipping",
        dedupeKey: parcelKey(imp.checkout_form_id, p.waybill),
        checkout_form_id: imp.checkout_form_id,
        order_id: orderId,
        payload: { kind: "parcel", waybill: p.waybill, carrierId: p.carrierId, carrierName: p.carrierName, lineItemIds: p.lineItemIds, fulfillmentId: f.id },
        demo: Boolean(imp.demo),
      })
      if (row) queued += 1
    }
    if (f.shipped_at) {
      for (const i of f.items ?? []) {
        const allegroId = i?.line_item_id ? allegroLines.get(i.line_item_id) : undefined
        if (allegroId) shipped.set(allegroId, (shipped.get(allegroId) ?? 0) + (Number(i?.quantity) || 0))
      }
    }
  }
  if (anyActive && reason === "fulfillment") {
    const row = await store.insertIgnore({
      writer: "shipping",
      dedupeKey: statusKey(imp.checkout_form_id, "READY_FOR_SHIPMENT"),
      checkout_form_id: imp.checkout_form_id,
      order_id: orderId,
      payload: { kind: "status", status: "READY_FOR_SHIPMENT" },
      demo: Boolean(imp.demo),
    })
    if (row) queued += 1
  }
  if (allShipped(ordered, shipped)) {
    const row = await store.insertIgnore({
      writer: "shipping",
      dedupeKey: statusKey(imp.checkout_form_id, "SENT"),
      checkout_form_id: imp.checkout_form_id,
      order_id: orderId,
      payload: { kind: "status", status: "SENT" },
      demo: Boolean(imp.demo),
    })
    if (row) queued += 1
  }
  return queued
}

/** The simulated courier of demo mode: imported demo orders are "shipped" two hours after import. */
async function demoCourier(container: MedusaContainer, svc: AllegroModuleService, store: OutboxStore): Promise<number> {
  const before = new Date(Date.now() - DEMO_SHIP_AFTER_MS)
  const rows = (await svc.listAllegroOrderImports({ status: "imported", demo: true, imported_at: { $lte: before } } as never, { take: 50 })) as unknown as ImportRow[]
  /* An order somebody fulfilled in Medusa already has its own parcel: the simulated courier leaves it alone. */
  const forms = rows.map((r) => r.checkout_form_id)
  const parcels = forms.length
    ? ((await svc.listAllegroOutboxes({ writer: "shipping", checkout_form_id: forms } as never, { take: null, select: ["checkout_form_id", "dedupe_key"] })) as unknown as Array<{
        checkout_form_id: string
        dedupe_key: string
      }>)
    : []
  const shipped = new Set(parcels.filter((p) => p.dedupe_key.startsWith("parcel:")).map((p) => p.checkout_form_id))
  let queued = 0
  for (const imp of rows) {
    if (shipped.has(imp.checkout_form_id)) continue
    const waybill = demoWaybill(imp.checkout_form_id)
    const parcel = await store.insertIgnore({
      writer: "shipping",
      dedupeKey: parcelKey(imp.checkout_form_id, waybill),
      checkout_form_id: imp.checkout_form_id,
      order_id: imp.order_id,
      payload: { kind: "parcel", waybill, carrierId: "INPOST", carrierName: null, lineItemIds: [], fulfillmentId: null, simulated: true },
      demo: true,
    })
    const status = await store.insertIgnore({
      writer: "shipping",
      dedupeKey: statusKey(imp.checkout_form_id, "SENT"),
      checkout_form_id: imp.checkout_form_id,
      order_id: imp.order_id,
      payload: { kind: "status", status: "SENT", simulated: true },
      demo: true,
    })
    queued += (parcel ? 1 : 0) + (status ? 1 : 0)
  }
  void container
  return queued
}

function portsFor(svc: AllegroModuleService, store: OutboxStore, armed: () => Promise<Set<string>>): OutboxPorts {
  const demo = svc.isDemo()
  return {
    now: () => new Date(),
    token: () => randomUUID(),
    claim: async (item, token) => {
      const now = new Date()
      return (await store.claim(item.id, { now, leaseUntil: new Date(now.getTime() + OUTBOX_LEASE_MS), token })) as never
    },
    finish: (item, token, patch) => store.finish(item.id, token, patch),
    lookup: async (item) => {
      const p = item.payload ?? {}
      const form = String((item as unknown as OutboxRow).checkout_form_id)
      if (p.kind === "parcel") {
        const waybill = String(p.waybill ?? "")
        const existing = demo ? (await loadOverlay(svc)).parcels[form] ?? [] : waybillsFromApi(await getShipments(svc, form))
        return hasWaybill(existing, waybill) ? { found: true, result: { waybill } } : { found: false }
      }
      const wanted = String(p.status ?? "") as "READY_FOR_SHIPMENT" | "SENT"
      const current = demo ? (await loadOverlay(svc)).fulfillment[form]?.status ?? "NEW" : checkoutFormFromApi(await getCheckoutForm(svc, form))?.fulfillmentStatus ?? null
      return shouldSetStatus(current, wanted) ? { found: false } : { found: true, result: { status: current } }
    },
    send: async (item) => {
      const p = item.payload ?? {}
      const form = String((item as unknown as OutboxRow).checkout_form_id)
      const set = await armed()
      if (!set.has("shipping")) throw Object.assign(new Error("The shipping writer was disarmed."), { status: 0, transient: true })
      if (p.kind === "parcel") {
        const body = {
          carrierId: String(p.carrierId ?? "OTHER"),
          waybill: String(p.waybill ?? ""),
          ...(p.carrierId === "OTHER" && p.carrierName ? { carrierName: String(p.carrierName).slice(0, 30) } : {}),
          ...(Array.isArray(p.lineItemIds) && p.lineItemIds.length > 0 ? { lineItems: (p.lineItemIds as string[]).map((id) => ({ id })) } : {}),
        }
        if (demo) {
          const id = randomUUID()
          await updateOverlay(svc, (o) => {
            o.parcels[form] = [...(o.parcels[form] ?? []), { id, waybill: body.waybill, carrierId: body.carrierId, carrierName: (body as { carrierName?: string }).carrierName ?? null, lineItemIds: [], createdAt: new Date().toISOString() }]
          })
          return { kind: "sent", result: { shipmentId: id, simulated: true } }
        }
        const res = await apiSend<{ id?: string }>(svc, {
          method: "POST",
          path: `/order/checkout-forms/${encodeURIComponent(form)}/shipments`,
          json: body,
          idempotent: false,
          writer: "shipping",
          armed: set,
        })
        return { kind: "sent", result: { shipmentId: res.data?.id ?? null } }
      }
      const status = String(p.status ?? "")
      if (demo) {
        await updateOverlay(svc, (o) => {
          o.fulfillment[form] = { status, at: new Date().toISOString() }
        })
        return { kind: "sent", result: { status, simulated: true } }
      }
      const fresh = checkoutFormFromApi(await getCheckoutForm(svc, form))
      try {
        await apiSend(svc, {
          method: "PUT",
          path: `/order/checkout-forms/${encodeURIComponent(form)}/fulfillment`,
          query: fresh?.revision ? { "checkoutForm.revision": fresh.revision } : {},
          json: { status },
          idempotent: true,
          writer: "shipping",
          armed: set,
        })
      } catch (err) {
        /* 409: the order changed on Allegro a moment ago. The next attempt reads it again. */
        if (err instanceof AllegroApiError && err.status === 409) throw Object.assign(new Error(err.message), { status: 409, transient: true })
        throw err
      }
      return { kind: "sent", result: { status } }
    },
  }
}

export interface OutboxRunResult {
  skipped: null | "running" | "not_armed"
  counts: Record<string, number>
  message: string | null
}

/** Sends due outbox rows of one writer, oldest first, and records the run. */
export async function drainOutbox(
  container: MedusaContainer,
  svc: AllegroModuleService,
  writer: "shipping" | "invoices",
  ports: OutboxPorts,
  store: OutboxStore,
): Promise<{ counts: Record<string, number>; message: string | null }> {
  const counts: Record<string, number> = {}
  let message: string | null = null
  await store.expireLeases(new Date())
  const now = new Date()
  const rows = (await svc.listAllegroOutboxes(
    { writer, status: ["pending", "unknown"], demo: svc.isDemo(), $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }] } as never,
    { take: 50, order: { created_at: "ASC" } },
  )) as unknown as OutboxRow[]
  for (const row of rows) {
    const set = await armedWriters(svc)
    if (!set.has(writer)) {
      message = `The ${writer} writer was disarmed during the run; the rest waits.`
      break
    }
    let outcome: OutboxOutcome
    try {
      outcome = await processOutboxItem(row, ports, (s) => svc.mask(s))
    } catch (err) {
      counts.error = (counts.error ?? 0) + 1
      svc.getLogger().error(`[allegro] ${writer} ${row.dedupe_key}: ${errorText(svc, err)}`)
      continue
    }
    counts[outcome.kind] = (counts[outcome.kind] ?? 0) + 1
    const tripped =
      outcome.kind === "done"
        ? await recordOutcome(svc, writer, { kind: "ok" })
        : outcome.kind === "retry" && outcome.systemic
          ? await recordOutcome(svc, writer, { kind: "systemic", message: outcome.reason })
          : outcome.kind === "unknown"
            ? await recordOutcome(svc, writer, { kind: "systemic", message: outcome.reason })
            : outcome.kind === "failed"
              ? await recordOutcome(svc, writer, { kind: "item", message: outcome.reason })
              : false
    if (tripped) {
      message = `The circuit breaker disarmed the ${writer} writer.`
      break
    }
    if (outcome.kind === "retry" && /429/.test(outcome.reason)) {
      message = "Allegro asked to slow down (429); the rest waits for the next run."
      break
    }
  }
  return { counts, message }
}

export async function runShipping(container: MedusaContainer, input: { trigger?: string } = {}): Promise<OutboxRunResult> {
  const result = await exclusive("shipping", async (): Promise<OutboxRunResult> => {
    const svc = allegroOf(container)
    const startedAt = new Date()
    const armed = await armedWriters(svc)
    if (!armed.has("shipping")) return { skipped: "not_armed", counts: {}, message: "The shipping writer is not armed." }
    await touchWriterRun(svc, "shipping")
    const store = outboxStoreOf(container)
    let queued = 0
    if (svc.isDemo()) queued = await demoCourier(container, svc, store)
    const { counts, message } = await drainOutbox(container, svc, "shipping", portsFor(svc, store, () => armedWriters(svc)), store)
    if (queued > 0) counts.queued = queued
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    if (total > 0) {
      await recordRun(svc, {
        kind: "shipping",
        source: svc.isDemo() ? "demo" : "api",
        trigger: input.trigger ?? "manual",
        status: (counts.failed ?? 0) > 0 ? "partial" : "ok",
        items: total,
        created: counts.done ?? 0,
        issues: counts.failed ?? 0,
        statuses: counts,
        message,
        startedAt,
      })
    }
    return { skipped: null, counts, message }
  })
  return result ?? { skipped: "running", counts: {}, message: null }
}

/** A person retries a failed outbox row. */
export async function retryOutbox(container: MedusaContainer, id: string): Promise<boolean> {
  const store = outboxStoreOf(container)
  return Boolean(await store.transition(id, ["failed", "skipped"], { status: "pending", attempts: 0, next_attempt_at: null, last_error: null }))
}

export { portsFor as shippingPorts }
