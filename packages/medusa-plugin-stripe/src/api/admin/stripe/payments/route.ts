import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { METHOD_KEYS } from "../../../../modules/stripe/lib/constants"
import type { MethodKey, PaymentFilter, StripePaymentsResponse } from "../../../../modules/stripe/lib/contract"
import { PAYMENT_FILTERS, paymentsPage } from "../../../../workflows/stripe/overview"
import { loadSnapshot } from "../../../../workflows/stripe/snapshot"
import { intParam, originOf, respond, strParam, stripeService } from "../helpers"

/**
 * GET /admin/stripe/payments?filter=all|succeeded|failed|attention|refunded|disputed|outside|foreign&method=blik&q=&offset=0&limit=20
 *
 * The payments of the last 30 days, a page at a time, from the same cached
 * read as the panel (no extra call to Stripe). `q` matches a PaymentIntent
 * id, an order number (#1042), a card's last four digits or a Przelewy24
 * reference.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respond(req, res, async (): Promise<StripePaymentsResponse> => {
    const q = req.query as Record<string, unknown>
    const filterRaw = strParam(q.filter) as PaymentFilter
    const methodRaw = strParam(q.method) as MethodKey
    const filter = PAYMENT_FILTERS.includes(filterRaw) ? filterRaw : "all"
    const method = METHOD_KEYS.includes(methodRaw) ? methodRaw : "all"
    const offset = intParam(q.offset, 0, 0, 100_000)
    const limit = intParam(q.limit, 20, 1, 100)
    if (!stripeService(req.scope).isConfigured()) {
      return { payments: [], count: 0, offset, limit, fetchedAt: null, counts: Object.fromEntries(PAYMENT_FILTERS.map((f) => [f, 0])) as Record<PaymentFilter, number>, methods: {} }
    }
    const { snapshot } = await loadSnapshot(req.scope, { origin: originOf(req) })
    return paymentsPage(snapshot, { filter, method, q: strParam(q.q).slice(0, 100), offset, limit })
  })
}
