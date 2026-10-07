/**
 * "RUNNING IN PRODUCTION": stores that use the plugin, passed by the app in
 * the `references` option and shown on the Tasks page and at the end of the
 * setup guide. A store that starts on Medusa soon (`soon: true`) is listed
 * too, with a "Soon" badge and no link. Zero imports.
 *
 * LENIENT ON PURPOSE. A reference is decoration: a typo in it must never stop
 * Medusa from starting. Entries without a name are dropped, and so are live
 * entries without an https URL (a soon entry needs only its name); broken
 * parts of an entry are dropped, unknown fields are ignored, nothing ever
 * throws.
 */

export interface LocalizedText {
  en?: string
  pl?: string
}

/** A rating of the work at the store, on a review platform such as Clutch. */
export interface TasksReview {
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

export interface TasksReference {
  name: string
  /** https. Null only for a store that starts soon and has no address yet. */
  url: string | null
  /** The store starts on Medusa soon: shown with a "Soon" badge and never linked. */
  soon: boolean
  /** The store's icon: a data URI (at most 64 KB) or an https URL. */
  icon: string | null
  description: LocalizedText | null
  metrics: Array<{ label: LocalizedText; value: string }>
  links: Array<{ label: LocalizedText; url: string }>
  review: TasksReview | null
}

/** What the option accepts. Every field is checked, so `unknown` is fine here. */
export interface TasksReferenceOption {
  name: string
  /** The live store (https). Optional when `soon` is true; a soon store is never linked. */
  url?: string
  /** A store that starts on Medusa soon: listed with a "Soon" badge and without a link. */
  soon?: boolean
  /** The store's favicon or logo mark: a `data:image/...;base64,` URI or an https URL. */
  icon?: string
  description?: string | LocalizedText
  metrics?: Array<{ label: string | LocalizedText; value: string }>
  links?: Array<{ label: string | LocalizedText; url: string }>
  /** The store's rating of the work, with where it was given: `{ rating: 5, source: "Clutch", url, icon }`. */
  review?: {
    rating: number
    /** 5 when left out. */
    scale?: number
    source: string
    url?: string
    icon?: string
    /** Only with the client's consent to quote them. */
    quote?: string | LocalizedText
    author?: string
  }
}

const MAX_REFERENCES = 12
const MAX_PARTS = 6

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

/** A store icon: an image data URI of at most about 64 KB, or an https URL. Anything else is dropped. */
export function referenceIcon(value: unknown): string | null {
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

/** A rating with a positive value and a source, or null. The rating never exceeds its scale. */
export function normalizeReview(value: unknown): TasksReview | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const scaleRaw = Number(v.scale ?? 5)
  const scale = Number.isFinite(scaleRaw) && scaleRaw >= 1 && scaleRaw <= 10 ? Math.round(scaleRaw) : 5
  const ratingRaw = typeof v.rating === "string" ? Number(v.rating.replace(",", ".")) : Number(v.rating)
  if (!Number.isFinite(ratingRaw) || ratingRaw <= 0) return null
  const source = clip(v.source, 40)
  if (!source) return null
  return {
    rating: Math.round(Math.min(ratingRaw, scale) * 10) / 10,
    scale,
    source,
    url: httpsUrl(v.url),
    icon: referenceIcon(v.icon),
    quote: localized(v.quote, 600),
    author: clip(v.author, 80) || null,
  }
}

export function normalizeReferences(input: unknown): TasksReference[] {
  if (!Array.isArray(input)) return []
  const out: TasksReference[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (out.length >= MAX_REFERENCES) break
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const name = clip(r.name, 80)
    const soon = r.soon === true
    const url = httpsUrl(r.url)
    if (!name || (!url && !soon) || (url && seen.has(url))) continue
    if (url) seen.add(url)
    const metrics: TasksReference["metrics"] = []
    if (Array.isArray(r.metrics)) {
      for (const m of r.metrics) {
        if (metrics.length >= MAX_PARTS) break
        if (!m || typeof m !== "object") continue
        const label = localized((m as Record<string, unknown>).label, 60)
        const value = clip((m as Record<string, unknown>).value, 30)
        if (label && value) metrics.push({ label, value })
      }
    }
    const links: TasksReference["links"] = []
    if (Array.isArray(r.links)) {
      for (const l of r.links) {
        if (links.length >= MAX_PARTS) break
        if (!l || typeof l !== "object") continue
        const label = localized((l as Record<string, unknown>).label, 80)
        const linkUrl = httpsUrl((l as Record<string, unknown>).url)
        if (label && linkUrl) links.push({ label, url: linkUrl })
      }
    }
    out.push({
      name,
      url,
      soon,
      icon: referenceIcon(r.icon),
      description: localized(r.description, 400),
      metrics,
      links,
      review: normalizeReview(r.review),
    })
  }
  return out
}

/** The text in the admin language, or the other one. */
export function pickText(text: LocalizedText | null | undefined, lang: string): string {
  if (!text) return ""
  const pl = /^pl\b/i.test(lang)
  return (pl ? text.pl || text.en : text.en || text.pl) ?? ""
}
