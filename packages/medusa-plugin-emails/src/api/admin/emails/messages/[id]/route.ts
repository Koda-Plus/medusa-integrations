import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MessageDetailResponse } from "../../../../../modules/emails/lib/contract"
import { templateLabels, toMessageDto } from "../../../../../modules/emails/lib/dto"
import { historyMessage, type SqlRaw } from "../../../../../modules/emails/lib/medusa-history"
import { resolveTemplate, sensitiveFields } from "../../../../../modules/emails/lib/registry"
import { HIDDEN_LINK, scrubSecrets } from "../../../../../modules/emails/lib/security"
import type { MessageRow } from "../../../../../modules/emails/lib/store"
import { actorNames } from "../../../../../workflows/emails/runtime"
import { emailsService, historySubject, serverError } from "../../helpers"

/**
 * GET /admin/emails/messages/:id
 *
 * One message of the current mode. In demo mode with the simulated message
 * itself (HTML and text); live rows never keep the body. A message with
 * secret fields (the password reset) was kept with them hidden, and one kept
 * by an older version, before it hid them, is not shown at all; anything
 * shaped like a token is taken out of every body on the way out as well.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  try {
    /* App mode: a message of Medusa's history (no body is ever kept for it). */
    if (svc.getOptions().mode === "app" && String(req.params.id).startsWith("noti_")) {
      const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as SqlRaw
      const row = await historyMessage(pg, String(req.params.id), historySubject(svc.getOptions()))
      if (!row) {
        res.status(404).json({ message: "Message not found." })
        return
      }
      const body: MessageDetailResponse = { message: { ...toMessageDto(row, {}, templateLabels(svc.getOptions())), source: "medusa" }, html: null, text: null }
      res.setHeader("Cache-Control", "private, no-store")
      res.json(body)
      return
    }
    const rows = (await svc.listEmailsMessages({ id: req.params.id, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as MessageRow[]
    const row = rows[0]
    if (!row) {
      res.status(404).json({ message: "Message not found." })
      return
    }
    const names = await actorNames(req.scope, [row.requested_by])
    const template = resolveTemplate(row.template, svc.getOptions())
    const sensitive = template ? sensitiveFields(template).length > 0 : false
    let html = row.demo ? scrubSecrets(row.body_html) : null
    let text = row.demo ? scrubSecrets(row.body_text) : null
    /* A sensitive message shows only as this version keeps it, with the link hidden; an older body not at all. */
    if (sensitive && !`${row.body_html ?? ""}${row.body_text ?? ""}`.includes(HIDDEN_LINK)) {
      html = null
      text = null
    }
    const body: MessageDetailResponse = {
      message: toMessageDto(row, names, templateLabels(svc.getOptions())),
      html,
      text,
    }
    res.setHeader("Cache-Control", "private, no-store")
    res.json(body)
  } catch (err) {
    serverError(req, res, err, "The message cannot be read. The server log has the details.", 503)
  }
}
