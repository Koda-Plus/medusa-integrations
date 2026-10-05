import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { WRITERS } from "../../../../../modules/olx/lib/constants"
import { toggleKey, type WriterToggle } from "../../../../../modules/olx/lib/writers"
import { runOlxCycle } from "../../../../../workflows/olx/cycle"
import { runOlxStats } from "../../../../../workflows/olx/refresh-stats"
import { chunks, setState } from "../../../../../workflows/olx/runtime"
import { isSyncRunning } from "../../../../../workflows/olx/run-sync"
import { syncOlxAdvertsWorkflow } from "../../../../../workflows/olx/sync-olx-adverts"
import { runOlxThreads } from "../../../../../workflows/olx/sync-threads"
import { actorOf, buildStatus, olxService } from "../../helpers"

/**
 * POST /admin/olx/demo/reset
 *
 * DEMO MODE ONLY: forgets what the demo writers did (plan rows, publications,
 * writer runs, armed toggles) and rebuilds the simulated account, so the next
 * visitor sees the whole story again. Never touches real rows.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  if (!svc.isDemo()) {
    res.status(409).json({ message: "Only the demo mode can be reset." })
    return
  }
  if (isSyncRunning()) {
    res.status(409).json({ message: "A sync is running. Try again in a moment." })
    return
  }
  const actor = await actorOf(req)
  const items = (await svc.listOlxPlanItems({ demo: true } as never, { take: null, select: ["id"] })) as unknown as Array<{ id: string }>
  for (const part of chunks(items.map((r) => r.id), 200)) await svc.deleteOlxPlanItems(part)
  const pubs = (await svc.listOlxPublications({ demo: true } as never, { take: null, select: ["id"] })) as unknown as Array<{ id: string }>
  for (const part of chunks(pubs.map((r) => r.id), 200)) await svc.deleteOlxPublications(part)
  const runs = (await svc.listOlxWriterRuns({ demo: true } as never, { take: null, select: ["id"] })) as unknown as Array<{ id: string }>
  for (const part of chunks(runs.map((r) => r.id), 200)) await svc.deleteOlxWriterRuns(part)
  for (const writer of WRITERS) {
    await setState(svc, toggleKey(writer, true), { armed: false, changedBy: actor ?? "demo reset", changedAt: new Date().toISOString() } satisfies WriterToggle)
  }
  await syncOlxAdvertsWorkflow(req.scope).run({ input: { trigger: "manual" } })
  await runOlxCycle(req.scope, { trigger: "auto" })
  await runOlxStats(req.scope, { trigger: "auto" })
  await runOlxThreads(req.scope, { trigger: "auto" })
  res.json(await buildStatus(svc))
}
