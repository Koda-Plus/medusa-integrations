import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { LogResponse } from "../../../../modules/vonhalsky/lib/contract"
import { toLogDto, vonHalskySvc } from "../../../../modules/vonhalsky/lib/store"
import { intParam } from "../../../vonhalsky/admin-helpers"

const AREAS = ["offers", "orders", "tracking", "settings"]

/** GET /admin/vonhalsky/log?area=&outcome=&limit=: the sync log, newest first (30 days). Read only. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const filters: Record<string, unknown> = {}
  if (AREAS.includes(String(req.query.area))) filters.area = String(req.query.area)
  if (req.query.outcome === "error" || req.query.outcome === "warning") filters.outcome = String(req.query.outcome)
  const limit = intParam(req.query.limit, 50, 1, 200)
  const [rows, count] = await vonHalskySvc(req.scope).listAndCountVonHalskySyncLogs(filters, { take: limit, order: { created_at: "DESC" } })
  const body: LogResponse = { entries: (rows as any[]).map((r) => toLogDto(r)), count: Number(count) || 0 }
  res.json(body)
}
