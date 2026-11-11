/**
 * Lenient option values shared by the plugin options: a text in both
 * languages, an https URL and an image. Broken values give null, nothing
 * here ever throws. Zero imports.
 */

export interface LocalizedText {
  en?: string
  pl?: string
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return ""
  const s = String(value).replace(/\s+/g, " ").trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

export function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim()
  if (!/^https:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null
  } catch {
    return null
  }
}

const ICON_DATA_URI = /^data:image\/(png|webp|jpeg|gif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+={0,2}$/
const ICON_MAX_CHARS = 90_000

/** An image: a data URI of at most about 64 KB, or an https URL. Anything else is dropped. */
export function imageSource(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim()
  if (s.startsWith("data:")) return ICON_DATA_URI.test(s) && s.length <= ICON_MAX_CHARS ? s : null
  return httpsUrl(s)
}

/** A plain string is the same text in both languages. */
export function localized(value: unknown, max: number): LocalizedText | null {
  if (typeof value === "string" || typeof value === "number") {
    const s = clip(value, max)
    return s ? { en: s, pl: s } : null
  }
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const en = clip(v.en, max)
  const pl = clip(v.pl, max)
  if (!en && !pl) return null
  const out: LocalizedText = {}
  if (en) out.en = en
  if (pl) out.pl = pl
  return out
}
