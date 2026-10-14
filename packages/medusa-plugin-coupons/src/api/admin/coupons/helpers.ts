import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CouponInputError } from "../../../workflows/coupons/create"
import { couponsService } from "../../../workflows/coupons/runtime"

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
  try {
    couponsService(req.scope).getLogger().error(`[coupons] ${req.method ?? "GET"} ${String(req.path ?? req.url ?? "").split("?")[0]}: ${(err as Error)?.message ?? String(err)}`)
  } catch {
    /* no logger in tests */
  }
  res.status(500).json({ code: "coupons_unavailable", message: publicMessage })
}
