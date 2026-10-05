import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isWriterKey } from "../../../../../../modules/olx/lib/constants"
import type { OlxWriterRunResponse } from "../../../../../../modules/olx/lib/contract"
import { isWriterRunning, runOlxWriter, writerSwitch } from "../../../../../../workflows/olx/run-writer"
import { runOlxWriterWorkflow } from "../../../../../../workflows/olx/workflows"
import { actorOf, bodyOf, olxService } from "../../../helpers"

/**
 * POST /admin/olx/writers/:writer/run  { dryRun?: boolean, overrideGuard?: boolean }
 *
 * A dry run answers right away with what the writer would send (nothing goes
 * out). An applied run needs the writer armed; it starts in the background
 * (202) and the admin polls the status. `overrideGuard` lets a person run a
 * lifecycle plan the mass guard holds, for this one run.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const writer = req.params.writer
  if (!isWriterKey(writer)) {
    res.status(404).json({ message: `Unknown writer: ${String(writer).slice(0, 40)}.` })
    return
  }
  const body = bodyOf(req)
  const dryRun = body.dryRun === true
  const actor = await actorOf(req)
  if (isWriterRunning(writer)) {
    const answer: OlxWriterRunResponse = { started: false, alreadyRunning: true, run: null }
    res.status(202).json(answer)
    return
  }
  if (dryRun) {
    const run = await runOlxWriter(req.scope, { writer, dryRun: true, trigger: "manual", actor })
    const answer: OlxWriterRunResponse = { started: Boolean(run), alreadyRunning: !run, run }
    res.json(answer)
    return
  }
  const sw = await writerSwitch(svc, writer)
  if (!sw.state.active) {
    res.status(409).json({ message: `The ${writer} writer is not armed (${sw.state.blockers.join(", ")}).`, blockers: sw.state.blockers })
    return
  }
  void runOlxWriterWorkflow(req.scope)
    .run({ input: { writer, trigger: "manual", actor, overrideGuard: body.overrideGuard === true } })
    .catch((err: unknown) => svc.getLogger().error(`[olx] ${writer} writer: ${svc.mask(err instanceof Error ? err.message : String(err))}`))
  const answer: OlxWriterRunResponse = { started: true, alreadyRunning: false, run: null }
  res.status(202).json(answer)
}
