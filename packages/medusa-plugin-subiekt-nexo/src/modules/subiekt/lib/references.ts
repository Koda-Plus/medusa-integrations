/**
 * THE `references` OPTION: stores where the integration runs in production,
 * shown on the admin page ("Running in production") and at the end of the
 * setup guide. Validated leniently: an entry without a name or an https URL is
 * dropped, a malformed field is dropped, nothing ever throws, because a typo in
 * medusa-config must not stop Medusa from starting.
 *
 * Texts may come in both admin languages, `{ en, pl }`; the admin picks one.
 * No client names live in this package: the store passes its own references.
 */

export type LocalizedText = string | { en?: string; pl?: string }

export interface ReferenceInput {
  name?: unknown
  url?: unknown
  /** The store's favicon or logo mark: a `data:image/...;base64,` URI or an https URL. */
  icon?: unknown
  description?: unknown
  since?: unknown
  metrics?: unknown
  links?: unknown
}

export interface ReferenceDto {
  name: string
  url: string
  /** The store's icon: a data URI (at most 64 KB) or an https URL. */
  icon?: string
  description?: LocalizedText
  /** YYYY-MM. */
  since?: string
  metrics: Array<{ label: LocalizedText; value: string }>
  links: Array<{ label: LocalizedText; url: string }>
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

export function normalizeReferences(input: unknown): ReferenceDto[] {
  if (!Array.isArray(input)) return []
  const out: ReferenceDto[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as ReferenceInput
    const name = text(r.name, 80)
    const url = httpsUrl(r.url)
    if (!name || !url) continue
    const description = localized(r.description, 400)
    const since = typeof r.since === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.since.trim()) ? r.since.trim() : undefined
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
    out.push({ name, url, ...(icon ? { icon } : {}), ...(description ? { description } : {}), ...(since ? { since } : {}), metrics: metrics.slice(0, 6), links: links.slice(0, 6) })
    if (out.length >= MAX_REFERENCES) break
  }
  return out
}
