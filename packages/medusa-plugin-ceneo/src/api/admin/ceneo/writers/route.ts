import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { WritersResponse } from "../../../../modules/ceneo/lib/contract"
import { ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { armRefusal, isWriterKey, togglePatch } from "../../../../modules/ceneo/lib/writers"
import { setWriter, stateOf, writerDtos, writerRows } from "../../../../workflows/ceneo/import-orders"
import { bodyOf } from "../helpers"

/**
 * GET  /admin/ceneo/writers                  the writers with both switches
 * POST /admin/ceneo/writers { key, armed }   a person arms or disarms one
 *
 * Arming is refused (409, with the reason) while the hard switch is off or
 * something blocks the writer; disarming always works. The row remembers
 * who flipped it, when, and in which mode.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const body: WritersResponse = { writers: await writerDtos(ceneoSvc(req.scope)) }
  res.json(body)
}

async function actorOf(req: AuthenticatedMedusaRequest): Promise<{ name: string | null; id: string | null }> {
  const id = req.auth_context?.actor_id ?? null
  if (!id) return { name: null, id: null }
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({ entity: "user", fields: ["id", "email", "first_name", "last_name"], filters: { id } })
    const u = (data as Array<{ email?: string | null; first_name?: string | null; last_name?: string | null }>)[0]
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || u?.email || null
    return { name, id }
  } catch {
    return { name: null, id }
  }
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const body = bodyOf(req)
  const key = body.key
  if (!isWriterKey(key) || typeof body.armed !== "boolean") {
    res.status(400).json({ code: "invalid", message: "Send { key: orders | status, armed: true | false }." })
    return
  }
  if (body.armed) {
    const refusal = armRefusal(stateOf(svc, key, (await writerRows(svc)).get(key) ?? null))
    if (refusal) {
      res.status(409).json({ code: "refused", message: refusal })
      return
    }
  }
  const actor = await actorOf(req)
  await setWriter(svc, key, togglePatch(body.armed, svc.getOptions().demo ? "demo" : "live", actor, new Date()))
  svc.getLogger().info(`[ceneo] The ${key} writer was ${body.armed ? "armed" : "disarmed"} by ${actor.name ?? actor.id ?? "an admin"}.`)
  const out: WritersResponse = { writers: await writerDtos(svc) }
  res.json(out)
}
