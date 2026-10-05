/**
 * OLX ADVERTS AS THE PLUGIN SEES THEM. Zero imports (unit tests run it as is).
 *
 * We keep only what the matching and the admin need: id, URL, title, status,
 * price, category, `external_id`, the SKU found in the description and two dates.
 * Contact data, locations and images of the advert are NOT stored.
 */

export interface OlxPrice {
  value: number
  currency: string
}

export interface OlxAdvertInput {
  /** Advert id in OLX. A number, kept as a string. */
  olxId: string
  /**
   * Full advert URL. KEPT, NOT BUILT: OLX encodes a text handle and a short
   * hash in the URL (`...-CID5-ID1bucWN.html`), an URL built from the id
   * alone returns "not found".
   */
  url: string
  title: string
  /** Raw OLX status: active, limited, outdated, removed_by_user, moderated... */
  status: string
  /** `external_id` from the Partner API. Feeds and BaseLinker put the SKU here. */
  externalId: string | null
  /** SKU parsed from the description, the fallback key. */
  descriptionSku: string | null
  price: OlxPrice | null
  validTo: string | null
  createdAt: string | null
  /** OLX category id of the advert, when the list carries it. */
  categoryId: number | null
}

export function compilePatterns(sources: readonly string[]): RegExp[] {
  const out: RegExp[] = []
  for (const s of sources) {
    try {
      out.push(new RegExp(s, "i"))
    } catch {
      /* A broken custom pattern must not stop the sync; it simply never matches. */
    }
  }
  return out
}

/**
 * SKU from the advert description.
 *
 * We take the rest of the line, not a set of allowed characters: descriptions
 * are HTML and the next field follows right after the code, so a character
 * class would happily swallow the next line. Tags become line breaks first.
 * SKUs may contain a space (`WZ-138 XD`) or a slash (`WZ-328/1`), so we only
 * cut at two spaces in a row, where the next field of the description starts.
 */
export function skuFromDescription(description: string | null | undefined, patterns: readonly RegExp[]): string | null {
  if (!description) return null
  const text = String(description).replace(/<[^>]+>/g, "\n")
  for (const pattern of patterns) {
    const m = pattern.exec(text)
    if (!m || typeof m[1] !== "string") continue
    const clean = m[1].split(/\s{2,}/)[0].trim()
    if (clean.length > 0) return clean
  }
  return null
}

interface RawAdvert {
  id?: unknown
  url?: unknown
  title?: unknown
  description?: unknown
  status?: unknown
  external_id?: unknown
  price?: unknown
  valid_to?: unknown
  created_at?: unknown
  category_id?: unknown
}

function parsePrice(raw: unknown): OlxPrice | null {
  if (!raw || typeof raw !== "object") return null
  const p = raw as Record<string, unknown>
  const value = typeof p.value === "number" ? p.value : Number(p.value)
  const currency = typeof p.currency === "string" ? p.currency.trim().toUpperCase() : ""
  if (!Number.isFinite(value) || !currency) return null
  return { value, currency }
}

function parseCategoryId(raw: unknown): number | null {
  const n = Number(raw)
  return raw !== null && raw !== undefined && raw !== "" && Number.isInteger(n) && n > 0 ? n : null
}

/**
 * OLX sends `YYYY-MM-DD HH:mm:ss` without a zone. Read it as UTC, so the
 * result does not depend on the timezone of the server running Medusa.
 */
function parseDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null
  const text = raw.trim().replace(" ", "T")
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text)
  const t = Date.parse(hasZone ? text : `${text}Z`)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * Partner API `data[]` into our shape, plus a count per status, so the run
 * log can answer "why 232 linked when OLX shows 463" before anyone asks.
 * Adverts without id or URL are counted but skipped.
 */
export function advertsFromPartnerApi(
  raw: unknown,
  patterns: readonly RegExp[],
): { adverts: OlxAdvertInput[]; statuses: Record<string, number> } {
  const list = Array.isArray(raw) ? (raw as RawAdvert[]) : []
  const adverts: OlxAdvertInput[] = []
  const statuses: Record<string, number> = {}
  for (const a of list) {
    const status = String(a.status ?? "").trim() || "unknown"
    statuses[status] = (statuses[status] ?? 0) + 1
    const olxId = String(a.id ?? "").trim()
    const url = String(a.url ?? "").trim()
    if (!olxId || !url) continue
    const external =
      typeof a.external_id === "string" || typeof a.external_id === "number" ? String(a.external_id).trim() : ""
    adverts.push({
      olxId,
      url,
      title: String(a.title ?? "").trim(),
      status,
      externalId: external || null,
      descriptionSku: skuFromDescription(typeof a.description === "string" ? a.description : null, patterns),
      price: parsePrice(a.price),
      validTo: parseDate(a.valid_to),
      createdAt: parseDate(a.created_at),
      categoryId: parseCategoryId(a.category_id),
    })
  }
  return { adverts, statuses }
}
