/**
 * Text that people and scripts send: titles, descriptions, comments, tags,
 * display names. Pure, zero imports apart from the constants.
 *
 * Everything is stored as plain text. Control characters and bidirectional
 * overrides are removed (they can make a title read differently from what it
 * is); every screen of the admin escapes what it shows anyway.
 */

import { AUTHOR_MAX, ID_MAX } from "./constants"

/* C0 controls except tab and line feed, DEL, C1 controls. */
const CONTROLS_MULTILINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
const CONTROLS_LINE = /[\u0000-\u001F\u007F-\u009F]/g
/* Bidirectional embeddings, overrides and isolates. */
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g

/** Text of several lines (descriptions, comments): line breaks kept, ends trimmed, cut at `max`. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return ""
  const s = value.replace(/\r\n?/g, "\n").replace(CONTROLS_MULTILINE, "").replace(BIDI, "").replace(/[ \t]+$/gm, "").trim()
  return s.length > max ? s.slice(0, max).trimEnd() : s
}

/** One line (titles, tags, names): whitespace runs become one space, ends trimmed, cut at `max`. */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return ""
  const s = String(value).replace(CONTROLS_LINE, " ").replace(BIDI, "").replace(/\s+/g, " ").trim()
  return s.length > max ? s.slice(0, max).trimEnd() : s
}

/**
 * The name a script or an AI agent signs with (`author` in a request body),
 * like "Claude Code" or "Deploy bot". One line, at most 60 characters; null
 * when nothing usable is left.
 */
export function cleanDisplayName(value: unknown): string | null {
  const s = cleanLine(value, AUTHOR_MAX)
  return s ? s : null
}

/** An id as Medusa and this plugin write them: letters, digits, `_` and `-`. Old KODA Panel ids are bare ULIDs. */
export function isEntityId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= ID_MAX && /^[A-Za-z0-9_-]+$/.test(value)
}

/** A search phrase as an ILIKE pattern, with `%`, `_` and `\` taken literally. Empty for no phrase. */
export function likePattern(q: unknown): string {
  const s = cleanLine(q, 100)
  if (!s) return ""
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Case and accent insensitive key, for comparing names and tags. */
export function foldKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}
