import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StatusResponse } from "../../../modules/inpostpay/lib/contract"
import { mask, missingOptions } from "../../../modules/inpostpay/lib/options"
import { inpostPaySvc, PAYMENT_PROBLEMS, readSettings } from "../../../modules/inpostpay/lib/store"
import { optionsOf } from "../../../workflows/inpostpay/runtime"
import { backendUrlOf, providerState, shippingOptionsOfStore } from "../../inpostpay/admin-helpers"

/**
 * GET /admin/inpostpay: the page in one read: the mode, the options in use
 * (secrets masked), the addresses to paste into the merchant portal, the
 * settings, the payment provider, the shipping options and the counters.
 * Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const o = optionsOf(req.scope)
  const svc = inpostPaySvc(req.scope)
  const count = async (filters: Record<string, unknown>) => {
    try {
      const [, n] = await svc.listAndCountInpostPayBaskets(filters, { take: 1 })
      return Number(n) || 0
    } catch {
      return 0
    }
  }
  const [baskets, linked, orders, failed, paymentProblems] = await Promise.all([
    count({}),
    count({ status: ["linked", "ordered"] }),
    count({ status: "ordered" }),
    count({ status: "failed" }),
    count({ payment_status: [...PAYMENT_PROBLEMS] }),
  ])
  let lastEventAt: string | null = null
  try {
    const [newest] = await svc.listInpostPayBaskets({}, { take: 1, order: { updated_at: "DESC" } })
    lastEventAt = newest?.updated_at ? new Date(newest.updated_at).toISOString() : null
  } catch {
    lastEventAt = null
  }
  const backend = backendUrlOf(req, o.backendUrl)
  const body: StatusResponse = {
    mode: o.mode,
    configured: o.mode !== "off",
    demo: o.demo,
    sandbox: o.sandbox,
    missing: missingOptions(o),
    problems: o.problems,
    options: {
      clientId: o.clientId,
      clientSecret: mask(o.clientSecret),
      merchantClientId: o.merchantClientId,
      posId: o.posId,
      paymentProviderId: o.paymentProviderId,
      storefrontUrl: o.storefrontUrl,
      sendOrderEvents: o.sendOrderEvents,
      basketTtlHours: o.basketTtlHours,
    },
    urls: { merchantApi: backend ? `${backend}/inpostpay` : "/inpostpay", api: o.apiUrl, widget: o.widgetUrl },
    settings: await readSettings(req.scope),
    provider: { id: o.paymentProviderId, ...(await providerState(req, o.paymentProviderId)) },
    shippingOptions: await shippingOptionsOfStore(req),
    counts: { baskets, linked, orders, failed, payment_problems: paymentProblems, conversion: baskets > 0 ? Math.round((orders / baskets) * 100) : 0 },
    lastEventAt,
  }
  res.setHeader("Cache-Control", "no-store, must-revalidate")
  res.json(body)
}
