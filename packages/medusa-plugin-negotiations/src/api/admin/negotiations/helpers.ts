import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminThreadDto } from "../../../workflows/negotiations/read"
import { ActionError, envOf, userNames, type Scope } from "../../../workflows/negotiations/runtime"
import type { MoveResult } from "../../../workflows/negotiations/threads"

type AdminMove = (scope: Scope, args: { id: string; actorId: string | null; body: unknown }) => Promise<MoveResult>

/** A team move on `:id`, answered with the thread after it (`{ thread }`). */
export async function moveAnswer(req: MedusaRequest, res: MedusaResponse, move: AdminMove): Promise<void> {
  await answer(res, async () => {
    const r = await move(req.scope, { id: String(req.params.id ?? ""), actorId: actorOf(req), body: bodyOf(req) })
    return { thread: await adminThreadDto(req.scope, await envOf(req.scope), r.thread) }
  })
}

/** The admin user behind a request (its id), or null. */
export function actorOf(req: MedusaRequest): string | null {
  const id = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } }).auth_context?.actor_id
  return typeof id === "string" && id ? id : null
}

/** The admin user behind a request as a person reads it (the e-mail), for "armed by" and "queued by". */
export async function actorLabel(req: MedusaRequest): Promise<string | null> {
  const id = actorOf(req)
  if (!id) return null
  const names = await userNames(req.scope, [id])
  return names.get(id) ?? id
}

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

/** Runs a route, answering a refusal with its status and stable code. Anything else goes to Medusa's error handler. */
export async function answer(res: MedusaResponse, fn: () => Promise<unknown>, status = 200): Promise<void> {
  try {
    const body = await fn()
    res.status(status).json(body)
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ type: err.status === 404 ? "not_found" : err.status === 400 ? "invalid_data" : "not_allowed", code: err.code, message: err.message, ...err.extra })
      return
    }
    throw err
  }
}
