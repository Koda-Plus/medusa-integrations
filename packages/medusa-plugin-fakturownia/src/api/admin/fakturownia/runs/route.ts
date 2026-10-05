import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { RunsResponse } from "../../../../modules/fakturownia/lib/contract"
import { toRunDto, type RunRow } from "../../../../modules/fakturownia/lib/dto"
import { fakturowniaService, intParam, strParam } from "../helpers"

const KINDS = ["issue", "payments", "statuses"]

/** GET /admin/fakturownia/runs?kind=issue|payments|statuses&limit= : background runs of the current mode, newest first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const kind = strParam(req.query.kind)
  const limit = intParam(req.query.limit, 15, 1, 50)
  const where: Record<string, unknown> = { source: svc.isDemo() ? "demo" : "api" }
  if (KINDS.includes(kind)) where.kind = kind
  const rows = (await svc.listFakturowniaSyncRuns(where as never, { take: limit, order: { started_at: "DESC" } } as never)) as unknown as RunRow[]
  const body: RunsResponse = { runs: rows.map(toRunDto) }
  res.json(body)
}
