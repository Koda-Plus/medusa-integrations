import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CpcResponse } from "../../../../modules/ceneo/lib/contract"
import { cleanPromo, toGrosze, type BidKind } from "../../../../modules/ceneo/lib/cpc"
import { toBidDto } from "../../../../modules/ceneo/lib/order-dto"
import { ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { BID_FIELDS, setTargets, type TargetInput } from "../../../../workflows/ceneo/cpc"
import { bodyOf, intParam, likeOf, strParam } from "../helpers"

/**
 * GET  /admin/ceneo/cpc?limit=&offset=&q=
 *      The product rows of the current mode (bid, plan, top 10, promotion
 *      text), `q` on the offer id or the name, plus every category row.
 *
 * POST /admin/ceneo/cpc { items: [{ kind, key, targetBid? | targetBidPln?, promoText? }] }
 *      `targetBid` in grosze, an integer (25 is 0.25 PLN); `targetBidPln`
 *      in PLN as a string ("0.25"); null clears. Promotion texts at most
 *      30 characters, null removes. The plan is recomputed now; Ceneo gets
 *      nothing until the bids or promotion writer runs. At most 200 items.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const demo = svc.getOptions().demo
  const limit = intParam(req.query.limit, 25, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const q = strParam(req.query.q)
  const filters: Record<string, unknown> = { demo, kind: "product" }
  if (q) filters.$or = [{ key: { $ilike: likeOf(q) } }, { name: { $ilike: likeOf(q) } }]
  const [[rows, count], categories] = await Promise.all([
    svc.listAndCountCeneoBids(filters, { take: limit, skip: offset, order: { key: "ASC" }, select: BID_FIELDS }),
    svc.listCeneoBids({ demo, kind: "category" }, { take: 200, order: { key: "ASC" }, select: BID_FIELDS }),
  ])
  const body: CpcResponse = { rows: rows.map(toBidDto), count, limit, offset, categories: categories.map(toBidDto) }
  res.json(body)
}

const KEY = /^[A-Za-z0-9._\-/]{1,200}$/

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const raw = bodyOf(req).items
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) {
    res.status(400).json({ code: "invalid", message: "Send { items: [...] } with 1 to 200 items." })
    return
  }
  const items: TargetInput[] = []
  for (const it of raw) {
    const r = it && typeof it === "object" ? (it as Record<string, unknown>) : {}
    const kind: BidKind | null = r.kind === "product" || r.kind === "category" ? r.kind : null
    const key = typeof r.key === "string" ? r.key.trim() : ""
    if (!kind || !KEY.test(key) || (kind === "category" && !/^\d{1,9}$/.test(key))) {
      res.status(400).json({ code: "invalid", message: "Every item needs kind (product or category) and a key (an offer id, or a numeric Ceneo category id)." })
      return
    }
    const out: TargetInput = { kind, key }
    if ("targetBid" in r && "targetBidPln" in r) {
      res.status(400).json({ code: "invalid", message: `Send targetBid (grosze) or targetBidPln (PLN) for ${key}, not both.` })
      return
    }
    if ("targetBid" in r || "targetBidPln" in r) {
      const raw = "targetBid" in r ? r.targetBid : r.targetBidPln
      if (raw === null) out.targetBid = null
      else {
        /* One unit per field: grosze as an integer, PLN as a string. Never guessed from the type. */
        const gr = "targetBid" in r ? (typeof raw === "number" && Number.isInteger(raw) ? raw : null) : typeof raw === "string" ? toGrosze(raw) : null
        if (gr === null || gr < 0 || gr > 100_000) {
          res.status(400).json({ code: "invalid", message: "targetBid" in r ? `targetBid of ${key} must be whole grosze from 0 to 100000.` : `targetBidPln of ${key} must be PLN as a string, from "0" to "1000".` })
          return
        }
        out.targetBid = gr
      }
    }
    if ("promoText" in r) {
      const p = cleanPromo(r.promoText)
      if (!p.ok) {
        res.status(400).json({ code: "invalid", message: `The promotion text of ${key} is longer than 30 characters.` })
        return
      }
      out.promoText = p.value
    }
    items.push(out)
  }
  const n = await setTargets(req.scope, items, req.auth_context?.actor_id ?? null)
  res.json({ updated: n })
}
