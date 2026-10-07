import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MESSAGE_FILTERS, type MessageFilter, type MessagesResponse } from "../../../../modules/emails/lib/contract"
import { templateLabels, toMessageDto } from "../../../../modules/emails/lib/dto"
import { addressHash, customerIdOf } from "../../../../modules/emails/lib/keys"
import { isEmail } from "../../../../modules/emails/lib/security"
import type { MessageRow } from "../../../../modules/emails/lib/store"
import { actorNames, graphOne } from "../../../../workflows/emails/runtime"
import { emailsService, intParam, like, messageFilters, serverError, sinceOf, strParam } from "../helpers"

/** Columns of a list row: everything but the stored bodies and the address hash. */
const LIST_SELECT = [
  "id",
  "key",
  "template",
  "locale",
  "demo",
  "kind",
  "status",
  "recipient",
  "subject",
  "trigger",
  "resource_type",
  "resource_id",
  "order_id",
  "customer_id",
  "external_id",
  "rotation",
  "attempts",
  "error_code",
  "error",
  "retryable",
  "sent_at",
  "requested_by",
  "created_at",
  "updated_at",
]

/**
 * GET /admin/emails/messages?filter=all|sent|attention|skipped|test|bounced&since=24h|7d|30d&template=&q=&order_id=&customer_id=&limit=&offset=
 *
 * The send log of the current mode, newest first, recipients masked. In demo
 * mode this is the simulated outbox.
 *
 *   order_id      the messages of one order (its confirmation, shipments, cancellation)
 *   customer_id   the messages of one customer: by the customer id, and by
 *                 the hash of the customer's address (orders placed as a guest)
 *   q             a search in the subject and the template; a full e-mail
 *                 address finds the messages to that address (by its hash)
 *   since         the last 24 hours, 7 days or 30 days (the board counters count 7)
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const filterParam = strParam(req.query.filter) as MessageFilter
  const where: Record<string, unknown> = messageFilters(MESSAGE_FILTERS.includes(filterParam) ? filterParam : "all", svc.isDemo())
  const and: Array<Record<string, unknown>> = []
  const template = strParam(req.query.template)
  if (template) where.template = template.slice(0, 64)
  const orderId = strParam(req.query.order_id)
  if (orderId) where.order_id = orderId.slice(0, 80)
  const since = sinceOf(req.query.since)
  if (since) where.created_at = { $gte: since }
  try {
    const customerId = customerIdOf(strParam(req.query.customer_id))
    if (strParam(req.query.customer_id) && !customerId) {
      res.status(400).json({ code: "invalid_customer_id", message: "customer_id is a Medusa customer id (cus_...)." })
      return
    }
    if (customerId) {
      const customer = await graphOne<{ email?: string | null }>(req.scope, "customer", ["id", "email"], [], { id: customerId }).catch(() => null)
      const email = String(customer?.email ?? "").trim()
      and.push({ $or: [{ customer_id: customerId }, ...(isEmail(email) ? [{ recipient_hash: addressHash(email) }] : [])] })
    }
    const q = strParam(req.query.q).slice(0, 254)
    if (q && isEmail(q)) where.recipient_hash = addressHash(q)
    else if (q) and.push({ $or: [{ subject: { $ilike: like(q.slice(0, 80)) } }, { template: { $ilike: like(q.slice(0, 80)) } }, { order_id: q.slice(0, 80) }, { resource_id: q.slice(0, 80) }] })
    if (and.length > 0) where.$and = and
    const [rows, count] = (await svc.listAndCountEmailsMessages(where as never, {
      take: limit,
      skip: offset,
      order: { created_at: "DESC" },
      select: LIST_SELECT,
    } as never)) as unknown as [MessageRow[], number]
    const names = await actorNames(req.scope, rows.map((r) => r.requested_by))
    const labels = templateLabels(svc.getOptions())
    const body: MessagesResponse = { messages: rows.map((r) => toMessageDto(r, names, labels)), count, limit, offset }
    res.json(body)
  } catch (err) {
    serverError(req, res, err, "The send log cannot be read. Did the migrations run (npx medusa db:migrate)? The server log has the details.", 503)
  }
}
