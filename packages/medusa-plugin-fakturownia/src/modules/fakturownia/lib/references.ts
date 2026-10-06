/**
 * "RUNNING IN PRODUCTION": stores that use the integration, from the
 * `references` option, for the admin page and the end of the setup guide.
 * Zero imports.
 *
 * Validated leniently: an entry without a name or an https address is
 * dropped, texts may be plain or `{ en, pl }`, and nothing here ever throws,
 * so a typo in `medusa-config.ts` never stops Medusa. The package itself
 * names no store: the references come from the configuration.
 */

export type LocalizedText = string | { en?: string; pl?: string }

export interface ReferenceOption {
  name: string
  url: string
  /** The store's favicon or logo mark: a `data:image/...;base64,` URI or an https URL. */
  icon?: string
  description?: LocalizedText
  /** `YYYY-MM`: since when the store runs the integration. */
  since?: string
  metrics?: Array<{ label: LocalizedText; value: string }>
  links?: Array<{ label: LocalizedText; url: string }>
}

/** A text in both languages; the admin picks one and falls back to the other. */
export interface ResolvedText {
  en: string | null
  pl: string | null
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
}

const MAX_REFERENCES = 12
const MAX_ITEMS = 6

function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

export function httpsUrl(v: unknown): string | null {
  const s = clip(v, 500)
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : null
  } catch {
    return null
  }
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

function since(v: unknown): string | null {
  const s = clip(v, 7)
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

export function resolveReferences(option: unknown): ResolvedReference[] {
  if (!Array.isArray(option)) return []
  const out: ResolvedReference[] = []
  for (const raw of option) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const r = raw as Record<string, unknown>
    const name = clip(r.name, 80)
    const url = httpsUrl(r.url)
    if (!name || !url) continue
    const metrics = (Array.isArray(r.metrics) ? r.metrics : [])
      .map((m) => {
        const mm = (m && typeof m === "object" ? m : {}) as Record<string, unknown>
        const label = resolveText(mm.label, 60)
        const value = clip(mm.value, 24)
        return label && value ? { label, value } : null
      })
      .filter((m): m is { label: ResolvedText; value: string } => m !== null)
      .slice(0, MAX_ITEMS)
    const links = (Array.isArray(r.links) ? r.links : [])
      .map((l) => {
        const ll = (l && typeof l === "object" ? l : {}) as Record<string, unknown>
        const label = resolveText(ll.label, 80)
        const href = httpsUrl(ll.url)
        return label && href ? { label, url: href } : null
      })
      .filter((l): l is { label: ResolvedText; url: string } => l !== null)
      .slice(0, MAX_ITEMS)
    out.push({ name, url, icon: referenceIcon(r.icon), description: resolveText(r.description), since: since(r.since), metrics, links })
    if (out.length >= MAX_REFERENCES) break
  }
  return out
}
