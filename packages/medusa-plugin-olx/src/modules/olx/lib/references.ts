/**
 * "RUNNING IN PRODUCTION": stores that use the plugin, passed by the app in
 * the `references` option and shown on the OLX page and at the end of the
 * setup guide. Zero imports.
 *
 * LENIENT ON PURPOSE. A reference is decoration: a typo in it must never stop
 * Medusa from starting. Entries without a name or without an https URL are
 * dropped, broken parts of an entry are dropped, nothing ever throws.
 */

export interface LocalizedText {
  en?: string
  pl?: string
}

export interface OlxReference {
  name: string
  url: string
  description: LocalizedText | null
  /** YYYY-MM, e.g. 2026-04. */
  since: string | null
  metrics: Array<{ label: LocalizedText; value: string }>
  links: Array<{ label: LocalizedText; url: string }>
}

/** What the option accepts. Every field is checked, so `unknown` is fine here. */
export interface OlxReferenceOption {
  name: string
  url: string
  description?: string | LocalizedText
  since?: string
  metrics?: Array<{ label: string | LocalizedText; value: string }>
  links?: Array<{ label: string | LocalizedText; url: string }>
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

export function validSince(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim()
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null
}

export function normalizeReferences(input: unknown): OlxReference[] {
  if (!Array.isArray(input)) return []
  const out: OlxReference[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (out.length >= MAX_REFERENCES) break
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const name = clip(r.name, 80)
    const url = httpsUrl(r.url)
    if (!name || !url || seen.has(url)) continue
    seen.add(url)
    const metrics: OlxReference["metrics"] = []
    if (Array.isArray(r.metrics)) {
      for (const m of r.metrics) {
        if (metrics.length >= MAX_PARTS) break
        if (!m || typeof m !== "object") continue
        const label = localized((m as Record<string, unknown>).label, 60)
        const value = clip((m as Record<string, unknown>).value, 30)
        if (label && value) metrics.push({ label, value })
      }
    }
    const links: OlxReference["links"] = []
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
      description: localized(r.description, 400),
      since: validSince(r.since),
      metrics,
      links,
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
 * "2026-04" as "April 2026", or in Polish the genitive "kwietnia 2026", so
 * the admin can say "Since April 2026" and "Od kwietnia 2026". Intl gives
 * the nominative for month and year alone ("kwiecień 2026"), so Polish is
 * formatted with a day and the day is cut; a month table is the fallback.
 */
export function fmtMonth(since: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(since)
  if (!m) return since
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  if (month < 0 || month > 11) return since
  const date = new Date(Date.UTC(year, month, 15))
  if (/^pl\b/i.test(lang)) {
    try {
      const text = new Intl.DateTimeFormat("pl", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date)
      const stripped = text.replace(/^\d+\s+/, "").replace(/\s*r\.$/, "")
      if (/[a-ząćęłńóśźż]/i.test(stripped)) return stripped
    } catch {
      /* fall back to the table */
    }
    return `${PL_MONTHS_GENITIVE[month]} ${year}`
  }
  try {
    return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(date)
  } catch {
    return since
  }
}
