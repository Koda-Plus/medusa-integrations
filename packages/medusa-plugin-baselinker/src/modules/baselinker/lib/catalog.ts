/**
 * BASELINKER CARDS AS THE PLUGIN SEES THEM. Zero imports: the unit tests run
 * it as is, and the demo builds raw pages that go through the SAME parser.
 *
 * Source: `getInventoryProductsList` (`inventory_id`, `page` from 1, up to
 * 1 000 cards per page). One call per page gives id, SKU, EAN, name, the
 * prices per price group and the stock per warehouse, so linking and the
 * stock plan cost one request per thousand cards. We keep only what the
 * matching and the admin need.
 *
 * BaseLinker returns collections either as an array or as an object keyed by
 * the id, and the id is sometimes ONLY the key. Both shapes are read here, in
 * one place, instead of guessing per call.
 */

export interface CardInput {
  /** Card id in the BaseLinker catalog, kept as a string. */
  blProductId: string
  /** Parent card id when the card is a variant, otherwise null. */
  parentId: string | null
  sku: string | null
  ean: string | null
  name: string
  /** Stock in the configured warehouse; null when the card has no number for it. Can be negative. */
  stock: number | null
  /** Gross prices per price group id, as BaseLinker sends them. */
  prices: Record<string, number> | null
}

export interface CatalogPage {
  cards: CardInput[]
  /** Raw entries on the page, including the ones skipped for a missing id. Decides the end of paging. */
  entries: number
}

export interface CatalogRead {
  cards: CardInput[]
  /**
   * Whether the whole catalog was read. MORE IMPORTANT THAN THE LIST: an
   * incomplete list taken as complete would unlink cards that exist right
   * now. Complete means: no page failed and the last page was short.
   */
  complete: boolean
  pages: number
  reason: string | null
}

function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

function idOf(value: unknown): string | null {
  const t = text(value)
  return t && /^\d+$/.test(t) && Number(t) > 0 ? String(Number(t)) : null
}

function numberMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
    if (Number.isFinite(n)) out[k] = n
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Entries of a BaseLinker collection with their map keys (null for arrays). */
export function entriesOf(raw: unknown): Array<[string | null, Record<string, unknown>]> {
  if (Array.isArray(raw)) {
    return raw.filter((v) => v && typeof v === "object").map((v) => [null, v as Record<string, unknown>])
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v && typeof v === "object")
      .map(([k, v]) => [k, v as Record<string, unknown>])
  }
  return []
}

/**
 * One page of `getInventoryProductsList` (`products` of the answer) into cards.
 * The stock is read from the configured warehouse only; a card without a
 * number for it gets `null`, which the stock plan treats as "unknown", never
 * as zero.
 */
export function parseProductsList(raw: unknown, warehouseId: string | null): CatalogPage {
  const entries = entriesOf(raw)
  const cards: CardInput[] = []
  for (const [key, p] of entries) {
    const blProductId = idOf(p.id) ?? idOf(p.product_id) ?? idOf(key)
    if (!blProductId) continue
    const stockMap = numberMap(p.stock)
    const stock = warehouseId && stockMap && Object.prototype.hasOwnProperty.call(stockMap, warehouseId) ? Math.trunc(stockMap[warehouseId]) : null
    cards.push({
      blProductId,
      parentId: idOf(p.parent_id),
      sku: text(p.sku),
      ean: text(p.ean),
      name: text(p.name) ?? "",
      stock,
      prices: numberMap(p.prices),
    })
  }
  return { cards, entries: entries.length }
}

/**
 * Reads every page, from 1, until a short or empty page.
 *
 * AN INCOMPLETE READ IS A FLAG, NOT AN EXCEPTION: when a page fails (after
 * the client's own retries) or the page ceiling is reached, what was read so
 * far comes back with `complete: false`, and the caller adds and updates but
 * removes nothing.
 */
export async function readAllPages(
  fetchPage: (page: number) => Promise<CatalogPage>,
  options: { pageSize: number; maxPages: number },
): Promise<CatalogRead> {
  const byId = new Map<string, CardInput>()
  let pages = 0
  for (let page = 1; page <= options.maxPages; page += 1) {
    let result: CatalogPage
    try {
      result = await fetchPage(page)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { cards: [...byId.values()], complete: false, pages, reason: `page ${page}: ${reason}` }
    }
    pages += 1
    for (const card of result.cards) byId.set(card.blProductId, card)
    if (result.entries < options.pageSize) return { cards: [...byId.values()], complete: true, pages, reason: null }
  }
  /* THE PAGE CEILING IS AN INCOMPLETE READ, not the end of the list. */
  return { cards: [...byId.values()], complete: false, pages, reason: `stopped at the ceiling of ${options.maxPages} pages` }
}

/** One inventory of `getInventories`, as the connection check shows it. */
export interface InventoryInfo {
  id: number
  name: string
  warehouses: string[]
  defaultWarehouse: string | null
}

export function parseInventories(raw: unknown): InventoryInfo[] {
  const out: InventoryInfo[] = []
  for (const [key, inv] of entriesOf(raw)) {
    const id = Number(idOf(inv.inventory_id) ?? idOf(key))
    if (!Number.isFinite(id) || id <= 0) continue
    const warehouses = Array.isArray(inv.warehouses) ? inv.warehouses.map((w) => String(w).trim().toLowerCase()).filter(Boolean) : []
    out.push({
      id,
      name: text(inv.name) ?? `#${id}`,
      warehouses,
      defaultWarehouse: text(inv.default_warehouse)?.toLowerCase() ?? null,
    })
  }
  return out
}

/** Status list of `getOrderStatusList` as an id to name map. */
export function parseStatusList(raw: unknown): Map<number, string> {
  const out = new Map<number, string>()
  for (const [key, s] of entriesOf(raw)) {
    const id = Number(idOf(s.id) ?? idOf(key))
    const name = text(s.name) ?? text(s.name_for_customer)
    if (Number.isFinite(id) && id > 0 && name) out.set(id, name)
  }
  return out
}
