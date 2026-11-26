/**
 * XML HELPERS OF THE FEED. Pure, zero imports.
 *
 * Product data comes from people (titles pasted from Word, descriptions from
 * old shops), so every value passes two filters: characters XML 1.0 forbids
 * (control characters, lone surrogates, U+FFFE and U+FFFF) are dropped, and
 * the rest is escaped for an attribute or wrapped in CDATA. A `]]>` inside a
 * CDATA value is split across two sections, so no value ends the section
 * early. Lengths are counted in characters (code points), as Ceneo counts
 * them, never in UTF-16 units, so a cut never splits an emoji in half.
 */

/* XML 1.0 Char: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF] */
const FORBIDDEN = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu

/** Drops the characters XML 1.0 does not allow. */
export function xmlClean(value: string): string {
  return value.replace(FORBIDDEN, "")
}

/** A value for an XML attribute in double quotes. */
export function xmlAttr(value: string): string {
  return xmlClean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
}

/** A value as CDATA, safe for any text, `]]>` included. */
export function cdata(value: string): string {
  return `<![CDATA[${xmlClean(value).replace(/]]>/g, "]]]]><![CDATA[>")}]]>`
}

/** Length in characters (code points). */
export function charLength(value: string): number {
  let n = 0
  for (const _ of value) n++
  return n
}

/** The first `max` characters (code points), trimmed at the end. */
export function cutChars(value: string, max: number): string {
  if (charLength(value) <= max) return value
  return Array.from(value).slice(0, max).join("").trimEnd()
}

/** Whitespace runs (new lines included) as single spaces, trimmed. For names and paths. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}
