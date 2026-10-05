import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { olxUrls } from "../../../../modules/olx/lib/constants"
import type { OlxThreadsResponse } from "../../../../modules/olx/lib/contract"
import { toThreadDto, type AdvertRow, type ThreadRow } from "../../../../modules/olx/lib/dto"
import { intParam, olxService, strParam } from "../helpers"

/**
 * GET /admin/olx/threads?filter=unread|all&limit=&offset=
 *
 * Message threads as counts, newest first, with the advert and the linked
 * product. No message text: the conversation is read on OLX (`chatUrl`).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const demo = svc.isDemo()
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const where: Record<string, unknown> = { demo }
  if (strParam(req.query.filter) !== "all") where.unread_count = { $gt: 0 }
  const [rows, count] = (await svc.listAndCountOlxThreads(where as never, {
    take: limit,
    skip: offset,
    order: { unread_count: "DESC", olx_created_at: "DESC" },
  })) as unknown as [ThreadRow[], number]
  const advertIds = [...new Set(rows.map((r) => r.advert_olx_id).filter((x): x is string => Boolean(x)))]
  const adverts =
    advertIds.length > 0
      ? ((await svc.listOlxAdverts({ demo, olx_id: advertIds } as never, {
          take: null,
          select: ["olx_id", "title", "url", "product_id", "product_title", "sku"],
        })) as unknown as AdvertRow[])
      : []
  const byId = new Map(adverts.map((a) => [a.olx_id, a]))
  const body: OlxThreadsResponse = {
    threads: rows.map((r) => toThreadDto(r, r.advert_olx_id ? byId.get(r.advert_olx_id) ?? null : null)),
    count,
    limit,
    offset,
    chatUrl: olxUrls(svc.getOptions().market).chat,
  }
  res.json(body)
}
