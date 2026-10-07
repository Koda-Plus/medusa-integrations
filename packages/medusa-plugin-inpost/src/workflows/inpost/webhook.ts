/**
 * A SHIPX WEBHOOK DELIVERY, after the route checked its secret and answered
 * 200 (ShipX wants a quick answer; this runs in the background).
 *
 *   1. demo mode: ignored (nothing real is tracked)
 *   2. another organization: ignored
 *   3. the delivery key is recorded once (unique index); a repeated
 *      delivery stops here
 *   4. the shipment is READ FROM SHIPX with the plugin's own token: the body
 *      only says which one changed, so a forged call changes nothing
 *   5. the status is applied (compare and set): events and the follow ups
 *      happen once, whether the webhook or the status pass came first
 */

import type { WebhookCall } from "../../modules/inpost/lib/webhook"
import { applyShipment } from "./parcels"
import { clientFor, inpostService, listParcels, recordEvent, storeFor, type Scope } from "./runtime"

export type WebhookOutcome = "demo" | "foreign" | "duplicate" | "unmatched" | "applied" | "error"

export async function handleWebhookCall(scope: Scope, call: WebhookCall): Promise<WebhookOutcome> {
  const svc = inpostService(scope)
  const o = svc.getOptions()
  if (o.demo) return "demo"
  if (call.organizationId && o.organizationId && call.organizationId !== o.organizationId) {
    svc.getLogger().warn(`[inpost] Webhook of another organization (${call.organizationId}) ignored.`)
    return "foreign"
  }
  const store = storeFor(scope)
  const [row] = await listParcels(svc, { shipment_id: call.shipmentId, demo: false }, { take: 1 })
  const receipt = await store.insertEvent({
    parcel_id: row?.id ?? null,
    order_id: row?.order_id ?? null,
    shipment_id: call.shipmentId,
    kind: "webhook",
    status: call.status,
    source: "webhook",
    message: `${call.event}${call.status ? `: ${call.status}` : ""}`,
    data: { event: call.event, event_ts: call.eventTs },
    dedupe_key: call.key,
    demo: false,
  })
  if (!receipt) return "duplicate"
  await store.setSetting("webhook:last", { at: new Date().toISOString(), event: call.event, status: call.status }, null).catch(() => null)
  if (!row) return "unmatched"
  try {
    const shipment = await clientFor(scope).getShipment(call.shipmentId)
    await applyShipment(scope, row, shipment, "webhook")
    return "applied"
  } catch (err) {
    await recordEvent(scope, {
      parcel_id: row.id,
      order_id: row.order_id,
      shipment_id: call.shipmentId,
      kind: "action",
      source: "webhook",
      message: `The shipment could not be read after the webhook; the status pass reads it again. ${(err as Error)?.message ?? ""}`.trim(),
      data: { action: "webhook_read", outcome: "error" },
      demo: false,
    })
    return "error"
  }
}
