import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isRetryable } from "../../../modules/tasks/lib/store"
import { contextOf, type AuthLike, type RequestContext } from "../../../workflows/tasks/context"
import { ActionError } from "../../../workflows/tasks/runtime"

/** The admin user or secret API key behind a request (Medusa's own `/admin` authentication sets it). */
export function authOf(req: MedusaRequest): AuthLike | null {
  return (req as MedusaRequest & { auth_context?: AuthLike }).auth_context ?? null
}

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

export function queryOf(req: MedusaRequest): Record<string, unknown> {
  const q = req.query as unknown
  return q && typeof q === "object" ? (q as Record<string, unknown>) : {}
}

export function paramOf(req: MedusaRequest, name: string): string {
  const v = (req.params as Record<string, unknown> | undefined)?.[name]
  return typeof v === "string" ? v : ""
}

/** An error for the server log: one line, secrets and connection strings masked, cut at 500 characters. */
export function maskedError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return text
    .replace(/\b(sk|pk|rk)_[A-Za-z0-9]{6,}/g, "$1_***")
    .replace(/(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 ***")
    .replace(/(postgres(?:ql)?|redis):\/\/[^@\s]*@/gi, "$1://***@")
    .replace(/\s+/g, " ")
    .slice(0, 500)
}

/**
 * Runs a route, answering a refusal with its status and stable code. A
 * transaction Postgres broke off twice (deadlock, serialization) answers 409
 * `conflict_retry`: send the same request again. Anything else answers a
 * plain 500 without the exception's text (SQL, stack); the details go to the
 * server log, masked.
 */
export async function answer(res: MedusaResponse, fn: () => Promise<unknown>, status = 200, req?: MedusaRequest): Promise<void> {
  try {
    const body = await fn()
    res.status(status).json(body)
  } catch (err) {
    if (err instanceof ActionError) {
      const type =
        err.status === 404 ? "not_found" : err.status === 400 ? "invalid_data" : err.status === 401 ? "unauthorized" : err.status === 503 ? "unexpected_state" : "not_allowed"
      res.status(err.status).json({ type, code: err.code, message: err.message, ...err.extra })
      return
    }
    if (isRetryable(err)) {
      res.status(409).json({ type: "conflict", code: "conflict_retry", message: "The board changed at the same moment. Send the same request again." })
      return
    }
    try {
      const logger = req?.scope.resolve("logger") as { error: (m: string) => void } | undefined
      logger?.error(`[tasks] ${req?.method ?? ""} ${String(req?.originalUrl ?? req?.url ?? "").split("?")[0]} failed: ${maskedError(err)}`)
    } catch {
      /* no logger in this scope */
    }
    res.status(500).json({ type: "unknown_error", code: "server_error", message: "The task board could not finish this request. Try again; the details are in the server log." })
  }
}

/**
 * Every route of the plugin: the request context first (who asks, which
 * board), then the route's work on that board only.
 */
export async function onBoard(req: MedusaRequest, res: MedusaResponse, fn: (ctx: RequestContext) => Promise<unknown>, status = 200): Promise<void> {
  await answer(
    res,
    async () => {
      const ctx = await contextOf(req.scope, authOf(req), req.body)
      return fn(ctx)
    },
    status,
    req,
  )
}
