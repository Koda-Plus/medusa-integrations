/**
 * "RUNNING IN PRODUCTION": stores that use this integration, passed by the
 * store owner in the plugin options and shown in the admin. Zero imports.
 *
 * LENIENT ON PURPOSE. A reference is decoration: a typo must never break the
 * boot. Entries without a name or an https address are dropped, every other
 * field is cleaned or dropped on its own, and nothing ever throws. No client
 * name is written into the package; the store passes its own list.
 */

/** A text in one language for every admin language, or one per language. */
export type LocalizedInput = string | { en?: string; pl?: string }

export interface ReferenceInput {
  name: string
  url: string
  /** The store's favicon or logo mark: a `data:image/...;base64,` URI or an https URL. */
  icon?: string
  description?: LocalizedInput
  /** `YYYY-MM`, shown as "Since April 2026" / "Od kwietnia 2026". */
  since?: string
  metrics?: Array<{ label: LocalizedInput; value: string }>
  links?: Array<{ label: LocalizedInput; url: string }>
  /** The store's rating of the work, with where it was given: `{ rating: 5, source: "Clutch", url, icon }`. */
  review?: {
    rating: number
    /** 5 when left out. */
    scale?: number
    source: string
    url?: string
    icon?: string
    /** Only with the client's consent to quote them. */
    quote?: LocalizedInput
    author?: string
  }
}

/** Both languages, each optional; the admin falls back to the other one. */
export interface LocalizedText {
  en?: string
  pl?: string
}

/** A rating of the work at the store, on a review platform such as Clutch. */
export interface ReferenceReview {
  /** 0 to `scale`, one decimal. */
  rating: number
  scale: number
  /** Who rated, e.g. "Clutch". */
  source: string
  /** The review itself (https). */
  url: string | null
  /** The source's mark: a data URI or an https URL. */
  icon: string | null
  quote: LocalizedText | null
  author: string | null
}

export interface ResolvedReference {
  name: string
  url: string
  /** The store's icon: a data URI (at most 64 KB) or an https URL. */
  icon: string | null
  description: LocalizedText | null
  since: string | null
  metrics: Array<{ label: LocalizedText; value: string }>
  links: Array<{ label: LocalizedText; url: string }>
  review: ReferenceReview | null
}

const MAX_REFERENCES = 12
const MAX_ITEMS = 8

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const t = value.replace(/\s+/g, " ").trim()
  return t ? t.slice(0, max) : null
}

/** An absolute https address, or null. */
export function httpsUrl(value: unknown): string | null {
  const text = clean(value, 500)
  if (!text) return null
  try {
    const u = new URL(text)
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null
  } catch {
    return null
  }
}

export function localized(value: unknown, max: number): LocalizedText | null {
  const plain = clean(value, max)
  if (plain) return { en: plain, pl: plain }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const out: LocalizedText = {}
  const en = clean(v.en, max)
  const pl = clean(v.pl, max)
  if (en) out.en = en
  if (pl) out.pl = pl
  return en || pl ? out : null
}

/** `YYYY-MM` with a real month, or null. */
export function sinceMonth(value: unknown): string | null {
  const text = clean(value, 7)
  return text && /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text : null
}

const ICON_DATA_URI = /^data:image\/(png|webp|jpeg|gif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+={0,2}$/
const ICON_MAX_CHARS = 90_000

/** A store icon: an image data URI of at most about 64 KB, or an https URL. Anything else is dropped. */
export function referenceIcon(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim()
  if (s.startsWith("data:")) return ICON_DATA_URI.test(s) && s.length <= ICON_MAX_CHARS ? s : null
  return httpsUrl(s)
}

/** A rating with a positive value and a source, or null. The rating never exceeds its scale. */
export function normalizeReview(value: unknown): ReferenceReview | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const scaleRaw = Number(v.scale ?? 5)
  const scale = Number.isFinite(scaleRaw) && scaleRaw >= 1 && scaleRaw <= 10 ? Math.round(scaleRaw) : 5
  const ratingRaw = typeof v.rating === "string" ? Number(v.rating.replace(",", ".")) : Number(v.rating)
  if (!Number.isFinite(ratingRaw) || ratingRaw <= 0) return null
  const source = clean(v.source, 40)
  if (!source) return null
  return {
    rating: Math.round(Math.min(ratingRaw, scale) * 10) / 10,
    scale,
    source,
    url: httpsUrl(v.url),
    icon: referenceIcon(v.icon),
    quote: localized(v.quote, 600),
    author: clean(v.author, 80),
  }
}

export function resolveReferences(value: unknown): ResolvedReference[] {
  if (!Array.isArray(value)) return []
  const out: ResolvedReference[] = []
  for (const raw of value) {
    if (out.length >= MAX_REFERENCES) break
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const name = clean(r.name, 80)
    const url = httpsUrl(r.url)
    if (!name || !url || out.some((x) => x.url === url)) continue
    const metrics = (Array.isArray(r.metrics) ? r.metrics : [])
      .map((m) => {
        const item = (m && typeof m === "object" ? m : {}) as Record<string, unknown>
        const label = localized(item.label, 60)
        const val = clean(typeof item.value === "number" ? String(item.value) : item.value, 30)
        return label && val ? { label, value: val } : null
      })
      .filter((m): m is { label: LocalizedText; value: string } => m !== null)
      .slice(0, MAX_ITEMS)
    const links = (Array.isArray(r.links) ? r.links : [])
      .map((l) => {
        const item = (l && typeof l === "object" ? l : {}) as Record<string, unknown>
        const label = localized(item.label, 80)
        const href = httpsUrl(item.url)
        return label && href ? { label, url: href } : null
      })
      .filter((l): l is { label: LocalizedText; url: string } => l !== null)
      .slice(0, MAX_ITEMS)
    out.push({
      name,
      url,
      icon: referenceIcon(r.icon),
      description: localized(r.description, 400),
      since: sinceMonth(r.since),
      metrics,
      links,
      review: normalizeReview(r.review),
    })
  }
  return out
}
