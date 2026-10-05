import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { WritersDto } from "../../../../modules/fakturownia/lib/contract"
import { isWriterKey, writerSettingKey, writerState } from "../../../../modules/fakturownia/lib/writers"
import { kickIssue } from "../../../../workflows/fakturownia/documents"
import { planStoreFor, writerStates } from "../../../../workflows/fakturownia/runtime"
import { actorOf, fakturowniaService, writersDto } from "../helpers"

/**
 * POST /admin/fakturownia/writers  { "writer": "corrections" | "emails" | "ksef", "on": true }
 *
 * The runtime toggle of a writer, stored with who flipped it and when (apart
 * for demo and live mode). Turning on a writer that the options turned off
 * (`writers.<name>: false`, or `corrections: "off"`) is refused: the option
 * is the hard switch. Turning the corrections writer on starts a pass of the
 * outbox, so approved corrections go out right away.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const o = svc.getOptions()
  const input = (req.body ?? {}) as { writer?: unknown; on?: unknown }
  if (!isWriterKey(input.writer) || typeof input.on !== "boolean") {
    res.status(400).json({ message: "Send { writer: \"corrections\" | \"emails\" | \"ksef\", on: true | false }." })
    return
  }
  const writer = input.writer
  const current = (await writerStates(svc))[writer]
  if (input.on && !writerState(writer, o, null).allowed) {
    res.status(409).json({
      message:
        writer === "corrections" && o.corrections === "off"
          ? "Corrections are off in the plugin options (corrections: \"off\")."
          : `This writer is turned off in the plugin options (writers.${writer}: false); the admin cannot turn it on.`,
    })
    return
  }
  if (current.on !== input.on) {
    await planStoreFor(req.scope).setSetting(writerSettingKey(writer, o.demo), { on: input.on }, actorOf(req))
    svc.getLogger().info(`[fakturownia] writer ${writer} turned ${input.on ? "on" : "off"} by ${actorOf(req) ?? "unknown"}`)
    if (writer === "corrections" && input.on) kickIssue(req.scope, "manual")
  }
  const body: { writers: WritersDto } = { writers: await writersDto(req.scope) }
  res.json(body)
}
