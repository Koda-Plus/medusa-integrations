import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REMINDER_MIN_INTERVAL_HOURS } from "../../../../modules/fakturownia/lib/constants"
import type { ReminderRefusal, RemindersResponse } from "../../../../modules/fakturownia/lib/contract"
import { toDate, type EmailRow } from "../../../../modules/fakturownia/lib/dto"
import { ageInDays, canRemind } from "../../../../modules/fakturownia/lib/email"
import { listDocuments } from "../../../../workflows/fakturownia/runtime"
import { documentDto, fakturowniaService, reminderFilters } from "../helpers"

const REFUSALS: readonly ReminderRefusal[] = ["paid_in_medusa", "paid_in_fakturownia", "fakturownia_unreachable"]

function refusalReason(v: string | null | undefined): ReminderRefusal | null {
  return REFUSALS.includes(v as ReminderRefusal) ? (v as ReminderRefusal) : null
}

/**
 * GET /admin/fakturownia/reminders
 *
 * Unpaid proformas and VAT invoices issued at least `reminderAfterDays` days
 * ago (default 7), the oldest first, with how many reminders went out and
 * whether another one may go now (at most one a day), and the last reminder
 * the gate refused since then, with its reason (0.4.0: a reminder needs
 * Medusa and Fakturownia to agree the document is unpaid). Fakturownia's API has
 * no reminder call: "Send a reminder" e-mails the document again (POST
 * .../documents/:id/email with kind "reminder"). Reads the database only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const o = svc.getOptions()
  const now = new Date()
  const where = reminderFilters(svc.isDemo(), o.reminderAfterDays, now)
  const rows = await listDocuments(svc, where, { take: 50, order: { issue_date: "ASC" } })
  const [, count] = (await svc.listAndCountFakturowniaDocuments(where as never, { take: 1, select: ["id"] } as never)) as unknown as [unknown, number]
  const ids = rows.map((r) => r.id)
  const sent =
    ids.length > 0
      ? ((await svc.listFakturowniaEmails({ document_id: ids, kind: "reminder", status: ["sent", "refused"] } as never, { take: 1000, order: { created_at: "DESC" } } as never)) as unknown as EmailRow[])
      : []
  const body: RemindersResponse = {
    afterDays: o.reminderAfterDays,
    count,
    documents: rows.map((r) => {
      const all = sent.filter((e) => e.document_id === r.id)
      const mine = all.filter((e) => e.status === "sent")
      const last = toDate(mine[0]?.created_at)
      /* The newest row first: a refusal counts while no reminder went out after it. */
      const refusal = all[0]?.status === "refused" ? all[0] : null
      return {
        document: documentDto(svc, r),
        ageDays: ageInDays(r.issue_date, now),
        reminders: mine.length,
        lastReminderAt: last ? last.toISOString() : null,
        canRemind: canRemind(last, now, REMINDER_MIN_INTERVAL_HOURS),
        lastRefusal: refusal ? { at: toDate(refusal.created_at)?.toISOString() ?? null, reason: refusalReason(refusal.reason), message: refusal.error ?? null } : null,
      }
    }),
  }
  res.json(body)
}
