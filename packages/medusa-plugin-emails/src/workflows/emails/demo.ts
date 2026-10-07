/**
 * THE SIMULATED OUTBOX OF DEMO MODE, seeded so the Panel is never empty and
 * never looks abandoned.
 *
 * The newest orders of the store get their order confirmation, the newest
 * shipped parcel its shipping e-mail and the newest registered customers
 * their welcome, rendered exactly as the provider would and kept in the
 * outbox. One welcome is kept as a failed send (a domain not verified in
 * Resend), so the failure state and "Retry" can be clicked through. Nothing
 * is sent: these are demo rows of the plugin's own table (`kind: "seed"`).
 *
 * ALIVE, NOT FROZEN. The rows are dated relative to the moment of the seed,
 * not to the records they come from (a demo store's orders may be months
 * old): a few within the last day, the rest over the last days, always at
 * the same offsets. The seed is rebuilt when it is older than
 * `DEMO_SEED_REFRESH_MS`, by `POST /admin/emails/demo/seed` (the page asks
 * for it when the status says the seed is stale; a GET never writes) or by
 * the hourly housekeeping job, so the 24-hour counter never drops to zero. A rebuild swaps the whole
 * seed set in one transaction under the same keys (the event keys of the
 * records), so it never duplicates a row; rows of real events and test sends
 * are never touched, and a record that already has such a row is not seeded.
 * A seed written by an older version of the plugin (dated like its records)
 * counts as stale, so the next visit or housekeeping run refreshes it.
 */

import { MAX_STORED_BODY_CHARS, TEMPLATES } from "../../modules/emails/lib/constants"
import { anonymize, orderData, orderSkipReason, shipmentData, welcomeData, type CustomerRecord, type FulfillmentRecord, type OrderRecord } from "../../modules/emails/lib/data"
import { addressHash, customerIdOf, eventKey } from "../../modules/emails/lib/keys"
import { normalizeLocale } from "../../modules/emails/lib/locale"
import { resolveTemplate } from "../../modules/emails/lib/registry"
import { renderTemplate } from "../../modules/emails/lib/render"
import { providerNote } from "../../modules/emails/lib/provider-status"
import { isEmail, maskEmail } from "../../modules/emails/lib/security"
import { applyBrandOverrides, type SettingRow } from "../../modules/emails/lib/settings"
import type { MessageStatus, SeedMessage } from "../../modules/emails/lib/store"
import { CUSTOMER_FIELDS, FULFILLMENT_FIELDS, ORDER_FIELDS, ORDER_OPTIONAL_FIELDS } from "./events"
import { emailsService, exclusive, graphList, graphOne, settingsFor, storeFor, type Scope } from "./runtime"

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

export const SEED_KEY = "demo:seeded"
/** Seeds of an older version (or none) are rebuilt on the next occasion. */
export const SEED_VERSION = 4
/** A seed older than this is rebuilt with fresh dates. Below 24 hours, so the 24-hour counter always has rows. */
export const DEMO_SEED_REFRESH_MS = 12 * HOUR
/** After a failed rebuild, the next try waits this long. */
const SEED_RETRY_MS = HOUR

/**
 * How long before the seed each row is dated, in hours. Fixed, so every
 * rebuild tells the same story: three confirmations, the parcel, a welcome
 * and the failed welcome within the last day; the rest over the last days.
 */
export const SEED_SLOTS = {
  orders: [0.4, 2.6, 7.5, 29, 53],
  shipment: 4.2,
  welcomes: [1.3, 34],
  failedWelcome: 10.5,
} as const

interface SeedMarker {
  at: number
  version: number
  done: boolean
}

function markerOf(row: SettingRow | undefined): SeedMarker | null {
  if (!row) return null
  const v = (row.value && typeof row.value === "object" ? row.value : {}) as Record<string, unknown>
  const at = Date.parse(String(v.at ?? row.updated_at ?? ""))
  return { at: Number.isFinite(at) ? at : 0, version: Number(v.version) || 1, done: v.done !== false }
}

/** Whether the seed must be built (again): missing, from an older version, too old, or failed over an hour ago. */
export function seedIsStale(row: SettingRow | undefined, now: Date): boolean {
  const m = markerOf(row)
  if (!m || m.version !== SEED_VERSION) return true
  const age = now.getTime() - m.at
  return m.done ? age >= DEMO_SEED_REFRESH_MS : age >= SEED_RETRY_MS
}

/** What the status tells the page about the seed: when it was built, and whether it is due. Reads only. */
export async function demoSeedState(scope: Scope, now: Date = new Date()): Promise<{ seededAt: string | null; stale: boolean } | null> {
  if (!emailsService(scope).isDemo()) return null
  try {
    const marker = (await storeFor(scope).settings()).find((r) => r.key === SEED_KEY)
    const m = markerOf(marker)
    return { seededAt: m && m.at > 0 && m.done ? new Date(m.at).toISOString() : null, stale: seedIsStale(marker, now) }
  } catch {
    return { seededAt: null, stale: false }
  }
}

/**
 * Seeds the demo outbox when it is missing or stale (`force` rebuilds it
 * anyway). Returns the rows written or refreshed; 0 outside demo mode, when
 * the provider of this process is not in demo mode, when the seed is fresh,
 * or while another seed runs in this process.
 */
export async function ensureDemoOutbox(scope: Scope, now: Date = new Date(), opts: { force?: boolean } = {}): Promise<number> {
  const svc = emailsService(scope)
  if (!svc.isDemo()) return 0
  /* The provider of this process would really send: no simulated outbox that says otherwise. */
  const note = providerNote()
  if (note && note.mode !== "demo") return 0
  const result = await exclusive("demo-seed", async () => {
    const store = storeFor(scope)
    const marker = (await store.settings()).find((r) => r.key === SEED_KEY)
    if (!opts.force && !seedIsStale(marker, now)) return 0
    /* Claimed before the slow part, so a second visit does not start another rebuild; `done` says whether it finished. */
    await store.setSetting(SEED_KEY, { at: now.toISOString(), version: SEED_VERSION, done: false }, "system")
    const rows = await buildSeed(scope, now)
    const { written, removed } = await store.replaceSeed(rows)
    await store.setSetting(SEED_KEY, { at: now.toISOString(), version: SEED_VERSION, done: true, rows: written, removed }, "system")
    return written
  })
  return result ?? 0
}

/**
 * The newest orders with their totals. One read for all of them; when Medusa
 * refuses it (an older Medusa cannot compute the totals of an order whose
 * lines have no version, some imported orders), the orders are read one by
 * one and the ones it refuses are left out, so one bad order never empties
 * the demo.
 */
async function newestOrders(scope: Scope, take: number): Promise<OrderRecord[]> {
  try {
    return await graphList<OrderRecord>(scope, "order", ORDER_FIELDS, ORDER_OPTIONAL_FIELDS, {}, { take, order: { created_at: "DESC" } })
  } catch {
    const ids = await graphList<{ id: string }>(scope, "order", ["id"], [], {}, { take, order: { created_at: "DESC" } })
    const out: OrderRecord[] = []
    for (const { id } of ids) {
      try {
        const one = await graphOne<OrderRecord>(scope, "order", ORDER_FIELDS, ORDER_OPTIONAL_FIELDS, { id })
        if (one) out.push(one)
      } catch {
        /* left out */
      }
    }
    return out
  }
}

/** The seed rows, rendered with the current branding and dated by `SEED_SLOTS`. */
export async function buildSeed(scope: Scope, now: Date): Promise<SeedMessage[]> {
  const o = emailsService(scope).getOptions()
  const brand = applyBrandOverrides(o.brand, (await settingsFor(scope)).brand)
  const anchor = Math.floor(now.getTime() / MINUTE) * MINUTE
  const hoursAgo = (h: number) => new Date(anchor - Math.round(h * 60) * MINUTE)
  const iso = (d: Date, minutes = 0) => new Date(d.getTime() + minutes * MINUTE).toISOString()
  const rows: SeedMessage[] = []
  /* The products, amounts and numbers of the store, the person of the samples: a copy of a live database never puts customers' names in the outbox. */
  const sampled = <T extends Parameters<typeof anonymize>[0] & { locale?: string | null }>(data: T): T => anonymize(data, normalizeLocale(data.locale) ?? o.defaultLocale)

  const add = (
    template: string,
    to: string,
    data: Record<string, unknown>,
    row: { key: string; resourceType: string; resourceId: string; orderId: string | null; customerId: string | null; at: Date; status?: MessageStatus; error?: string },
  ) => {
    const t = resolveTemplate(template, o)
    if (!t) return
    const rendered = renderTemplate(t, data, { options: o, brand })
    const failed = row.status === "failed"
    rows.push({
      key: row.key,
      template,
      locale: rendered.locale,
      demo: true,
      kind: "seed",
      recipient: maskEmail(to),
      subject: rendered.subject.slice(0, 300),
      trigger: t.def.trigger?.name ?? null,
      resource_type: row.resourceType,
      resource_id: row.resourceId,
      order_id: row.orderId,
      notification_id: null,
      requested_by: null,
      customer_id: customerIdOf(row.customerId),
      recipient_hash: isEmail(to) ? addressHash(to) : null,
      created_at: row.at,
      status: row.status ?? "sent",
      external_id: failed ? null : `demo_seed_${row.resourceId.slice(-12)}`,
      sent_at: failed ? null : row.at,
      error_code: failed ? "validation_error" : null,
      error: failed ? row.error ?? null : null,
      retryable: false,
      body_html: !failed && rendered.html.length <= MAX_STORED_BODY_CHARS ? rendered.html : null,
      body_text: !failed && rendered.text.length <= MAX_STORED_BODY_CHARS ? rendered.text : null,
    })
  }

  /* When each seeded order was confirmed, so its parcel leaves after it. */
  const confirmedAt = new Map<string, Date>()
  /* A wider window than the five slots: the newest orders of a store are often marketplace imports,
     which the plugin skips (`skipOrderMetadataKeys`), and a demo must still find its five. */
  const orders = (await newestOrders(scope, 60)).filter((order) => !orderSkipReason(order, o)).slice(0, SEED_SLOTS.orders.length)
  for (const [i, order] of orders.entries()) {
    const at = hoursAgo(SEED_SLOTS.orders[i])
    confirmedAt.set(order.id, at)
    /* The message dates the order a minute before it was sent. */
    add(TEMPLATES.orderPlaced, String(order.email), { ...sampled(orderData(order, o)), order_date: iso(at, -1) }, {
      key: eventKey(TEMPLATES.orderPlaced, order.id),
      resourceType: "order",
      resourceId: order.id,
      orderId: order.id,
      customerId: order.customer_id ?? null,
      at,
    })
  }

  /* The newest shipped parcel of an order the plugin would write to (not a skipped marketplace import). */
  const parcels = await graphList<FulfillmentRecord & { order?: { id?: string | null } | null }>(scope, "fulfillment", FULFILLMENT_FIELDS, [], { shipped_at: { $ne: null } }, { take: 20, order: { created_at: "DESC" } })
  let parcel: (typeof parcels)[number] | undefined
  let order: OrderRecord | undefined
  for (const candidate of parcels) {
    if (!candidate?.order?.id) continue
    let found: OrderRecord | undefined
    try {
      found = (await graphList<OrderRecord>(scope, "order", [...ORDER_FIELDS, "fulfillments.id", "fulfillments.shipped_at", "fulfillments.canceled_at", "fulfillments.items.quantity"], ORDER_OPTIONAL_FIELDS, { id: candidate.order.id }, { take: 1 }))[0]
    } catch {
      /* An order whose totals Medusa refuses to compute: the next parcel. */
      continue
    }
    if (found && !orderSkipReason(found, o)) {
      parcel = candidate
      order = found
      break
    }
  }
  if (parcel && order) {
    const confirmed = confirmedAt.get(order.id)
    let at = hoursAgo(SEED_SLOTS.shipment)
    if (confirmed && at.getTime() <= confirmed.getTime()) at = new Date(Math.min(confirmed.getTime() + 20 * MINUTE, anchor - MINUTE))
    add(TEMPLATES.orderShipped, String(order.email), { ...sampled(shipmentData(order, parcel, o)), order_date: confirmed ? iso(confirmed, -1) : iso(at, -2 * 24 * 60), shipped_at: iso(at, -1) }, {
      key: eventKey(TEMPLATES.orderShipped, parcel.id),
      resourceType: "fulfillment",
      resourceId: parcel.id,
      orderId: order.id,
      customerId: order.customer_id ?? null,
      at,
    })
  }

  const customers = (await graphList<CustomerRecord>(scope, "customer", CUSTOMER_FIELDS, [], { has_account: true }, { take: 3, order: { created_at: "DESC" } })).filter((c) => c.email)
  /* The oldest of two or three customers keeps the failed welcome; one customer alone gets a sent one. */
  const failing = customers.length > 1 ? customers.length - 1 : -1
  let slot = 0
  for (const [i, c] of customers.entries()) {
    const at = hoursAgo(i === failing ? SEED_SLOTS.failedWelcome : SEED_SLOTS.welcomes[Math.min(slot++, SEED_SLOTS.welcomes.length - 1)])
    add(TEMPLATES.customerWelcome, String(c.email), { ...sampled(welcomeData(c, o)), customer_since: iso(at, -1) }, {
      key: eventKey(TEMPLATES.customerWelcome, String(c.id)),
      resourceType: "customer",
      resourceId: String(c.id),
      orderId: null,
      customerId: String(c.id),
      at,
      ...(i === failing
        ? {
            status: "failed" as const,
            error: "validation_error: The mail.example.com domain is not verified. Please, add and verify your domain on https://resend.com/domains (a simulated answer: demo mode never calls Resend).",
          }
        : {}),
    })
  }
  return rows
}
