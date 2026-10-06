import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { MessageDetailResponse } from "../../../../../modules/emails/lib/contract"
import { toMessageDto } from "../../../../../modules/emails/lib/dto"
import type { MessageRow } from "../../../../../modules/emails/lib/store"
import { actorNames } from "../../../../../workflows/emails/runtime"
import { emailsService } from "../../helpers"

/**
 * GET /admin/emails/messages/:id
 *
 * One message of the current mode. In demo mode with the simulated message
 * itself (HTML and text); live rows never keep the body.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  const rows = (await svc.listEmailsMessages({ id: req.params.id, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as MessageRow[]
  const row = rows[0]
  if (!row) {
    res.status(404).json({ message: "Message not found." })
    return
  }
  const names = await actorNames(req.scope, [row.requested_by])
  const body: MessageDetailResponse = {
    message: toMessageDto(row, names),
    html: row.demo ? row.body_html ?? null : null,
    text: row.demo ? row.body_text ?? null : null,
  }
  res.setHeader("Cache-Control", "private, no-store")
  res.json(body)
}
