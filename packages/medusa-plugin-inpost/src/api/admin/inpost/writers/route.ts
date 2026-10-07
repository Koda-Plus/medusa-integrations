import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isWriterKey, WRITER_OPTION, writerSettingKey } from "../../../../modules/inpost/lib/writers"
import { storeFor, writerStates } from "../../../../workflows/inpost/runtime"
import { actorOf, bodyOf, buildStatus, inpostService, sendError } from "../helpers"

/**
 * POST /admin/inpost/writers  { "writer": "shipment" | "fulfillmentStatus", "on": true }
 *
 * Arms or disarms a writer in the current mode, stored with who did it and
 * when. Arming a writer the options turn off (`shipmentWriter`,
 * `fulfillmentStatusWriter` not true) is refused: the option is the hard
 * switch. Answers the whole status.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const o = svc.getOptions()
    const input = bodyOf(req)
    if (!isWriterKey(input.writer) || typeof input.on !== "boolean") {
      res.status(400).json({ code: "invalid", message: "Send { writer: \"shipment\" | \"fulfillmentStatus\", on: true | false }." })
      return
    }
    const writer = input.writer
    if (input.on && !o.writers[writer]) {
      res.status(409).json({ code: "writer_off", message: `This writer is turned off in the plugin options (${WRITER_OPTION[writer]} is not true); the admin cannot arm it.` })
      return
    }
    const current = (await writerStates(svc))[writer]
    if (current.on !== input.on) {
      await storeFor(req.scope).setSetting(writerSettingKey(writer, o.demo), { on: input.on }, actorOf(req))
      svc.getLogger().info(`[inpost] writer ${writer} ${input.on ? "armed" : "disarmed"} (${o.demo ? "demo" : "live"}) by ${actorOf(req) ?? "unknown"}`)
    }
    res.json(await buildStatus(req))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
