import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { RunningResponse } from "../../../../modules/baselinker/lib/contract"
import { demoPrepared } from "../../../../workflows/baselinker/demo"
import { activeRunKinds } from "../../../../workflows/baselinker/runtime"
import { baselinkerService, guarded } from "../helpers"

/**
 * GET /admin/baselinker/running
 *
 * What runs right now in any process of the store (the job leases), and in
 * demo mode whether the snapshot exists. Two small reads: the page polls it
 * every few seconds while a run is under way, and asks for the full status
 * only when the answer changes. Never writes.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const [running, prepared] = await Promise.all([activeRunKinds(svc), svc.isDemo() ? demoPrepared(svc) : Promise.resolve(null)])
  const body: RunningResponse = { running, demoPrepared: prepared }
  res.json(body)
})
