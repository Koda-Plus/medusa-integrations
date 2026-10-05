import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REMINDER_MIN_INTERVAL_HOURS } from "../../../../modules/fakturownia/lib/constants"
import type { RemindersResponse } from "../../../../modules/fakturownia/lib/contract"
import { toDate, type EmailRow } from "../../../../modules/fakturownia/lib/dto"
import { ageInDays, canRemind } from "../../../../modules/fakturownia/lib/email"
import { listDocuments } from "../../../../workflows/fakturownia/runtime"
import { documentDto, fakturowniaService, reminderFilters } from "../helpers"

/**
 * GET /admin/fakturownia/reminders
 *
 * Unpaid proformas and VAT invoices issued at least `reminderAfterDays` days
 * ago (default 7), the oldest first, with how many reminders went out and
 * whether another one may go now (at most one a day). Fakturownia's API has
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
      ? ((await svc.listFakturowniaEmails({ document_id: ids, kind: "reminder", status: "sent" } as never, { take: 500, order: { created_at: "DESC" } } as never)) as unknown as EmailRow[])
      : []
  const body: RemindersResponse = {
    afterDays: o.reminderAfterDays,
    count,
    documents: rows.map((r) => {
      const mine = sent.filter((e) => e.document_id === r.id)
      const last = toDate(mine[0]?.created_at)
      return {
        document: documentDto(svc, r),
        ageDays: ageInDays(r.issue_date, now),
        reminders: mine.length,
        lastReminderAt: last ? last.toISOString() : null,
        canRemind: canRemind(last, now, REMINDER_MIN_INTERVAL_HOURS),
      }
    }),
  }
  res.json(body)
}
