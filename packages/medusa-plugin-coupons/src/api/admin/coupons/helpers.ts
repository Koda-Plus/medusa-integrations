import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CouponInputError } from "../../../workflows/coupons/errors"
import { couponsService } from "../../../workflows/coupons/runtime"
import { Modules } from "@medusajs/framework/utils"

/* Only files named `route.ts` register routes; this one is a helper. */

export function idParam(req: MedusaRequest): string {
  const id = String((req.params as Record<string, string> | undefined)?.id ?? "")
  return /^[A-Za-z0-9_]{1,80}$/.test(id) ? id : ""
}

/** An error of a route: a plain sentence and the creator's error keys, the details only in the server log. */
export function fail(req: MedusaRequest, res: MedusaResponse, err: unknown, publicMessage: string): void {
  if (err instanceof CouponInputError) {
    res.status(err.status).json({ code: "coupon_invalid", message: err.message, errors: err.errors })
    return
  }
  /* Medusa's own checks (e.g. a limit below the uses so far): its words, as a 400. */
  const type = (err as { type?: unknown })?.type
  if (type === "invalid_data" || type === "not_allowed") {
    res.status(400).json({ code: "coupon_invalid", message: (err as Error).message, errors: [] })
    return
  }
  try {
    couponsService(req.scope).getLogger().error(`[coupons] ${req.method ?? "GET"} ${String(req.path ?? req.url ?? "").split("?")[0]}: ${(err as Error)?.message ?? String(err)}`)
  } catch {
    /* no logger in tests */
  }
  res.status(500).json({ code: "coupons_unavailable", message: publicMessage })
}

/**
 * The panel user who made a coupon (create, copy), kept in the promotion's
 * metadata `created_by_label` (name, else e-mail) for the list. Never throws:
 * a coupon without it simply shows no author.
 */
export async function stampCreator(req: MedusaRequest, promotionId: string): Promise<string | null> {
  try {
    const actor = (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context?.actor_id
    if (!actor || !promotionId) return null
    const users = req.scope.resolve(Modules.USER) as unknown as { retrieveUser(id: string): Promise<{ email?: string | null; first_name?: string | null; last_name?: string | null }> }
    const u = await users.retrieveUser(actor)
    const name = [u.first_name, u.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ").trim()
    const label = name || u.email || null
    if (!label) return null
    const promotions = req.scope.resolve(Modules.PROMOTION) as unknown as {
      listPromotions(f: Record<string, unknown>, c?: Record<string, unknown>): Promise<Array<{ id: string; metadata?: Record<string, unknown> | null }>>
      updatePromotions(d: Record<string, unknown>): Promise<unknown>
    }
    const [p] = await promotions.listPromotions({ id: promotionId }, { select: ["id", "metadata"], take: 1 })
    if (!p) return null
    await promotions.updatePromotions({ id: promotionId, metadata: { ...(p.metadata ?? {}), created_by_label: label } })
    return label
  } catch {
    return null
  }
}
