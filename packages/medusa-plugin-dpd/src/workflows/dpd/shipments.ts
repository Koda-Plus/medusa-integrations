/**
 * THE SHIPMENT ROWS of the DPD fulfillments. Stage 1 records them and
 * cancels them with their fulfillment; the plan, the waybills, the label and
 * the handover come in the stages that talk to DPD, and they all start from
 * the row recorded here.
 */

import { isDpdProviderId } from "../../modules/dpd/lib/constants"
import type { ProblemDto } from "../../modules/dpd/lib/contract"
import type { ShipmentRow } from "../../modules/dpd/lib/dto"
import { checkMethodData, pickDpdMethod, readFulfillmentData } from "../../modules/dpd/lib/option-data"
import { dpdService, listShipments, loadOrder, recordEvent, storeFor, type Scope } from "./runtime"

/**
 * A fulfillment was created. When its provider is DPD (`dpd_*`), one row is
 * recorded for it: kind outbound, state pending (canceled when the
 * fulfillment already is), with the option and the Pickup point read from
 * the fulfillment data, or, failing that, from the shipping method of the
 * fulfillment's shipping option (the first DPD method when the fulfillment
 * names no option or no method has it).
 *
 * The checkout is not trusted for what may have changed since: Medusa does
 * not check the method again when the address changes, and a claim, an
 * exchange, an order edit or a draft order never checks it. So the country
 * of a courier comes from the order's shipping address (of a Pickup point,
 * from the point id), and the checks of the checkout run again against the
 * order: what fails now is kept in `problems`, for the plan of stage 2.
 *
 * NOTHING GOES TO DPD and nothing personal is kept: the row has no name,
 * phone, e-mail or street (the checks read them and keep only their codes);
 * the plan reads them from the order when it is built. Idempotent: the same
 * fulfillment gives the same row (the unique index on fulfillment, kind and
 * mode refuses a second one). Returns the row, or null for a fulfillment
 * that is not DPD's.
 */
export async function recordFulfillment(scope: Scope, orderId: string, fulfillmentId: string): Promise<ShipmentRow | null> {
  const svc = dpdService(scope)
  const mode = svc.mode()
  const order = await loadOrder(scope, orderId)
  const f = order?.fulfillments?.find((x) => x.id === fulfillmentId)
  if (!order || !f || !isDpdProviderId(f.provider_id)) return null
  const method = pickDpdMethod(order.shipping_methods, f.shipping_option_id)
  const read = readFulfillmentData(f.data ?? null) ?? method?.read ?? null
  if (!read) {
    svc.getLogger().warn(`[dpd] Fulfillment ${fulfillmentId} of order ${orderId} has no DPD option in its data; nothing recorded.`)
    return null
  }
  if (read.spec.kind === "return") {
    /* A return label belongs to a return (order.return_requested, stage 6), never to an outbound fulfillment. */
    svc.getLogger().warn(`[dpd] Fulfillment ${fulfillmentId} of order ${orderId} carries the return option; nothing recorded.`)
    return null
  }
  const [same] = await listShipments(svc, { fulfillment_id: fulfillmentId, kind: "outbound", mode }, { take: 1 })
  if (same) return same
  /* Data in the shape of the shipping option names no point: the method of the same option may. */
  const pudoId = read.pudoId ?? (method && method.read.spec.id === read.spec.id ? method.read.pudoId : null)
  const checked = checkMethodData(
    read.spec,
    { pudo_id: pudoId },
    { currency_code: order.currency_code ?? null, email: order.email ?? null, shipping_address: order.shipping_address ?? {} },
    svc.getOptions(),
  )
  const country = checked.country && /^[A-Z]{2}$/.test(checked.country) ? checked.country : null
  const problems: ProblemDto[] = checked.errors.map((e) => ({ code: e.code, detail: e.message }))
  const inserted = await storeFor(scope).insertIgnore({
    order_id: order.id,
    display_id: typeof order.display_id === "number" ? order.display_id : null,
    fulfillment_id: fulfillmentId,
    return_id: null,
    kind: "outbound",
    mode,
    option_id: read.spec.id,
    service: null,
    pudo_id: pudoId,
    country_code: country,
    session_type: null,
    cod_minor: null,
    currency: order.currency_code ? String(order.currency_code).toUpperCase() : null,
    /* The deterministic reference of D4: DPD has no idempotency key, the fulfillment id is the key. */
    reference: fulfillmentId,
    state: f.canceled_at ? "canceled" : "pending",
    problems: problems.length > 0 ? problems : null,
  })
  /* A second process won the insert: its row is the row. */
  const row = inserted ?? (await listShipments(svc, { fulfillment_id: fulfillmentId, kind: "outbound", mode }, { take: 1 }))[0] ?? null
  if (!inserted || !row) return row
  const codes = problems.map((p) => p.code)
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: "system",
    message:
      row.state === "canceled"
        ? "Recorded from a fulfillment that was already canceled."
        : codes.length > 0
          ? `Recorded from the fulfillment. The checks of the checkout fail on the order now: ${codes.join(", ")}.`
          : "Recorded from the fulfillment.",
    data: { action: "recorded", option: read.spec.id, ...(codes.length > 0 ? { problems: codes } : {}) },
    mode,
  })
  return row
}

/** States in which nothing was sent to DPD yet: the row is canceled with its fulfillment. */
const CANCELABLE: readonly string[] = ["pending", "failed", "skipped"]

/**
 * A fulfillment was canceled in Medusa (order.fulfillment_canceled). Its row
 * of the current mode is canceled when nothing was sent to DPD yet (pending,
 * failed, skipped). A row DPD already knows (creating, created, labeled,
 * unknown...) is left as it is: DPDServices cannot cancel a shipment, so the
 * plugin never pretends it did; the history and the log say so once.
 * Idempotent: a row already canceled is returned as it is, and the history
 * line has a dedupe key. Returns the row, or null when the fulfillment has
 * none.
 */
export async function onFulfillmentCanceled(scope: Scope, fulfillmentId: string): Promise<ShipmentRow | null> {
  const svc = dpdService(scope)
  const mode = svc.mode()
  const [row] = await listShipments(svc, { fulfillment_id: fulfillmentId, kind: "outbound", mode }, { take: 1 })
  if (!row) return null
  if (row.state === "canceled") return row
  const store = storeFor(scope)
  let canceled = await store.transition(row.id, CANCELABLE, { state: "canceled" })
  /* The transition lost to another writer: the row read before is stale, so the log and the history say what it is now. */
  let now = canceled ?? (await listShipments(svc, { id: row.id }, { take: 1 }))[0] ?? row
  /* It moved on and came back to a cancelable state (creating, then failed): one more try, so the row never stays failed beside a canceled fulfillment. */
  if (!canceled && CANCELABLE.includes(now.state)) {
    canceled = await store.transition(row.id, CANCELABLE, { state: "canceled" })
    if (canceled) now = canceled
  }
  if (!canceled && now.state === "canceled") return now
  if (!canceled) {
    svc
      .getLogger()
      .warn(`[dpd] Fulfillment ${fulfillmentId} was canceled, but its DPD shipment ${row.id} is ${now.state}: left as it is. DPD cannot cancel a shipment; stop the parcel with DPD if it should not go.`)
  }
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: "system",
    message: canceled
      ? "The Medusa fulfillment was canceled before anything was sent to DPD: the shipment is canceled with it."
      : `The Medusa fulfillment was canceled, but DPD already has this shipment (${now.state}). It is left as it is: DPD cannot cancel a shipment, so stop the parcel with DPD if it should not go.`,
    data: { action: "fulfillment_canceled", outcome: canceled ? "canceled" : "kept", state: now.state },
    dedupe_key: `fulfillment_canceled:${row.id}`,
    mode,
  })
  return now
}
