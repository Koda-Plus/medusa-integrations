import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runDraftOrders } from "../../../../../workflows/negotiations/draft-orders"
import { answer, bodyOf } from "../../helpers"

/**
 * POST /admin/negotiations/writers/run
 *
 * `{ dry_run?: boolean }`: a dry run answers with the plan and writes
 * nothing; otherwise the armed writer creates the queued draft orders now,
 * at most `draftOrders.maxPerRun` of them (409 `writer_off` when it is not
 * armed).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await answer(res, async () => runDraftOrders(req.scope, { dryRun: bodyOf(req).dry_run === true, trigger: "manual" }))
}
