import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isWriterKey } from "../../../../../modules/olx/lib/constants"
import { canArm, toggleKey, type WriterToggle } from "../../../../../modules/olx/lib/writers"
import { writerSwitch } from "../../../../../workflows/olx/run-writer"
import { setState } from "../../../../../workflows/olx/runtime"
import { actorOf, bodyOf, buildStatus, olxService } from "../../helpers"

const REFUSALS: Record<string, string> = {
  config_off:
    "This writer is turned off in the plugin options (lifecycleWriter, priceWriter or publishWriter). The option wins; change it in medusa-config and restart.",
  not_connected: "Connect the OLX account first.",
  no_write_scope:
    "The OLX token has no write scope. Allow the writer in the plugin options, restart, then connect the account again so the consent asks for write access.",
}

/**
 * POST /admin/olx/writers/:writer  { armed: boolean }
 *
 * The runtime switch of one writer (lifecycle, price, publish), stored with
 * who flipped it and when. Arming needs the option on and, in live mode, a
 * connected account whose token carries the `write` scope. Disarming always
 * works and takes effect before the next item.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const writer = req.params.writer
  if (!isWriterKey(writer)) {
    res.status(404).json({ message: `Unknown writer: ${String(writer).slice(0, 40)}.` })
    return
  }
  const armed = bodyOf(req).armed === true
  const demo = svc.isDemo()
  if (armed) {
    const sw = await writerSwitch(svc, writer)
    const verdict = canArm({
      allowedByConfig: svc.getOptions().writers[writer],
      demo,
      connected: sw.connected,
      writeScope: sw.writeScope,
    })
    if (!verdict.ok) {
      res.status(409).json({ message: REFUSALS[verdict.code] ?? verdict.code, code: verdict.code })
      return
    }
  }
  const toggle: WriterToggle = { armed, changedBy: await actorOf(req), changedAt: new Date().toISOString() }
  await setState(svc, toggleKey(writer, demo), toggle)
  svc.getLogger().info(`[olx] ${writer} writer ${armed ? "armed" : "disarmed"} by ${toggle.changedBy ?? "unknown"}`)
  res.json(await buildStatus(svc))
}
