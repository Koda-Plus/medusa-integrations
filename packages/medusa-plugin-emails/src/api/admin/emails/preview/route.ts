import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sanitizeCopyOverrides, type CopyOverrides } from "../../../../modules/emails/lib/copy-overrides"
import type { PreviewResponse, PreviewSource } from "../../../../modules/emails/lib/contract"
import { normalizeLocale } from "../../../../modules/emails/lib/locale"
import { resolveTemplate } from "../../../../modules/emails/lib/registry"
import { RenderError } from "../../../../modules/emails/lib/render"
import { renderPreview } from "../../../../workflows/emails/preview"
import { emailsService, serverError, strParam } from "../helpers"

/**
 * GET /admin/emails/preview?template=order.placed&locale=pl|en&theme=light|dark&source=sample|latest[&copy={...}]
 *
 * One template rendered exactly as the provider would (the options and the
 * branding of the admin), on its sample data or on the store's newest order
 * or cart with the person replaced by the sample one. A GET on purpose:
 * previewing never changes anything, so read-only accounts can use it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  const o = svc.getOptions()
  const key = strParam(req.query.template)
  const template = resolveTemplate(key, o)
  if (!template) {
    res.status(404).json({ message: `No template "${key.slice(0, 64)}".` })
    return
  }
  const locale = normalizeLocale(strParam(req.query.locale)) ?? o.defaultLocale
  const themeParam = strParam(req.query.theme)
  const theme = themeParam === "light" || themeParam === "dark" ? themeParam : null
  const source: PreviewSource = strParam(req.query.source) === "latest" ? "latest" : "sample"
  /* A draft of the words being edited (JSON, this template only): shown, never saved. */
  let copy: CopyOverrides | null | undefined
  const draft = strParam(req.query.copy)
  if (draft) {
    try {
      const parsed = sanitizeCopyOverrides(JSON.parse(draft.slice(0, 8000)))
      if (parsed.errors.length > 0) {
        res.status(400).json({ message: `Check these fields: ${parsed.errors.join(", ")}.`, fields: parsed.errors })
        return
      }
      copy = parsed.value
    } catch {
      res.status(400).json({ message: "copy: JSON with the words per language." })
      return
    }
  }
  try {
    const r = await renderPreview(req.scope, template, { locale, theme, source, copy })
    const body: PreviewResponse = {
      template: template.key,
      locale: r.locale,
      theme,
      source: r.source,
      sourceRef: r.sourceRef,
      subject: r.subject,
      preheader: r.preheader,
      html: r.html,
      text: r.text,
      bytes: Buffer.byteLength(r.html, "utf8"),
      defaults: r.defaults ?? null,
    }
    res.setHeader("Cache-Control", "private, no-store")
    res.json(body)
  } catch (err) {
    if (err instanceof RenderError) {
      /* The template's own error (your code threw, or returned no subject): useful to its author, masked. */
      res.status(422).json({ code: "render_error", message: svc.mask(err.message) })
      return
    }
    serverError(req, res, err, "The preview failed. The server log has the details.")
  }
}
