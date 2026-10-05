import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ArmResponse } from "../../../../../modules/baselinker/lib/contract"
import { canArm, isWriterKey, writerState } from "../../../../../modules/baselinker/lib/writers"
import { loadWriters, setArm } from "../../../../../workflows/baselinker/settings"
import { actorOf, baselinkerService, buildStatus, toWriterDto } from "../../helpers"

/**
 * POST /admin/baselinker/writers/:key  { "armed": true | false }
 *
 * Arms or disarms one writer, recording who and when. Arming is refused when
 * the plugin options switch the writer off (`writers.<key>: false`, or
 * `stockSync` other than "write" for the stock writers): the options win.
 * Disarming is always allowed. In demo mode the arms belong to the
 * simulation and never carry over to a real account.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const key = req.params.key
  if (!isWriterKey(key)) {
    res.status(404).json({ message: `Unknown writer ${key}.` })
    return
  }
  const armed = (req.body as { armed?: unknown } | undefined)?.armed
  if (typeof armed !== "boolean") {
    res.status(400).json({ message: "`armed` must be true or false." })
    return
  }
  if (armed) {
    const verdict = canArm(writerState((await loadWriters(svc)).writers, key))
    if (!verdict.ok) {
      res.status(409).json({
        message:
          verdict.reason === "stock_not_write"
            ? 'Stock writers need stockSync: "write" in the plugin options. The options win over the admin.'
            : `The plugin options switch this writer off (writers.${key}: false). The options win over the admin.`,
      })
      return
    }
  }
  await setArm(svc, key, armed, await actorOf(req))
  const { writers } = await loadWriters(svc)
  const body: ArmResponse = { writer: toWriterDto(writerState(writers, key)), status: await buildStatus(svc) }
  res.json(body)
}
