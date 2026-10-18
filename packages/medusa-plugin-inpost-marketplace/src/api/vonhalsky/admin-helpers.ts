import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { OptionLite } from "../../modules/vonhalsky/lib/contract"
import { VonHalskyFlowError } from "../../modules/vonhalsky/lib/errors"

/** What the admin routes share: the error answer, the lists for the settings, the ids of a body. */

/** Runs a flow and answers its refusal as JSON ({ code, message }) with its status. */
export async function respond(res: MedusaResponse, fn: () => Promise<unknown>): Promise<void> {
  try {
    res.json(await fn())
  } catch (e) {
    if (e instanceof VonHalskyFlowError) {
      res.status(e.status).json({ code: e.code, message: e.message })
      return
    }
    throw e
  }
}

/** Offer or order row ids from a body: `{ ids: [...] }`, at most 200, our prefixes only. */
export function idsOf(body: unknown, prefix: "vhoff" | "vhord"): string[] {
  const list = body && typeof body === "object" ? (body as { ids?: unknown }).ids : undefined
  if (!Array.isArray(list)) return []
  const re = new RegExp(`^${prefix}_[A-Za-z0-9]+$`)
  return [...new Set(list.filter((x): x is string => typeof x === "string" && re.test(x)))].slice(0, 200)
}

function queryOf(req: MedusaRequest): any {
  return req.scope.resolve(ContainerRegistrationKeys.QUERY)
}

export async function shippingOptionsOfStore(req: MedusaRequest): Promise<Array<OptionLite & { provider_id: string | null }>> {
  try {
    const { data } = await queryOf(req).graph({ entity: "shipping_option", fields: ["id", "name", "provider_id"], pagination: { take: 200 } })
    return (data as any[]).map((o) => ({ id: String(o.id), name: String(o.name ?? o.id), provider_id: o.provider_id ?? null }))
  } catch {
    return []
  }
}

export async function salesChannelsOfStore(req: MedusaRequest): Promise<OptionLite[]> {
  try {
    const { data } = await queryOf(req).graph({ entity: "sales_channel", fields: ["id", "name"], pagination: { take: 200 } })
    return (data as any[]).map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }))
  } catch {
    return []
  }
}

export async function regionsOfStore(req: MedusaRequest): Promise<Array<OptionLite & { currency: string }>> {
  try {
    const { data } = await queryOf(req).graph({ entity: "region", fields: ["id", "name", "currency_code"], pagination: { take: 100 } })
    return (data as any[]).map((r) => ({ id: String(r.id), name: String(r.name ?? r.id), currency: String(r.currency_code ?? "").toLowerCase() }))
  } catch {
    return []
  }
}

/** A number from the query string, clamped. */
export function intParam(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(Array.isArray(v) ? v[0] : v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** A short search text from the query string (letters, digits and a few separators). */
export function searchParam(v: unknown): string {
  const s = String(Array.isArray(v) ? v[0] : v ?? "").trim().slice(0, 100)
  return s.replace(/[%_\\]/g, "")
}
