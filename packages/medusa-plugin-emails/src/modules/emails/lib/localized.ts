/**
 * A text given in the options as a plain string or `{ en, pl }`, resolved to
 * both languages (the admin picks one and falls back to the other). Lenient:
 * anything else gives null, nothing here ever throws. Zero imports.
 */

/** A text in both languages; the admin picks one and falls back to the other. */
export interface ResolvedText {
  en: string | null
  pl: string | null
}

function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

export function resolveText(v: unknown, max = 400): ResolvedText | null {
  if (typeof v === "string" || typeof v === "number") {
    const s = clip(v, max)
    return s ? { en: s, pl: s } : null
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const en = clip(o.en, max)
    const pl = clip(o.pl, max)
    return en || pl ? { en, pl } : null
  }
  return null
}
