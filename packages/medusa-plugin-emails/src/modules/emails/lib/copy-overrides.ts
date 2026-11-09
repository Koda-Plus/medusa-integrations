/**
 * THE WORDS A PERSON REWRITES IN THE ADMIN: per template and language, the
 * subject, the preheader, the pill, the title, the intro and an extra note.
 * The rest of a message (numbers, products, totals, addresses, buttons) stays
 * the template's, so an edit can never break an order confirmation.
 *
 * Stored in `emails_setting` as `live:copy:order.placed`:
 *
 *   { pl: { subject: "Mamy zamówienie {order}", title: "{name}, *dzięki*!" }, en: { ... } }
 *
 * A field left out (or empty) keeps the template's own words. In the text:
 *
 *   {name}     the customer's first name        {store}    the store name
 *   {order}    the order number                 {total}    the amount
 *   {items}    "3 pozycje" / "3 items"          {tracking} the parcel number
 *   {minutes}  how long a reset link works      {ref}      the negotiation
 *   {product}  the negotiated product           {price}    the negotiated price
 *   *word*     the accent colour (title, intro, eyebrow and note)
 *
 * A placeholder without a value disappears together with the comma or space
 * in front of it ("{name}, dziękujemy" without a name: "Dziękujemy"). Values
 * are plain text: the kit escapes them, so a customer's name can never carry
 * markup into a message.
 */

import { TEMPLATES, type EmailLocale } from "./constants"
import { cleanText } from "./html"
import * as kit from "./kit"
import type { EmailDocument, Inline } from "./kit"
import { toNumber } from "./locale"
import { COPY } from "./templates/copy"
import { firstName, lineCount, money } from "./templates/shared"
import type { EmailFormat, EmailItem, Money } from "./types"

export const COPY_FIELDS = ["subject", "preheader", "eyebrow", "title", "intro", "note"] as const
export type CopyField = (typeof COPY_FIELDS)[number]
export type CopyTexts = Partial<Record<CopyField, string>>
export type CopyOverrides = Partial<Record<EmailLocale, CopyTexts>>

export const COPY_LIMITS: Record<CopyField, number> = { subject: 150, preheader: 200, eyebrow: 60, title: 160, intro: 600, note: 600 }

export const PLACEHOLDERS = ["name", "store", "order", "total", "items", "tracking", "minutes", "ref", "product", "price"] as const
export type Placeholder = (typeof PLACEHOLDERS)[number]

const ORDER_TEMPLATES: readonly string[] = [TEMPLATES.orderPlaced, TEMPLATES.orderShipped, TEMPLATES.orderCanceled]
const NEGOTIATION_TEMPLATES: readonly string[] = [TEMPLATES.negotiationCountered, TEMPLATES.negotiationAccepted, TEMPLATES.negotiationRejected]

/** The placeholders that have a value in a template, for the hints in the admin. App templates get the generic ones. */
export function placeholdersOf(key: string): Placeholder[] {
  if (ORDER_TEMPLATES.includes(key)) return key === TEMPLATES.orderShipped ? ["name", "store", "order", "total", "items", "tracking"] : ["name", "store", "order", "total", "items"]
  if (key === TEMPLATES.cartAbandoned) return ["name", "store", "total", "items"]
  if (key === TEMPLATES.passwordReset) return ["name", "store", "minutes"]
  if (key === TEMPLATES.customerWelcome) return ["name", "store"]
  if (NEGOTIATION_TEMPLATES.includes(key)) return ["name", "store", "ref", "product", "price"]
  return ["name", "store"]
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]+/g

/** One language's texts, checked field by field. Empty strings drop the field. */
function sanitizeTexts(input: unknown, errors: string[], prefix: string): CopyTexts {
  const out: CopyTexts = {}
  if (input === null || input === undefined) return out
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push(prefix)
    return out
  }
  const raw = input as Record<string, unknown>
  for (const field of COPY_FIELDS) {
    const v = raw[field]
    if (v === undefined || v === null || v === "") continue
    if (typeof v !== "string") {
      errors.push(`${prefix}.${field}`)
      continue
    }
    const multiline = field === "intro" || field === "note"
    let s = v.replace(CONTROL, " ").replace(/\r\n?/g, "\n")
    s = multiline ? s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : s.replace(/\s+/g, " ").trim()
    if (!s) continue
    if (s.length > COPY_LIMITS[field]) errors.push(`${prefix}.${field}`)
    else out[field] = s
  }
  return out
}

/** Overrides of one template sent by the admin. Errors name the field ("pl.subject"). */
export function sanitizeCopyOverrides(input: unknown): { value: CopyOverrides; errors: string[] } {
  const errors: string[] = []
  const value: CopyOverrides = {}
  if (input === null || input === undefined) return { value, errors }
  if (typeof input !== "object" || Array.isArray(input)) return { value, errors: ["copy"] }
  for (const locale of ["pl", "en"] as const) {
    const texts = sanitizeTexts((input as Record<string, unknown>)[locale], errors, locale)
    if (Object.keys(texts).length > 0) value[locale] = texts
  }
  return { value, errors }
}

export function hasCopy(o: CopyOverrides | null | undefined): boolean {
  return Boolean(o && (Object.keys(o.pl ?? {}).length > 0 || Object.keys(o.en ?? {}).length > 0))
}

/** The values of the placeholders, from the message's data. Missing ones are empty. */
export function copyVars(
  key: string,
  data: Record<string, unknown>,
  locale: EmailLocale,
  format: EmailFormat,
  storeName: string | null,
): Record<Placeholder, string> {
  const c = COPY[locale]
  const items = data.items as EmailItem[] | null | undefined
  const count = lineCount(items)
  const cur = (data.currency_code as string | null | undefined) ?? null
  const tracking = Array.isArray(data.tracking) ? (data.tracking as Array<{ number?: unknown }>).map((t) => cleanText(t?.number, 60)).filter(Boolean) : []
  const minutes = key === TEMPLATES.passwordReset ? Math.max(1, Math.round(toNumber(data.expires_minutes as Money) ?? 60)) : null
  const total = (data.total ?? data.cart_total ?? null) as Money | null
  return {
    name: firstName(data.customer_name) ?? "",
    store: storeName ?? "",
    order: cleanText(data.order_number, 40) || "",
    total: money(format, total, cur) ?? "",
    items: count > 0 ? c.common.positions(count) : "",
    tracking: tracking.join(", "),
    minutes: minutes ? c.passwordReset.minutes(minutes) : "",
    ref: cleanText(data.ref, 60) || "",
    product: cleanText(data.product_title, 160) || "",
    price: money(format, (data.price ?? null) as Money | null, cur) ?? "",
  }
}

/** Placeholders replaced; an empty one takes the comma or space before it along, and the first letter is raised when the text now starts lower. */
export function fillText(text: string, vars: Record<string, string>): string {
  let out = text.replace(/(,\s*|\s+)?\{(\w+)\}/g, (whole, lead: string | undefined, name: string) => {
    if (!(name in vars)) return whole
    const v = vars[name]
    return v ? `${lead ?? ""}${v}` : ""
  })
  out = out.replace(/^[\s,.:;]+/, "").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?:;])/g, "$1")
  if (out && text.trimStart().startsWith("{")) out = out.charAt(0).toLocaleUpperCase() + out.slice(1)
  return out.trim()
}

/** A text with *accents* and line breaks as kit inlines. */
export function inlineOf(text: string, vars: Record<string, string>): Inline {
  const filled = fillText(text, vars)
  const parts: Inline[] = []
  filled.split("\n").forEach((line, i) => {
    if (i) parts.push(kit.br)
    line.split(/(\*[^*\n]+\*)/g).forEach((chunk) => {
      if (!chunk) return
      if (chunk.length > 2 && chunk.startsWith("*") && chunk.endsWith("*")) parts.push(kit.accent(chunk.slice(1, -1)))
      else parts.push(chunk)
    })
  })
  return parts
}

const plain = (text: string, vars: Record<string, string>) => fillText(text, vars).replace(/\*([^*\n]+)\*/g, "$1").replace(/\s+/g, " ").trim()

/** The template's document with the person's words on top. Fields that fill to nothing keep the template's words. */
export function applyCopy(doc: EmailDocument, texts: CopyTexts | null | undefined, vars: Record<string, string>): EmailDocument {
  if (!texts) return doc
  const out: EmailDocument = { ...doc }
  if (texts.subject) {
    const s = plain(texts.subject, vars)
    if (s) out.subject = s
  }
  if (texts.preheader) {
    const s = plain(texts.preheader, vars)
    if (s) out.preheader = s
  }
  if (texts.eyebrow && plain(texts.eyebrow, vars)) out.eyebrow = inlineOf(texts.eyebrow, vars)
  if (texts.title && plain(texts.title, vars)) out.title = inlineOf(texts.title, vars)
  if (texts.intro && plain(texts.intro, vars)) out.intro = inlineOf(texts.intro, vars)
  if (texts.note && plain(texts.note, vars)) out.blocks = [kit.note(inlineOf(texts.note, vars)), ...doc.blocks]
  return out
}

/** The words of a document as a person would type them: accents as *word*, for the hints in the admin. */
export function editableOf(doc: EmailDocument): Record<Exclude<CopyField, "note">, string> {
  const walk = (v: Inline): string => {
    if (v === null || v === undefined || v === false) return ""
    if (typeof v === "string" || typeof v === "number") return String(v)
    if (Array.isArray(v)) return v.map(walk).join("")
    const node = v as Exclude<Inline, string | number | null | undefined | false | readonly Inline[]>
    if (node.kind === "br") return "\n"
    if (node.kind === "trusted") return node.text
    if (node.kind === "accent") return `*${walk(node.content)}*`
    return walk(node.content)
  }
  return { subject: doc.subject, preheader: doc.preheader ?? "", eyebrow: walk(doc.eyebrow ?? null), title: walk(doc.title), intro: walk(doc.intro ?? null) }
}
