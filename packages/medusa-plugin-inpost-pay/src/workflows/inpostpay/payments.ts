import type { IPaymentModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { capturePaymentWorkflow } from "@medusajs/medusa/core-flows"
import { eventsOf } from "../../modules/inpostpay/lib/store"
import { optionsOf } from "./runtime"

/**
 * THE MEDUSA PAYMENT OF AN INPOST PAY ORDER. The provider sees only the
 * payment's data, so the plugin writes there what a refund needs (the order
 * id, InPost's payment reference) and captures the payment when InPost
 * reports the money paid.
 */

export interface OrderPayment {
  id: string
  captured: boolean
  canceled: boolean
  data: Record<string, unknown>
}

/** The InPost Pay payments of an order (the plugin's provider only). */
export async function orderPayments(scope: MedusaContainer, orderId: string): Promise<OrderPayment[]> {
  const o = optionsOf(scope)
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as {
    graph(input: { entity: string; fields: string[]; filters: Record<string, unknown> }): Promise<{ data: Array<Record<string, unknown>> }>
  }
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "payment_collections.payments.id", "payment_collections.payments.provider_id", "payment_collections.payments.data", "payment_collections.payments.captured_at", "payment_collections.payments.canceled_at"],
    filters: { id: orderId },
  })
  const collections = (data[0]?.payment_collections ?? []) as Array<{ payments?: Array<Record<string, unknown>> | null } | null>
  return collections
    .flatMap((c) => c?.payments ?? [])
    .filter((p) => p && p.provider_id === o.paymentProviderId)
    .map((p) => ({
      id: String(p.id),
      captured: Boolean(p.captured_at),
      canceled: Boolean(p.canceled_at),
      data: p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : {},
    }))
}

/**
 * Merge fields into the data of the order's InPost Pay payments. The DTO of
 * `updatePayment` names only the id, but the module writes every field it
 * is given (payment-module.js: `paymentService_.update(data)`), so the data
 * goes along; the existing data is kept, the proof with it.
 */
export async function annotatePayments(scope: MedusaContainer, orderId: string, patch: Record<string, unknown>): Promise<number> {
  const payments = await orderPayments(scope, orderId)
  const svc = scope.resolve(Modules.PAYMENT) as IPaymentModuleService
  const update = svc.updatePayment.bind(svc) as unknown as (input: { id: string; data: Record<string, unknown> }) => Promise<unknown>
  for (const p of payments) await update({ id: p.id, data: { ...p.data, ...patch } })
  return payments.length
}

/** Capture the order's InPost Pay payments that are not captured yet. Returns how many were captured. */
export async function capturePaid(scope: MedusaContainer, orderId: string): Promise<number> {
  const open = (await orderPayments(scope, orderId)).filter((p) => !p.captured && !p.canceled)
  for (const p of open) await capturePaymentWorkflow(scope).run({ input: { payment_id: p.id } })
  return open.length
}

/**
 * Whether an InPost event is new: not seen before (`event_id`) and not older
 * than the newest one applied (`event_data_time`). InPost may deliver events
 * twice or out of order; a late PENDING must not undo an AUTHORIZED.
 */
export function eventIsNew(events: unknown, eventId: string, eventTime: number | null): { ok: true } | { ok: false; reason: "duplicate" | "stale" } {
  const seen = eventsOf(events).filter((e) => e.kind === "payment" && e.data)
  if (eventId && seen.some((e) => e.data?.event_id === eventId)) return { ok: false, reason: "duplicate" }
  if (eventTime !== null) {
    const newest = Math.max(-Infinity, ...seen.map((e) => Date.parse(String(e.data?.event_time ?? ""))).filter((t) => Number.isFinite(t)))
    if (eventTime < newest) return { ok: false, reason: "stale" }
  }
  return { ok: true }
}
