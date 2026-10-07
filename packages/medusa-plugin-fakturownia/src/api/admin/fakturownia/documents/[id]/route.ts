import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DocumentDetailResponse } from "../../../../../modules/fakturownia/lib/contract"
import { toEmailDto, toKsefEventDto, type EmailRow, type KsefEventRow } from "../../../../../modules/fakturownia/lib/dto"
import { actorNames, getDocument, listDocuments, listPlans } from "../../../../../workflows/fakturownia/runtime"
import { documentDto, fakturowniaService, planDtos, writersDto } from "../../helpers"

/**
 * GET /admin/fakturownia/documents/:id
 *
 * One document for the drawer of the admin: its KSeF history (every status
 * the plugin saw, every "send again"), its e-mail history (addresses
 * masked), its corrections and correction plans, and the writer switches.
 * Reads the database only, never writes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const row = await getDocument(svc, req.params.id)
  if (!row || Boolean(row.demo) !== svc.isDemo()) {
    res.status(404).json({ message: "Document not found." })
    return
  }
  const [ksef, emails, corrections, corrected, plans] = await Promise.all([
    svc.listFakturowniaKsefEvents({ document_id: row.id } as never, { take: 50, order: { created_at: "DESC" } } as never) as unknown as Promise<KsefEventRow[]>,
    svc.listFakturowniaEmails({ document_id: row.id } as never, { take: 50, order: { created_at: "DESC" } } as never) as unknown as Promise<EmailRow[]>,
    listDocuments(svc, { corrects_document_id: row.id, kind: "correction" }, { take: 50, order: { created_at: "ASC" } }),
    row.kind === "correction" && row.corrects_document_id ? getDocument(svc, row.corrects_document_id) : Promise.resolve(null),
    row.kind === "correction"
      ? row.plan_id
        ? listPlans(svc, { id: row.plan_id }, { take: 1 })
        : Promise.resolve([])
      : listPlans(svc, { document_id: row.id, status: { $ne: "obsolete" } }, { take: 50, order: { created_at: "DESC" } }),
  ])
  const names = await actorNames(req.scope, [...ksef.map((k) => k.requested_by), ...emails.map((e) => e.requested_by)])
  const body: DocumentDetailResponse = {
    document: documentDto(svc, row),
    ksef: ksef.map((k) => toKsefEventDto(k, names)),
    emails: emails.map((e) => toEmailDto(e, row, names)),
    corrections: corrections.map((c) => documentDto(svc, c)),
    corrected: corrected ? documentDto(svc, corrected) : null,
    plans: await planDtos(req.scope, plans),
    writers: await writersDto(req.scope),
  }
  res.json(body)
}
