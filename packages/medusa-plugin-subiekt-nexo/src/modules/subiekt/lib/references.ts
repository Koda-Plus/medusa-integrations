/**
 * THE `references` OPTION: stores where the integration runs in production,
 * shown in the header of the admin page ("Running in N stores", with the
 * stores' rating) and at the end of the setup guide, and stores that start
 * on Medusa soon (`soon: true`, a "Soon" badge, no link). Validated
 * leniently: an entry without a name is dropped, and so is a live entry
 * without an https URL (a soon entry needs only its name); a malformed field
 * is dropped, an unknown one ignored, nothing ever throws, because a typo in
 * medusa-config must not stop Medusa from starting.
 *
 * Texts may come in both admin languages, `{ en, pl }`; the admin picks one.
 * No client names live in this package: the store passes its own references.
 */

export type LocalizedText = string | { en?: string; pl?: string }

export interface ReferenceInput {
  name?: unknown
  /** The live store (https). Optional when `soon` is true; a soon store is never linked. */
  url?: unknown
  /** `true`: a store that starts on Medusa soon, listed with a "Soon" badge and without a link. */
  soon?: unknown
  /** The store's favicon or logo mark: a `data:image/...;base64,` URI or an https URL. */
  icon?: unknown
  description?: unknown
  metrics?: unknown
  links?: unknown
  /**
   * The store's rating of the work, with where it was given:
   * `{ rating: 5, scale?: 5, source: "Clutch", url?, icon?, quote?, author? }`.
   * Quote the client only with their consent.
   */
  review?: unknown
}

/** A rating of the work at the store, on a review platform such as Clutch. */
export interface ReviewDto {
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

export interface ReferenceDto {
  name: string
  /** https. Null only for a store that starts soon and has no address yet. */
  url: string | null
  /** The store starts on Medusa soon: shown with a "Soon" badge and never linked. */
  soon: boolean
  /** The store's icon: a data URI (at most 64 KB) or an https URL. */
  icon?: string
  description?: LocalizedText
  metrics: Array<{ label: LocalizedText; value: string }>
  links: Array<{ label: LocalizedText; url: string }>
  /** The store's rating of the work and where it was given; absent when the option has none. */
  review?: ReviewDto
}

const MAX_REFERENCES = 12

function text(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t.slice(0, max) : null
}

function httpsUrl(value: unknown): string | null {
  const t = text(value, 500)
  if (!t) return null
  try {
    const u = new URL(t)
    return u.protocol === "https:" ? u.toString() : null
  } catch {
    return null
  }
}

/** A plain string, or `{ en, pl }` with at least one non-empty language. */
export function localized(value: unknown, max = 300): LocalizedText | null {
  const plain = text(value, max)
  if (plain) return plain
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as { en?: unknown; pl?: unknown }
  const en = text(v.en, max)
  const pl = text(v.pl, max)
  if (!en && !pl) return null
  return { ...(en ? { en } : {}), ...(pl ? { pl } : {}) }
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
export function normalizeReview(value: unknown): ReviewDto | null {
  if (!value || typeof value !== "object") return null
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

export function normalizeReferences(input: unknown): ReferenceDto[] {
  if (!Array.isArray(input)) return []
  const out: ReferenceDto[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as ReferenceInput
    const name = text(r.name, 80)
    const soon = r.soon === true
    const url = httpsUrl(r.url)
    if (!name || (!url && !soon)) continue
    const description = localized(r.description, 400)
    const metrics: ReferenceDto["metrics"] = []
    for (const m of Array.isArray(r.metrics) ? r.metrics : []) {
      if (!m || typeof m !== "object") continue
      const label = localized((m as { label?: unknown }).label, 60)
      const rawValue = (m as { value?: unknown }).value
      const value = typeof rawValue === "number" && Number.isFinite(rawValue) ? String(rawValue) : text(rawValue, 30)
      if (label && value) metrics.push({ label, value })
    }
    const links: ReferenceDto["links"] = []
    for (const l of Array.isArray(r.links) ? r.links : []) {
      if (!l || typeof l !== "object") continue
      const label = localized((l as { label?: unknown }).label, 80)
      const linkUrl = httpsUrl((l as { url?: unknown }).url)
      if (label && linkUrl) links.push({ label, url: linkUrl })
    }
    const icon = referenceIcon(r.icon)
    const review = normalizeReview(r.review)
    out.push({
      name,
      url,
      soon,
      ...(icon ? { icon } : {}),
      ...(description ? { description } : {}),
      metrics: metrics.slice(0, 6),
      links: links.slice(0, 6),
      ...(review ? { review } : {}),
    })
    if (out.length >= MAX_REFERENCES) break
  }
  return out
}
