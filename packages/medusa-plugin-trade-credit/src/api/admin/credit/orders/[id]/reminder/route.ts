import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { creditSvc } from "../../../../../../modules/credit/lib/store"
import type { ReminderPreviewResponse } from "../../../../../../modules/credit/lib/contract"
import { fail } from "../../../../../credit/helpers"

/**
 * Store mode: a payment reminder for one order on credit, sent from the page.
 *
 * GET  /admin/credit/orders/:id/reminder  the e-mail before it is sent (to, subject, the rendered body).
 * POST /admin/credit/orders/:id/reminder  sends it. The store renders and sends its own e-mail and
 *                                         records it, so its schedule does not send the same stage again.
 */
function reminderOf(req: MedusaRequest) {
  return creditSvc(req.scope).getOptions?.()?.store?.reminder ?? null
}

function orderIdOf(req: MedusaRequest): string | null {
  const id = String(req.params.id ?? "")
  return /^[A-Za-z0-9_]{1,80}$/.test(id) ? id : null
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const reminder = reminderOf(req)
  const id = orderIdOf(req)
  if (!reminder) return fail(res, 404, "not_supported", "This store sends no reminders from the credit page.")
  if (!id) return fail(res, 400, "invalid_order", "The order id is not valid.")
  try {
    const p = await reminder.preview(req.scope, id)
    const body: ReminderPreviewResponse = { to: p.to, subject: p.subject, html: p.html, stage: p.stage, warning: p.warning ?? null }
    res.setHeader("Cache-Control", "no-store")
    res.json(body)
  } catch (err) {
    fail(res, 400, "reminder_unavailable", (err as Error)?.message || "The reminder cannot be prepared.")
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const reminder = reminderOf(req)
  const id = orderIdOf(req)
  if (!reminder) return fail(res, 404, "not_supported", "This store sends no reminders from the credit page.")
  if (!id) return fail(res, 400, "invalid_order", "The order id is not valid.")
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } | null }).auth_context
  try {
    const sent = await reminder.send(req.scope, id, { id: typeof ctx?.actor_id === "string" ? ctx.actor_id : null })
    res.json({ sent: true, stage: sent.stage })
  } catch (err) {
    fail(res, 400, "reminder_not_sent", (err as Error)?.message || "The reminder was not sent.")
  }
}
