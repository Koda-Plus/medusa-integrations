/**
 * E-MAILS OF DOCUMENTS: addresses, masking, reminders. Zero imports.
 *
 * Fakturownia sends the e-mail itself (`POST /invoices/{id}/send_by_email.json`,
 * to the document's `buyer_email`, or to `email_to` with up to five
 * addresses; `email_pdf=true` attaches the PDF). The plugin keeps a history
 * of what it asked for, with the address MASKED: enough to tell which of the
 * buyer's addresses it went to, never the address itself.
 *
 * Fakturownia's API has no payment reminder call and no field for the text
 * of the e-mail (verified in the API documentation, see
 * docs/fakturownia-api-notes.md): a reminder e-mails the document again with
 * the account's e-mail template, at most once a day per document.
 */

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value)
}

/** "anna.nowak@example.com" becomes "a***@e***.com". Anything that is not an address becomes "***". */
export function maskEmail(value: string | null | undefined): string {
  const s = String(value ?? "").trim()
  const at = s.lastIndexOf("@")
  if (at < 1 || at === s.length - 1) return "***"
  const local = s.slice(0, at)
  const domain = s.slice(at + 1)
  const dot = domain.lastIndexOf(".")
  const tld = dot > 0 ? domain.slice(dot) : ""
  return `${local[0]}***@${domain[0]}***${tld}`
}

/** Masks every address in a text (an error message may quote one). */
export function maskEmailsIn(text: string): string {
  return String(text ?? "").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m))
}

export interface Recipients {
  valid: string[]
  invalid: string[]
}

/** Addresses typed by a person: separated by commas, semicolons or spaces, without repeats, at most `max`. */
export function parseRecipients(text: unknown, max = 5): Recipients {
  const parts = String(text ?? "")
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const valid: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (isEmail(p)) valid.push(p)
    else invalid.push(p)
  }
  if (valid.length > max) invalid.push(...valid.splice(max))
  return { valid, invalid }
}

/** Whether another reminder may go out: none yet, or the last one is at least `minHours` old. */
export function canRemind(lastReminderAt: Date | null, now: Date, minHours: number): boolean {
  if (!lastReminderAt) return true
  return now.getTime() - lastReminderAt.getTime() >= minHours * 3600 * 1000
}

/** Whole days since a `YYYY-MM-DD` issue date. */
export function ageInDays(issueDate: string | null | undefined, now: Date): number {
  if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return 0
  const t = Date.parse(`${issueDate}T00:00:00Z`)
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}

const TITLE: Record<string, { pl: string; en: string }> = {
  vat: { pl: "Faktura VAT", en: "VAT invoice" },
  proforma: { pl: "Faktura pro forma", en: "Proforma invoice" },
  receipt: { pl: "Paragon", en: "Receipt" },
  correction: { pl: "Faktura korygująca", en: "Correction invoice" },
}

/** The subject of a simulated e-mail (demo mode), the way Fakturownia's template reads. */
export function demoSubject(kind: string, number: string | null, emailKind: string, lang: string): string {
  const l = /^pl/i.test(lang) ? "pl" : "en"
  const title = (TITLE[kind] ?? TITLE.vat)[l]
  const doc = `${title}${number ? ` ${number}` : ""}`
  if (emailKind === "reminder") return l === "pl" ? `Przypomnienie o płatności: ${doc}` : `Payment reminder: ${doc}`
  return doc
}
