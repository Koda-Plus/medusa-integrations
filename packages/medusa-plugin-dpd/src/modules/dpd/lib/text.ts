/**
 * TEXT THAT REACHES POSTGRES. Zero imports, so the unit tests load it without
 * a build.
 *
 * JavaScript strings count UTF-16 units, so `s.slice(0, n)` can keep the
 * first half of a surrogate pair (an emoji, a rare CJK character) and drop
 * the second. JSON.stringify writes such a lone surrogate as `\udXXX`, and
 * Postgres refuses it in json and jsonb ("Unicode low surrogate must follow
 * a high surrogate"), so the statement throws, and throws again on every
 * pass that reads the same answer. Hence:
 *
 *   clip       cuts at most n units and never between the halves of a pair
 *   wellFormed replaces any lone surrogate by U+FFFD (a JSON answer of
 *              MyPudoAPI can carry one as an escape, a text from a library
 *              can carry one too)
 *   jsonText   JSON.stringify with every string value made well formed: the
 *              only way a jsonb binding is written (store.ts)
 */

const HIGH_FIRST = 0xd800
const HIGH_LAST = 0xdbff

/** A surrogate with no partner: a high one not followed by a low one, or a low one not preceded by a high one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** At most `max` UTF-16 units of `s`, one fewer when the cut would split a surrogate pair. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s
  const n = Math.max(0, Math.floor(max))
  const last = s.charCodeAt(n - 1)
  return last >= HIGH_FIRST && last <= HIGH_LAST ? s.slice(0, n - 1) : s.slice(0, n)
}

/** `s` with every lone surrogate replaced by U+FFFD; a well formed string is returned as it is. */
export function wellFormed(s: string): string {
  return s.replace(LONE_SURROGATE, "�")
}

/** JSON.stringify of `v` with every string value well formed, so Postgres accepts it as jsonb. Keys are the code's own and stay as they are. */
export function jsonText(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) => (typeof value === "string" ? wellFormed(value) : value))
}
