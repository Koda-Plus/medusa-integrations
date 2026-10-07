import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DocumentFilter, DocumentsResponse } from "../../../../modules/fakturownia/lib/contract"
import type { DocumentRow } from "../../../../modules/fakturownia/lib/dto"
import { queryOf } from "../../../../workflows/fakturownia/runtime"
import { DOCUMENT_FILTERS, documentDto, documentFilters, fakturowniaService, intParam, like, strParam, withAlternatives } from "../helpers"

const ORDER_ID = /^order_[A-Za-z0-9]{1,60}$/
const CUSTOMER_ID = /^cus_[A-Za-z0-9]{1,60}$/

/** The orders of a customer (the newest 500), read by id: the documents of a customer card. */
async function ordersOfCustomer(scope: MedusaRequest["scope"], customerId: string): Promise<string[]> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id"], filters: { customer_id: customerId }, pagination: { take: 500, order: { created_at: "DESC" } } })
  return (data as Array<{ id?: string }>).map((o) => o.id).filter((id): id is string => typeof id === "string")
}

/**
 * GET /admin/fakturownia/documents?filter=&q=&order_id=&number=&limit=&offset=
 *
 * The documents of the current mode, newest first. Reads the database only.
 *
 *   filter    all (default), pending, issued, attention, unpaid, ksef,
 *             canceled, corrections
 *   q         the document number ("FV 12/10/2026", or a part of it), the
 *             order number (`1042` or `#1042`), a Medusa order id or a
 *             Fakturownia document id
 *   order_id  exact: one or more Medusa order ids, comma separated (up to 50)
 *   number    exact: the document number as Fakturownia printed it
 *   customer_id  the documents of a customer's orders (their newest 500)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const raw = strParam(req.query.filter) as DocumentFilter
  const filter: DocumentFilter = DOCUMENT_FILTERS.includes(raw) ? raw : "all"
  const q = strParam(req.query.q).slice(0, 80)
  const orderIds = strParam(req.query.order_id)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ORDER_ID.test(s))
    .slice(0, 50)
  const number = strParam(req.query.number).slice(0, 100)
  const customerId = strParam(req.query.customer_id)

  let where = documentFilters(filter, svc.isDemo())
  if (CUSTOMER_ID.test(customerId)) {
    const ofCustomer = await ordersOfCustomer(req.scope, customerId)
    const asked = orderIds.length > 0 ? orderIds.filter((id) => ofCustomer.includes(id)) : ofCustomer
    if (asked.length === 0) {
      const empty: DocumentsResponse = { documents: [], count: 0, limit, offset }
      res.json(empty)
      return
    }
    where.order_id = asked
  } else if (orderIds.length > 0) where.order_id = orderIds
  if (number) where.number = number
  if (q) {
    const bare = q.replace(/^#/, "")
    const or: Array<Record<string, unknown>> = [{ number: { $ilike: like(q) } }]
    if (/^\d+$/.test(bare)) {
      const n = Number(bare)
      if (Number.isSafeInteger(n) && n < 2_147_483_647) or.push({ display_id: n })
      or.push({ fakturownia_id: bare })
    }
    if (ORDER_ID.test(q)) or.push({ order_id: q })
    where = withAlternatives(where, or)
  }

  const [rows, count] = (await svc.listAndCountFakturowniaDocuments(where as never, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  } as never)) as unknown as [DocumentRow[], number]
  const body: DocumentsResponse = { documents: rows.map((r) => documentDto(svc, r)), count, limit, offset }
  res.json(body)
}
