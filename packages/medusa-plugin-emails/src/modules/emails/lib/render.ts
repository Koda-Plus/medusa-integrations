/**
 * RENDERING: a template, its data and a language in; the subject, the HTML
 * and the plain-text part out. Pure: the same input gives the same message,
 * which keeps Resend's idempotency key valid on a retry.
 *
 * The brand is the options with the admin's overrides on top. The language
 * is the one asked for, or the data's `locale`, or `defaultLocale`. Polish
 * messages get the typography of Koda Plus (no one-letter word at the end of
 * a line); the admin preview can force light or dark mode.
 */

import { type EmailLocale } from "./constants"
import { cleanText } from "./html"
import * as kit from "./kit"
import { formatDate, formatMoney, formatNumber, formatShortDate, formatTag, monthYear, normalizeLocale, plural } from "./locale"
import { buildLink, MONO_FONTS, type ResolvedBrand, type ResolvedEmailsOptions } from "./options"
import type { ResolvedTemplate } from "./registry"
import { htmlToText } from "./text"
import { COPY } from "./templates/copy"
import { makePalette } from "./theme"
import { typesetHtml } from "./typeset"
import type { EmailBrandInfo, EmailContent, EmailFormat, EmailLinks, EmailTemplateContext } from "./types"
import type { EmailDocument } from "./kit"

export type PreviewTheme = "light" | "dark"

export interface RenderedEmail {
  template: string
  locale: EmailLocale
  subject: string
  preheader: string
  html: string
  text: string
}

/** The language of a message: asked for, then the data's `locale`, then the default. */
export function messageLocale(asked: unknown, data: Record<string, unknown> | null | undefined, fallback: EmailLocale): EmailLocale {
  return normalizeLocale(asked) ?? normalizeLocale(data?.locale) ?? fallback
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null
  } catch {
    return null
  }
}

export function formatterFor(locale: EmailLocale, options: Pick<ResolvedEmailsOptions, "timeZone">, original?: unknown): EmailFormat {
  const tag = formatTag(locale, original)
  const tz = options.timeZone
  return {
    money: (value, currency) => formatMoney(value, currency, tag),
    date: (value, withTime = false) => formatDate(value, tag, tz, withTime),
    shortDate: (value, withTime = false) => formatShortDate(value, tag, tz, withTime),
    number: (value) => formatNumber(value, tag),
    plural: (n, forms) => plural(locale, n, forms),
    monthYear: (value) => monthYear(value, tz),
  }
}

export function linksFor(options: Pick<ResolvedEmailsOptions, "links">, locale: EmailLocale): EmailLinks {
  const l = options.links
  return {
    store: () => buildLink(l.store, { locale }),
    account: () => buildLink(l.account, { locale }),
    order: ({ id, displayId, country }) => buildLink(l.order, { order_id: id ?? null, display_id: displayId ?? null, country: country ?? null, locale }),
    cart: ({ id, country }) => buildLink(l.cart, { cart_id: id ?? null, country: country ?? null, locale }),
    negotiation: ({ id, ref }) => buildLink(l.negotiation, { id: id ?? null, ref: ref ?? null, locale }),
  }
}

/** The kit's context: colours, fonts, the brand in the language of the message, the kit's own words. */
export function kitContext(locale: EmailLocale, brand: ResolvedBrand, options: ResolvedEmailsOptions): kit.KitContext {
  const copy = COPY[locale]
  const links = linksFor(options, locale)
  const name = brand.name
  const footer = brand.footer ? (locale === "pl" ? brand.footer.pl ?? brand.footer.en : brand.footer.en ?? brand.footer.pl) : null
  return {
    locale,
    palette: makePalette(brand.accentColor, brand.headerColor),
    fonts: { head: brand.headingFont, body: brand.bodyFont, mono: MONO_FONTS, faces: brand.fontFaces },
    brand: {
      name,
      logo: {
        text: brand.logo.text ?? name ?? hostOf(options.storefrontUrl) ?? copy.logoFallback,
        accent: brand.logo.accent,
        suffix: brand.logo.suffix,
        italic: brand.logo.italic,
      },
      supportEmail: brand.supportEmail,
      replyTo: options.replyTo.length > 0,
      storeUrl: links.store(),
      accountUrl: links.account(),
      footer: footer ? cleanText(footer, 300) : null,
    },
    copy: copy.kit,
  }
}

function isDocument(v: unknown): v is EmailDocument {
  return Boolean(v) && typeof v === "object" && Array.isArray((v as { blocks?: unknown }).blocks) && typeof (v as { subject?: unknown }).subject === "string"
}

function isContent(v: unknown): v is EmailContent {
  return Boolean(v) && typeof v === "object" && typeof (v as { html?: unknown }).html === "string" && typeof (v as { subject?: unknown }).subject === "string"
}

/** The admin preview forces a theme on the <html> element; a real send leaves it to the mail client. */
export function withTheme(html: string, theme: PreviewTheme | null | undefined): string {
  if (theme !== "light" && theme !== "dark") return html
  return html.replace(/<html(\s|>)/, `<html class="em-theme-${theme}"$1`)
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RenderError"
  }
}

/**
 * Renders a resolved template. Throws `RenderError` when the template throws
 * or returns something that is neither a document nor finished HTML.
 */
export function renderTemplate(
  template: ResolvedTemplate,
  data: Record<string, unknown>,
  input: { locale?: unknown; options: ResolvedEmailsOptions; brand: ResolvedBrand; theme?: PreviewTheme | null; subjectPrefix?: string },
): RenderedEmail {
  const locale = messageLocale(input.locale, data, input.options.defaultLocale)
  const ctx = kitContext(locale, input.brand, input.options)
  const brandInfo: EmailBrandInfo = { name: input.brand.name, storeUrl: ctx.brand.storeUrl, supportEmail: input.brand.supportEmail }
  const templateCtx: EmailTemplateContext<any> = {
    data,
    locale,
    kit,
    format: formatterFor(locale, input.options, data?.locale),
    links: linksFor(input.options, locale),
    brand: brandInfo,
  }
  let result: unknown
  try {
    result = template.def.render(templateCtx)
  } catch (err) {
    throw new RenderError(`The template "${template.key}" failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (result && typeof (result as { then?: unknown }).then === "function") {
    throw new RenderError(`The template "${template.key}" returned a promise; render must be synchronous.`)
  }
  let out: kit.Rendered
  if (isDocument(result)) {
    const doc = { ...result, subject: `${input.subjectPrefix ?? ""}${result.subject}` }
    out = kit.layout(doc, ctx)
  } else if (isContent(result)) {
    const subject = `${input.subjectPrefix ?? ""}${result.subject}`.replace(/\s+/g, " ").trim()
    out = { subject, preheader: (result.preheader ?? "").trim(), html: result.html, text: result.text?.trim() ? result.text : htmlToText(result.html) }
  } else {
    throw new RenderError(`The template "${template.key}" returned neither a document (subject, title, blocks) nor { subject, html }.`)
  }
  if (!out.subject) throw new RenderError(`The template "${template.key}" rendered an empty subject.`)
  const html = locale === "pl" ? typesetHtml(out.html) : out.html
  return { template: template.key, locale, subject: out.subject, preheader: out.preheader, html: withTheme(html, input.theme), text: out.text }
}

/** Finished content given to the notification module (`content`), without a template. */
export function renderContent(key: string, content: { subject?: unknown; html?: unknown; text?: unknown }, locale: EmailLocale): RenderedEmail | null {
  const subject = cleanText(content.subject, 300)
  const html = typeof content.html === "string" ? content.html : ""
  const text = typeof content.text === "string" ? content.text : ""
  if (!subject || (!html && !text)) return null
  return { template: key, locale, subject, preheader: "", html, text: text || htmlToText(html) }
}
