/**
 * ESCAPING AND SAFE LINKS for the HTML of an e-mail. Zero imports.
 *
 * Every value that reaches the HTML of a message passes through here: names,
 * company names and addresses come from customers, product titles from the
 * catalog, links from the configuration and from the event data. The rules:
 *
 *   - text and attribute values are escaped (& < > " '), so a name like
 *     `<script>` or `"><img onerror=...>` shows as typed and never becomes
 *     markup;
 *   - a link is used only when it is an absolute http(s) address (mailto for
 *     the support address) with no spaces, quotes or angle brackets; anything
 *     else, `javascript:` and `data:` included, is dropped and the button or
 *     link is left out;
 *   - values that end up inside CSS (colours, font families, font files) are
 *     validated against a narrow pattern first.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

/** Text or an attribute value, escaped. `null` and `undefined` become an empty string. */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

/** Control characters (line breaks included) collapse to one space; text is trimmed and clipped. */
export function cleanText(value: unknown, max = 500): string {
  if (value === null || value === undefined) return ""
  if (typeof value !== "string" && typeof value !== "number") return ""
  // eslint-disable-next-line no-control-regex
  const s = String(value).replace(/[\u0000-\u001F\u007F\s]+/g, " ").trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

const UNSAFE_IN_URL = /[\s"'<>\\`]/

/**
 * An absolute http(s) address, trimmed, or null. With `mailto: true` a
 * `mailto:` address of one valid e-mail is accepted too. The result is NOT
 * escaped: escape it where it goes into an attribute.
 */
export function safeUrl(value: unknown, opts: { mailto?: boolean } = {}): string | null {
  if (typeof value !== "string") return null
  const s = value.trim()
  if (!s || s.length > 2000 || UNSAFE_IN_URL.test(s)) return null
  if (opts.mailto && /^mailto:/i.test(s)) {
    return /^mailto:[A-Za-z0-9.!#$%&*+/=?^_{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/i.test(s) ? s : null
  }
  if (!/^https?:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    if (!u.hostname) return null
    return s
  } catch {
    return null
  }
}

/** An https address only (font files). */
export function safeHttpsUrl(value: unknown): string | null {
  const s = safeUrl(value)
  return s && /^https:\/\//i.test(s) ? s : null
}

/**
 * A CSS font-family list made of names, single quotes, commas, spaces and
 * dashes; anything else falls back. Double quotes are refused: the value goes
 * into a double-quoted style attribute.
 */
export function cssFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const s = value.trim()
  if (!s || s.length > 300) return fallback
  return /^[A-Za-z0-9 ,'_-]+$/.test(s) ? s : fallback
}

/** A font family name for @font-face: letters, digits, spaces and dashes. */
export function fontFaceName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim()
  return s && s.length <= 60 && /^[A-Za-z0-9 _-]+$/.test(s) ? s : null
}
