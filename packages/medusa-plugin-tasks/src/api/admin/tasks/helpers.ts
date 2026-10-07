import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
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

/** Runs a route, answering a refusal with its status and stable code. Anything else goes to Medusa's error handler. */
export async function answer(res: MedusaResponse, fn: () => Promise<unknown>, status = 200): Promise<void> {
  try {
    const body = await fn()
    res.status(status).json(body)
  } catch (err) {
    if (err instanceof ActionError) {
      const type = err.status === 404 ? "not_found" : err.status === 400 ? "invalid_data" : err.status === 401 ? "unauthorized" : "not_allowed"
      res.status(err.status).json({ type, code: err.code, message: err.message, ...err.extra })
      return
    }
    throw err
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
  )
}
