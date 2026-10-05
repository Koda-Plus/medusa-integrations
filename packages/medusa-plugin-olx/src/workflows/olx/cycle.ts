/**
 * THE CYCLE AFTER A SYNC AND EVERY 15 MINUTES: plan (alerts and the three
 * plans), then every writer that is armed applies at most its cap. A writer
 * that is off costs nothing here: no request, no run in the history.
 */

import { WRITERS } from "../../modules/olx/lib/constants"
import type { OlxWriterRunDto } from "../../modules/olx/lib/contract"
import { runOlxPlan, type PlanResult } from "./plan"
import { runOlxWriter, writerError, writerIsActive } from "./run-writer"
import { olxServiceOf, type Scope } from "./runtime"

export interface CycleResult {
  plan: PlanResult
  runs: OlxWriterRunDto[]
}

export async function runOlxCycle(scope: Scope, input: { trigger?: "schedule" | "manual" | "auto" } = {}): Promise<CycleResult> {
  const svc = olxServiceOf(scope)
  const trigger = input.trigger ?? "schedule"
  const plan = await runOlxPlan(scope, { trigger })
  const runs: OlxWriterRunDto[] = []
  if (plan.skipped) return { plan, runs }
  for (const writer of WRITERS) {
    try {
      if (!(await writerIsActive(svc, writer))) continue
      const run = await runOlxWriter(scope, { writer, trigger: trigger === "manual" ? "auto" : trigger })
      if (run) runs.push(run)
    } catch (err) {
      svc.getLogger().error(`[olx] ${writer} writer: ${writerError(svc, err)}`)
    }
  }
  return { plan, runs }
}
