import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { InpostPayApiError } from "../../modules/inpostpay/lib/client"
import { clientIp, createLimiter } from "../../modules/inpostpay/lib/rate-limit"
import { InpostPayFlowError, loggerOf } from "../../workflows/inpostpay/runtime"

/**
 * What the store routes share: per-IP limits in the memory of the process
 * (the same idea as the other Koda Plus store routes) and the error shape
 * `{ code, message }`. Messages are short English sentences; the storefront
 * shows its own text by `code`.
 */

export const limits = {
  bind: createLimiter(30, 10 * 60 * 1000),
  poll: createLimiter(240, 60 * 1000),
  confirm: createLimiter(10, 10 * 60 * 1000),
}

export function limited(req: MedusaRequest, res: MedusaResponse, which: keyof typeof limits): boolean {
  if (!limits[which].limited(clientIp(req as never))) return false
  res.status(429).json({ code: "RATE_LIMITED", message: "Too many requests. Try again in a few minutes." })
  return true
}

export function storeFail(req: MedusaRequest, res: MedusaResponse, e: unknown): void {
  if (e instanceof InpostPayFlowError) {
    res.status(e.status).json({ code: e.code, message: e.message })
    return
  }
  if (e instanceof InpostPayApiError) {
    res.status(502).json({ code: "INPOST_UNAVAILABLE", message: "InPost Pay is not reachable now. Try again in a moment." })
    return
  }
  loggerOf(req.scope).error(`[inpostpay] ${req.method} ${req.path} failed: ${(e as Error)?.message ?? e}`)
  res.status(500).json({ code: "INTERNAL_ERROR", message: "Something went wrong. Try again in a moment." })
}
