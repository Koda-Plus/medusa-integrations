import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { WritersResponse } from "../../../../modules/dpd/lib/contract"
import { isWriterKey, WRITER_OPTION, writerSettingKey } from "../../../../modules/dpd/lib/writers"
import { storeFor, writerStates } from "../../../../workflows/dpd/runtime"
import { actorOf, bodyOf, dpdService, refuse, sendError, writersDto } from "../helpers"

/**
 * POST /admin/dpd/writers  { "writer": "shipment" | "pickup" | "fulfillmentStatus", "armed": true }  ->  WritersResponse
 *
 * Arms or disarms one writer in the current mode, stored with who did it and
 * when (the toggle of one mode never arms another). Arming a writer the
 * options turn off (`shipmentWriter`, `pickupWriter`,
 * `fulfillmentStatusWriter` not true) is refused with 409 writer_off: the
 * option is the hard switch. Disarming is always allowed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = dpdService(req.scope)
    const o = svc.getOptions()
    const input = bodyOf(req)
    if (!isWriterKey(input.writer)) {
      refuse(res, 400, "writer_unknown", "writer is one of shipment, pickup, fulfillmentStatus.")
      return
    }
    if (typeof input.armed !== "boolean") {
      refuse(res, 400, "invalid", "Send { writer, armed: true or false }.")
      return
    }
    const writer = input.writer
    if (input.armed && !o.writers[writer]) {
      refuse(res, 409, "writer_off", `This writer is turned off in the plugin options (${WRITER_OPTION[writer]} is not true); the admin cannot arm it.`)
      return
    }
    const mode = svc.mode()
    const current = (await writerStates(svc))[writer]
    if (current.on !== input.armed) {
      const actor = actorOf(req)
      await storeFor(req.scope).setSetting(writerSettingKey(writer, mode), { on: input.armed }, actor)
      svc.getLogger().info(`[dpd] writer ${writer} ${input.armed ? "armed" : "disarmed"} (${mode}) by ${actor ?? "unknown"}`)
    }
    const body: WritersResponse = { writers: await writersDto(req.scope) }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
