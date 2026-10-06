import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { MessageFilter, MessagesResponse } from "../../../../modules/emails/lib/contract"
import { toMessageDto } from "../../../../modules/emails/lib/dto"
import type { MessageRow } from "../../../../modules/emails/lib/store"
import { actorNames } from "../../../../workflows/emails/runtime"
import { emailsService, intParam, like, messageFilters, strParam } from "../helpers"

const FILTERS: MessageFilter[] = ["all", "sent", "attention", "skipped", "test"]

/** Columns of a list row: everything but the stored bodies. */
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
 * GET /admin/emails/messages?filter=all|sent|attention|skipped|test&template=&q=&order_id=&limit=&offset=
 *
 * The send log of the current mode, newest first, recipients masked. In demo
 * mode this is the simulated outbox. `order_id` gives the messages of one
 * order (its confirmation, shipments, cancellation).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const filterParam = strParam(req.query.filter) as MessageFilter
  const where: Record<string, unknown> = messageFilters(FILTERS.includes(filterParam) ? filterParam : "all", svc.isDemo())
  const template = strParam(req.query.template)
  if (template) where.template = template.slice(0, 64)
  const orderId = strParam(req.query.order_id)
  if (orderId) where.order_id = orderId.slice(0, 80)
  const q = strParam(req.query.q).slice(0, 80)
  if (q) where.$or = [{ subject: { $ilike: like(q) } }, { recipient: { $ilike: like(q) } }, { template: { $ilike: like(q) } }, { order_id: q }]
  try {
    const [rows, count] = (await svc.listAndCountEmailsMessages(where as never, {
      take: limit,
      skip: offset,
      order: { created_at: "DESC" },
      select: LIST_SELECT,
    } as never)) as unknown as [MessageRow[], number]
    const names = await actorNames(req.scope, rows.map((r) => r.requested_by))
    const body: MessagesResponse = { messages: rows.map((r) => toMessageDto(r, names)), count, limit, offset }
    res.json(body)
  } catch (err) {
    res.status(503).json({ message: `The send log cannot be read (did the migrations run?): ${svc.mask((err as Error)?.message ?? String(err))}` })
  }
}
