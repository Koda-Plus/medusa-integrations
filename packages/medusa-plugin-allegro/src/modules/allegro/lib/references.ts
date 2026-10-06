/**
 * "RUNNING IN PRODUCTION": stores that use this integration, from the
 * `references` option, and stores that start on Medusa soon (`soon: true`,
 * shown with a "Soon" badge and no link). Zero imports.
 *
 * Validated leniently: an entry without a name is dropped, and so is a live
 * entry without an https address (a soon entry needs only its name); a field
 * of the wrong type is ignored, unknown fields too, nothing ever throws. A
 * reference is marketing, not configuration, so it must never stop a boot.
 * Texts may come in both languages (`{ en, pl }`); the admin picks one.
 */

export type LocalizedText = string | { en?: string; pl?: string }

export interface ReferenceInput {
  name: string
  /** The live store (https). Optional when `soon` is true; a soon store is never linked. */
  url?: string
  /** A store that starts on Medusa soon: listed with a "Soon" badge and without a link. */
  soon?: boolean
  /** The store's favicon or logo mark: a `data:image/...;base64,` URI or an https URL. */
  icon?: string
  description?: LocalizedText
  metrics?: Array<{ label: LocalizedText; value: string }>
  links?: Array<{ label: LocalizedText; url: string }>
  /** The store's rating of the work, with where it was given: `{ rating: 5, source: "Clutch", url, icon }`. */
  review?: {
    rating: number
    /** 5 when left out. */
    scale?: number
    source: string
    url?: string
    icon?: string
    /** Only with the client's consent to quote them. */
    quote?: LocalizedText
    author?: string
  }
}

export interface ResolvedText {
  en: string | null
  pl: string | null
}

/** A rating of the work at the store, on a review platform such as Clutch. */
export interface ResolvedReview {
  /** 0 to `scale`, one decimal. */
  rating: number
  scale: number
  /** Who rated, e.g. "Clutch". */
  source: string
  /** The review itself (https). */
  url: string | null
  /** The source's mark: a data URI or an https URL. */
  icon: string | null
  quote: ResolvedText | null
  author: string | null
}

export interface ResolvedReference {
  name: string
  /** https. Null only for a store that starts soon and has no address yet. */
  url: string | null
  /** The store starts on Medusa soon: shown with a "Soon" badge and never linked. */
  soon: boolean
  /** The store's icon: a data URI (at most 64 KB) or an https URL. */
  icon: string | null
  description: ResolvedText | null
  metrics: Array<{ label: ResolvedText; value: string }>
  links: Array<{ label: ResolvedText; url: string }>
  review: ResolvedReview | null
}

const MAX_REFERENCES = 12

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

function httpsUrl(v: unknown): string | null {
  const s = text(v, 500)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === "https:" ? u.toString() : null
  } catch {
    return null
  }
}

function localized(v: unknown, max: number): ResolvedText | null {
  if (typeof v === "string") {
    const s = text(v, max)
    return s ? { en: s, pl: s } : null
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const en = text(o.en, max)
    const pl = text(o.pl, max)
    return en || pl ? { en, pl } : null
  }
  return null
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
export function normalizeReview(value: unknown): ResolvedReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const scaleRaw = Number(v.scale ?? 5)
  const scale = Number.isFinite(scaleRaw) && scaleRaw >= 1 && scaleRaw <= 10 ? Math.round(scaleRaw) : 5
  const ratingRaw = typeof v.rating === "string" ? Number(v.rating.replace(",", ".")) : Number(v.rating)
  if (!Number.isFinite(ratingRaw) || ratingRaw <= 0) return null
  const source = text(v.source, 40)
  if (!source) return null
  return {
    rating: Math.round(Math.min(ratingRaw, scale) * 10) / 10,
    scale,
    source,
    url: httpsUrl(v.url),
    icon: referenceIcon(v.icon),
    quote: localized(v.quote, 600),
    author: text(v.author, 80),
  }
}

export function normalizeReferences(raw: unknown): ResolvedReference[] {
  if (!Array.isArray(raw)) return []
  const out: ResolvedReference[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const name = text(r.name, 80)
    const soon = r.soon === true
    const url = httpsUrl(r.url)
    if (!name || (!url && !soon) || (url && seen.has(url))) continue
    if (url) seen.add(url)
    const metrics: ResolvedReference["metrics"] = []
    for (const m of Array.isArray(r.metrics) ? r.metrics : []) {
      const mm = (m ?? {}) as Record<string, unknown>
      const label = localized(mm.label, 60)
      const value = text(typeof mm.value === "number" ? String(mm.value) : mm.value, 30)
      if (label && value) metrics.push({ label, value })
    }
    const links: ResolvedReference["links"] = []
    for (const l of Array.isArray(r.links) ? r.links : []) {
      const ll = (l ?? {}) as Record<string, unknown>
      const label = localized(ll.label, 80)
      const href = httpsUrl(ll.url)
      if (label && href) links.push({ label, url: href })
    }
    out.push({
      name,
      url,
      soon,
      icon: referenceIcon(r.icon),
      description: localized(r.description, 400),
      metrics: metrics.slice(0, 6),
      links: links.slice(0, 6),
      review: normalizeReview(r.review),
    })
    if (out.length >= MAX_REFERENCES) break
  }
  return out
}

/** The text in the admin language, falling back to the other one. */
export function pickText(t: ResolvedText | null | undefined, lang: string): string {
  if (!t) return ""
  const polish = /^pl\b/i.test(lang)
  return (polish ? t.pl ?? t.en : t.en ?? t.pl) ?? ""
}
