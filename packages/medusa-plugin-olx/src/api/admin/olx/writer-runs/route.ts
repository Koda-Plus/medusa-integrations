import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isWriterKey } from "../../../../modules/olx/lib/constants"
import type { OlxWriterRunsResponse } from "../../../../modules/olx/lib/contract"
import { toWriterRunDto, type WriterRunRow } from "../../../../modules/olx/lib/dto"
import { intParam, olxService, strParam } from "../helpers"

/** GET /admin/olx/writer-runs?writer=&limit= : the latest dry and applied runs, newest first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const writer = strParam(req.query.writer)
  const limit = intParam(req.query.limit, 10, 1, 50)
  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (isWriterKey(writer)) where.writer = writer
  const rows = (await svc.listOlxWriterRuns(where as never, { take: limit, order: { started_at: "DESC" } })) as unknown as WriterRunRow[]
  const body: OlxWriterRunsResponse = { runs: rows.map(toWriterRunDto) }
  res.json(body)
}
