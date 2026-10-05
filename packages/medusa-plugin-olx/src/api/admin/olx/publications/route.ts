import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OlxPublicationsResponse } from "../../../../modules/olx/lib/contract"
import { toPublicationDto, type PublicationRow } from "../../../../modules/olx/lib/dto"
import { intParam, like, olxService, strParam } from "../helpers"

const VIEWS: Record<string, string[] | null> = {
  plan: ["planned", "blocked", "failed", "quarantined", "unknown", "publishing"],
  ready: ["planned"],
  blocked: ["blocked"],
  problems: ["failed", "quarantined", "unknown"],
  published: ["published"],
  all: null,
}

/**
 * GET /admin/olx/publications?view=plan|ready|blocked|problems|published|all&q=&limit=&offset=
 *
 * The publish plan: per variant what would be sent to OLX (the exact body of
 * POST /adverts) or what is missing, and the adverts published so far.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const view = strParam(req.query.view) || "plan"
  const states = VIEWS[view] === undefined ? VIEWS.plan : VIEWS[view]
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const q = strParam(req.query.q).slice(0, 80)
  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (states) where.state = states
  if (q) {
    const pattern = like(q)
    where.$or = [{ title: { $ilike: pattern } }, { sku: { $ilike: pattern } }]
  }
  const [rows, count] = (await svc.listAndCountOlxPublications(where as never, {
    take: limit,
    skip: offset,
    order: { sku: "ASC" },
  })) as unknown as [PublicationRow[], number]
  const body: OlxPublicationsResponse = { publications: rows.map(toPublicationDto), count, limit, offset }
  res.json(body)
}
