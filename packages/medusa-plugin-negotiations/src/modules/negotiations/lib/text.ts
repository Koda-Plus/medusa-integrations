/**
 * TEXT: message bodies, references, ids and search patterns. Zero imports.
 */

export type TextResult = { ok: true; text: string } | { ok: false; error: "required" | "too_long" | "invalid" }

/**
 * Removes control characters (except tab and line feed) and the
 * bidirectional embeddings, overrides and isolates (U+202A to U+202E,
 * U+2066 to U+2069) that can make a text read differently from what it
 * says. By code point, so this source holds none of them.
 */
export function stripControl(text: string): string {
  let out = ""
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f) continue
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) continue
    out += ch
  }
  return out
}

/**
 * A message as stored: line breaks normalized to "\n", control characters
 * removed, at most two empty lines in a row, trimmed. Plain text: nothing is
 * interpreted as HTML, and every screen escapes it when it shows it.
 */
export function cleanText(input: unknown, max: number): TextResult {
  if (input === undefined || input === null) return { ok: false, error: "required" }
  if (typeof input !== "string") return { ok: false, error: "invalid" }
  const text = stripControl(input.replace(/\r\n?/g, "\n"))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (!text) return { ok: false, error: "required" }
  if ([...text].length > max) return { ok: false, error: "too_long" }
  return { ok: true, text }
}

/** An optional text: undefined, null and blank give null. */
export function cleanOptionalText(input: unknown, max: number): { ok: true; text: string | null } | { ok: false; error: "too_long" | "invalid" } {
  if (input === undefined || input === null || (typeof input === "string" && input.trim() === "")) return { ok: true, text: null }
  const r = cleanText(input, max)
  if (r.ok) return r
  return { ok: false, error: r.error === "required" ? "invalid" : r.error }
}

/** The readable reference of a thread: NEG-2026-1001. */
export function formatRef(year: number, sequence: number): string {
  return `NEG-${year}-${String(Math.max(0, Math.floor(sequence))).padStart(4, "0")}`
}

/** A Medusa id as the routes accept it: letters, digits and underscores (`variant_01J...`). */
export function isEntityId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,100}$/.test(value)
}

/** An optional id from a request body: absent is null, anything malformed is reported. */
export function optionalId(value: unknown): { ok: true; id: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, id: null }
  return isEntityId(value) ? { ok: true, id: value } : { ok: false }
}

/** A search phrase for `ilike`, with the wildcards of the phrase itself escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** FNV-1a, 32 bit: stable across runs and machines. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** A shortened text for a list: one line, at most `max` characters, cut at a word. */
export function snippet(text: string | null | undefined, max = 140): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const space = cut.lastIndexOf(" ")
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
