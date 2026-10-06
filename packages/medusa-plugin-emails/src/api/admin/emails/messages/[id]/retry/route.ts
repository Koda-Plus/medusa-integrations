import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { RetryResponse } from "../../../../../../modules/emails/lib/contract"
import { canRetry, toMessageDto } from "../../../../../../modules/emails/lib/dto"
import type { MessageRow } from "../../../../../../modules/emails/lib/store"
import { retryMessage } from "../../../../../../workflows/emails/events"
import { actorNames } from "../../../../../../workflows/emails/runtime"
import { actorOf, emailsService } from "../../../helpers"

/**
 * POST /admin/emails/messages/:id/retry
 *
 * Sends a failed (or unknown, or skipped) message of a built-in event
 * template again: the data is read again from the order, parcel, customer or
 * cart, the provider takes the row over and Resend gets a fresh key. A
 * message that may have gone out (unknown) can reach the customer twice; the
 * admin asks before it calls this.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  const find = async (): Promise<MessageRow | null> =>
    ((await svc.listEmailsMessages({ id: req.params.id, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as MessageRow[])[0] ?? null
  const row = await find()
  if (!row) {
    res.status(404).json({ message: "Message not found." })
    return
  }
  if (!canRetry(row)) {
    res.status(409).json({ message: "This message cannot be sent again from the admin: only failed messages of the order, shipment, cancellation, welcome and cart templates can." })
    return
  }
  const actor = actorOf(req)
  const outcome = await retryMessage(req.scope, row, actor)
  svc.getLogger().info(`[emails] Retry of ${row.template} (${row.id}) by ${actor ?? "unknown"}: ${outcome.status}`)
  const after = await find()
  const names = await actorNames(req.scope, [after?.requested_by])
  const body: RetryResponse = { outcome: outcome.status, message: after ? toMessageDto(after, names) : null }
  if (outcome.status === "sent") {
    res.json(body)
    return
  }
  const reason =
    outcome.status === "disabled"
      ? "The template is turned off."
      : outcome.status === "no_provider"
        ? "Medusa's notification module is not available."
        : "reason" in outcome
          ? outcome.reason
          : outcome.status
  res.status(outcome.status === "failed" ? 502 : 409).json({ ...body, message: reason })
}
