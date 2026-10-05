import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ALERT_KINDS, type AlertKind } from "../../../../modules/olx/lib/alerts"
import type { OlxAlertsResponse } from "../../../../modules/olx/lib/contract"
import { toAlertDto, type AlertRow } from "../../../../modules/olx/lib/dto"
import { intParam, like, olxService, strParam } from "../helpers"

/**
 * GET /admin/olx/alerts?kind=&q=&limit=&offset=
 *
 * Where OLX and the store disagree, from the last plan. `kind`: all,
 * live_sold_out, live_unpublished, stock_not_live, stock_not_listed.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const kind = strParam(req.query.kind) as AlertKind
  const q = strParam(req.query.q).slice(0, 80)
  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (ALERT_KINDS.includes(kind)) where.kind = kind
  if (q) {
    const pattern = like(q)
    where.$or = [{ product_title: { $ilike: pattern } }, { sku: { $ilike: pattern } }, { advert_title: { $ilike: pattern } }, { olx_id: { $ilike: pattern } }]
  }
  const [rows, count] = (await svc.listAndCountOlxAlerts(where as never, {
    take: limit,
    skip: offset,
    order: { kind: "ASC", product_title: "ASC" },
  })) as unknown as [AlertRow[], number]
  const body: OlxAlertsResponse = { alerts: rows.map(toAlertDto), count, limit, offset }
  res.json(body)
}
