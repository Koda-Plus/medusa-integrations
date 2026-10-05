import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { EmailsResponse } from "../../../../modules/fakturownia/lib/contract"
import { toEmailDto, type EmailRow } from "../../../../modules/fakturownia/lib/dto"
import { actorNames, listDocuments } from "../../../../workflows/fakturownia/runtime"
import { fakturowniaService, intParam, strParam } from "../helpers"

const KINDS = ["auto", "manual", "reminder"]

/**
 * GET /admin/fakturownia/emails?kind=auto|manual|reminder&limit=&offset=
 *
 * The e-mails the plugin asked Fakturownia to send, newest first, across
 * documents, with the addresses masked. In demo mode this is the simulated
 * mailbox: what would have gone out, nothing that did. Reads the database only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const limit = intParam(req.query.limit, 10, 1, 50)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const kind = strParam(req.query.kind)
  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (KINDS.includes(kind)) where.kind = kind
  const [rows, count] = (await svc.listAndCountFakturowniaEmails(where as never, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  } as never)) as unknown as [EmailRow[], number]
  const ids = [...new Set(rows.map((r) => r.document_id))]
  const docs = ids.length > 0 ? await listDocuments(svc, { id: ids }, { take: ids.length, select: ["id", "number", "display_id"] }) : []
  const names = await actorNames(req.scope, rows.map((r) => r.requested_by))
  const body: EmailsResponse = {
    emails: rows.map((r) => toEmailDto(r, docs.find((d) => d.id === r.document_id) ?? null, names)),
    count,
    limit,
    offset,
  }
  res.json(body)
}
