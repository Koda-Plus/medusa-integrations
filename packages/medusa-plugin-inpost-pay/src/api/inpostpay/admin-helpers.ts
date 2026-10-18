import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ShippingOptionLite } from "../../modules/inpostpay/lib/contract"

/** What the admin routes share: the public backend address, the shipping options, the payment provider. */

/** The address InPost reaches the backend at: the `backendUrl` option, else the address of this admin request. */
export function backendUrlOf(req: MedusaRequest, configured: string | null): string {
  if (configured) return configured
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() || (req as unknown as { protocol?: string }).protocol || "https"
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0]?.trim()
  return host ? `${proto}://${host}` : ""
}

export async function shippingOptionsOfStore(req: MedusaRequest): Promise<ShippingOptionLite[]> {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "shipping_option", fields: ["id", "name", "provider_id"], pagination: { take: 200 } })
    return (data as any[]).map((o) => ({ id: String(o.id), name: String(o.name ?? o.id), provider_id: o.provider_id ?? null }))
  } catch {
    return []
  }
}

export async function providerState(req: MedusaRequest, id: string): Promise<{ registered: boolean; enabled: boolean }> {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "payment_provider", fields: ["id", "is_enabled"], filters: { id } })
    const row = (data as any[])[0]
    return { registered: Boolean(row), enabled: Boolean(row?.is_enabled) }
  } catch {
    return { registered: false, enabled: false }
  }
}

export async function displayIds(req: MedusaRequest, orderIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (orderIds.length === 0) return out
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "order", fields: ["id", "display_id"], filters: { id: orderIds } })
    for (const o of data as any[]) if (Number.isFinite(Number(o.display_id))) out.set(String(o.id), Number(o.display_id))
  } catch {
    /* the list still shows the ids */
  }
  return out
}

/** Order ids of an order number ("#1042" or "1042"). */
export async function ordersByNumber(req: MedusaRequest, q: string): Promise<string[]> {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "order", fields: ["id"], filters: { display_id: Number(q.replace("#", "")) } })
    return (data as any[]).map((o) => String(o.id))
  } catch {
    return []
  }
}
