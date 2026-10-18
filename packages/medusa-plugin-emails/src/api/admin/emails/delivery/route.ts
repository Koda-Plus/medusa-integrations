import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { BouncesResponse } from "../../../../modules/emails/lib/contract"
import { deliveryReader, domainTypo } from "../../../../modules/emails/lib/delivery"
import { templateLabels, toMessageDto } from "../../../../modules/emails/lib/dto"
import { lastHistoryByAddress, type SqlRaw } from "../../../../modules/emails/lib/medusa-history"
import { emailsService, historySubject, serverError } from "../helpers"

/**
 * GET /admin/emails/delivery?fresh=1
 *
 * The addresses Resend no longer sends to (its suppression list: bounces,
 * complaints, manual), newest first, each with its last message in this
 * store and a corrected address when the domain is a known typo
 * (gmial.com -> gmail.com). Read only (GET /suppressions with the option
 * deliveryKey); { configured: false } without it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  const o = svc.getOptions()
  res.setHeader("Cache-Control", "private, no-store")
  const reader = deliveryReader(o.deliveryKey)
  if (!reader) {
    const body: BouncesResponse = { configured: false, readAt: null, error: null, addresses: [] }
    res.json(body)
    return
  }
  try {
    const sup = await reader.suppressions((req.query as Record<string, unknown>).fresh === "1")
    const pg = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as SqlRaw
    const last = o.mode === "app" ? await lastHistoryByAddress(pg, sup.list.map((x) => x.email), historySubject(o), o.showAddresses).catch(() => new Map()) : new Map()
    const labels = templateLabels(o)
    /* The message that caused each block (Resend source_id): its subject and tags, for the campaign. */
    const details = new Map<string, Awaited<ReturnType<typeof reader.detail>>>()
    for (const x of sup.list) if (x.sourceId && !details.has(x.sourceId)) details.set(x.sourceId, await reader.detail(x.sourceId).catch(() => null))
    const campaignOf = (tags: Array<{ name: string; value: string }> | undefined) => {
      const c = o.campaigns.find((k) => k.tag && (tags ?? []).some((t) => t.name === k.tag!.name && t.value === k.tag!.value))
      return c ? { key: c.key, label: c.label } : null
    }
    const body: BouncesResponse = {
      configured: true,
      readAt: sup.readAt,
      error: sup.error,
      addresses: sup.list.map((x) => {
        const m = last.get(x.email)
        return {
          email: o.showAddresses ? x.email : x.email.replace(/^(.).*(@.*)$/, "$1***$2"),
          origin: x.origin,
          since: x.createdAt,
          typo: domainTypo(x.email),
          subject: (x.sourceId ? details.get(x.sourceId)?.subject : null) ?? m?.subject ?? null,
          campaign: x.sourceId ? campaignOf(details.get(x.sourceId)?.tags) : null,
          sourceId: x.sourceId,
          resendUrl: x.sourceId ? `https://resend.com/emails/${encodeURIComponent(x.sourceId)}` : null,
          lastMessage: m ? { ...toMessageDto(m, {}, labels), source: m.source } : null,
        }
      }),
    }
    res.json(body)
  } catch (err) {
    serverError(req, res, err, "The delivery state cannot be read. The server log has the details.", 503)
  }
}
