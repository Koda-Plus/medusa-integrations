/*
 * Koda Plus typography for the Packaging panel, the same script as the
 * shared `src/lib/typeset.ts` of the demo store, kept here so the plugin is
 * self-contained: no one-letter word left at the end of a line.
 */
export const NBSP = "\u00a0"
const NBHY = "\u2011"
const SHORT = /(^|[\s("„])(oraz|albo|lub|ale|że|bo|czy|gdy|aby|by|więc|jak|na|do|za|ze|we|od|po|to|[aiouwze])[ \t]+/gi

export function nb(text: string): string {
  let out = text
  for (let k = 0; k < 2; k++) out = out.replace(SHORT, `$1$2${NBSP}`)
  out = out.replace(/(\d) (?=\d{3}\b)/g, `$1${NBSP}`)
  out = out.replace(/\b([eE])-(?=mail)/g, `$1${NBHY}`)
  return out.replace(/(\d) (zł|€|EUR|USD|PLN|%|szt\.|dni)/g, `$1${NBSP}$2`)
}

export function typeset<T>(value: T): T {
  if (typeof value === "string") return nb(value) as T
  if (Array.isArray(value)) return value.map((v) => typeset(v)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, typeset(v)])) as T
  }
  return value
}
