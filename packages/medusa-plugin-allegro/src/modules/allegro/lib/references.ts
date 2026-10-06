/**
 * "RUNNING IN PRODUCTION": stores that use this integration, from the
 * `references` option. Zero imports.
 *
 * Validated leniently: an entry without a name or without an https address
 * is dropped, a field of the wrong type is ignored, nothing ever throws. A
 * reference is marketing, not configuration, so it must never stop a boot.
 * Texts may come in both languages (`{ en, pl }`); the admin picks one.
 */

export type LocalizedText = string | { en?: string; pl?: string }

export interface ReferenceInput {
  name: string
  url: string
  /** The store's favicon or logo mark: a `data:image/...;base64,` URI or an https URL. */
  icon?: string
  description?: LocalizedText
  /** YYYY-MM */
  since?: string
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
  url: string
  /** The store's icon: a data URI (at most 64 KB) or an https URL. */
  icon: string | null
  description: ResolvedText | null
  since: string | null
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

function since(v: unknown): string | null {
  const s = text(v, 7)
  if (!s || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return null
  return s
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
    const url = httpsUrl(r.url)
    if (!name || !url || seen.has(url)) continue
    seen.add(url)
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
      icon: referenceIcon(r.icon),
      description: localized(r.description, 400),
      since: since(r.since),
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

const PL_MONTHS_GENITIVE = [
  "stycznia",
  "lutego",
  "marca",
  "kwietnia",
  "maja",
  "czerwca",
  "lipca",
  "sierpnia",
  "września",
  "października",
  "listopada",
  "grudnia",
]

/**
 * "2026-04" as "Since April 2026" or "Od kwietnia 2026". Polish needs the
 * genitive month after "od", which Intl does not give for a month alone, so
 * Polish uses a small table and other languages use Intl.
 */
export function sinceLabel(value: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  if (!m) return value
  const year = Number(m[1])
  const month = Number(m[2])
  if (/^pl\b/i.test(lang)) return `Od ${PL_MONTHS_GENITIVE[month - 1] ?? m[2]} ${year}`
  try {
    const label = new Intl.DateTimeFormat(lang || "en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(year, month - 1, 1)),
    )
    return `Since ${label}`
  } catch {
    return `Since ${value}`
  }
}
