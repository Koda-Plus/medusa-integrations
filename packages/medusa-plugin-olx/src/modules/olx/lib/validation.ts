/**
 * THE TEXT RULES OLX CHECKS ON EVERY NEW ADVERT, checked here first so a
 * plan says "description too short" instead of OLX saying "400". Pure.
 *
 * From the "Create advert" section of the Partner API documentation:
 *
 *   title         16 to 150 characters
 *   description   80 to 9 000 characters
 *   both          no more than 50 % capital letters; none of
 *                 ! ? . , - = + # % & @ * _ > < : ( ) | three times in a row;
 *                 no e-mail addresses, no www addresses, no phone numbers
 *
 * The phone and address checks are heuristics: they catch the usual Polish
 * formats and leave product codes and EANs alone. What they miss, OLX still
 * rejects, and the plan shows its message.
 */

export interface Problem {
  /** Stable code the admin translates. */
  code: string
  /** Optional detail: a number, an attribute code, a message from OLX. */
  detail?: string
}

export const TITLE_MIN = 16
export const TITLE_MAX = 150
export const DESCRIPTION_MIN = 80
export const DESCRIPTION_MAX = 9000

const PUNCTUATION = "!?.,-=+#%&@*_><:()|"

/** HTML to plain text: block tags become line breaks, the rest is dropped, entities decoded. */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return ""
  return String(input)
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function capitalShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return 0
  const capitals = letters.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length
  return capitals / letters.length
}

/** The same punctuation character three times in a row ("!!!", "..."). */
export function repeatedPunctuation(text: string): string | null {
  for (let i = 0; i + 2 < text.length; i += 1) {
    const c = text[i]
    if (PUNCTUATION.includes(c) && text[i + 1] === c && text[i + 2] === c) return c.repeat(3)
  }
  return null
}

export function hasEmail(text: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
}

export function hasWebAddress(text: string): boolean {
  return /\bwww\.|https?:\/\//i.test(text)
}

/** Polish mobile (3-3-3, with or without +48) and landline (2-3-2-2) formats, not part of a longer number. */
export function hasPhone(text: string): boolean {
  const mobile = /(?<![\d+])(?:\+?48[ -]?)?\d{3}[ -]?\d{3}[ -]?\d{3}(?![\d])/
  const landline = /(?<![\d+])(?:\+?48[ -]?)?\(?\d{2}\)?[ -]\d{3}[ -]\d{2}[ -]\d{2}(?![\d])/
  return mobile.test(text) || landline.test(text)
}

function contentProblems(text: string, field: "title" | "description"): Problem[] {
  const out: Problem[] = []
  if (capitalShare(text) > 0.5) out.push({ code: `${field}_caps` })
  const punctuation = repeatedPunctuation(text)
  if (punctuation) out.push({ code: `${field}_punctuation`, detail: punctuation })
  if (hasEmail(text)) out.push({ code: `${field}_email` })
  if (hasWebAddress(text)) out.push({ code: `${field}_www` })
  if (hasPhone(text)) out.push({ code: `${field}_phone` })
  return out
}

export function checkTitle(title: string): Problem[] {
  const t = title.trim()
  const out: Problem[] = []
  if (t.length < TITLE_MIN) out.push({ code: "title_short", detail: String(t.length) })
  if (t.length > TITLE_MAX) out.push({ code: "title_long", detail: String(t.length) })
  return [...out, ...contentProblems(t, "title")]
}

export function checkDescription(text: string): Problem[] {
  const t = text.trim()
  const out: Problem[] = []
  if (t.length < DESCRIPTION_MIN) out.push({ code: "description_short", detail: String(t.length) })
  if (t.length > DESCRIPTION_MAX) out.push({ code: "description_long", detail: String(t.length) })
  return [...out, ...contentProblems(t, "description")]
}
