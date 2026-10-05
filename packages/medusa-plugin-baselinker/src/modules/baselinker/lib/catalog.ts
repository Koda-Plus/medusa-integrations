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

/* ------------------------------------------------------------------ */
/* 0.2: variants, details and the account's dictionaries               */
/* ------------------------------------------------------------------ */

/**
 * Ids of main products that have variants on the list. With
 * `include_variants` the list carries both; such a main product is a
 * container (the variants are what is sold), so it is never linked itself.
 */
export function containerIds(cards: ReadonlyArray<{ blProductId: string; parentId: string | null }>): Set<string> {
  const out = new Set<string>()
  for (const c of cards) if (c.parentId) out.add(c.parentId)
  return out
}

/** One sellable unit of a BaseLinker product: the product itself, or one of its variants. */
export interface DetailsVariant {
  blProductId: string
  name: string
  sku: string | null
  ean: string | null
  prices: Record<string, number> | null
  stock: Record<string, number> | null
}

/** A main product of `getInventoryProductsData`, with what the catalog import needs. */
export interface ProductDetails {
  blProductId: string
  parentId: string | null
  isBundle: boolean
  sku: string | null
  ean: string | null
  /** `text_fields.name` of the catalog language. */
  name: string
  description: string | null
  taxRate: number | null
  /** Kilograms, as BaseLinker keeps it. */
  weightKg: number | null
  categoryId: number | null
  manufacturerId: number | null
  /** Image addresses in gallery order (BaseLinker positions 1 to 16). */
  images: string[]
  prices: Record<string, number> | null
  stock: Record<string, number> | null
  variants: DetailsVariant[]
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

function positiveId(value: unknown): number | null {
  const id = idOf(value)
  return id ? Number(id) : null
}

/** Gallery URLs in position order; channel-specific keys (`3|amazon_0`) are left out. */
function imageList(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return []
  const entries: Array<[number, string]> = []
  if (Array.isArray(raw)) {
    raw.forEach((v, i) => {
      const url = text(v)
      if (url) entries.push([i, url])
    })
  } else {
    for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^\d+$/.test(key)) continue
      const url = text(v)
      if (url && /^https?:\/\//i.test(url)) entries.push([Number(key), url])
    }
  }
  return entries.sort((a, b) => a[0] - b[0]).map(([, url]) => url).slice(0, 16)
}

/** `text_fields` value for a plain key (`name`, `description`), never a channel variant of it. */
function textField(fields: unknown, key: string): string | null {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null
  return text((fields as Record<string, unknown>)[key])
}

/** `products` of a `getInventoryProductsData` answer into details. */
export function parseProductsData(raw: unknown): ProductDetails[] {
  const out: ProductDetails[] = []
  for (const [key, p] of entriesOf(raw)) {
    const blProductId = idOf(p.id) ?? idOf(p.product_id) ?? idOf(key)
    if (!blProductId) continue
    const variants: DetailsVariant[] = []
    for (const [vKey, v] of entriesOf(p.variants)) {
      const id = idOf(v.id) ?? idOf(v.variant_id) ?? idOf(vKey)
      if (!id) continue
      variants.push({
        blProductId: id,
        name: text(v.name) ?? "",
        sku: text(v.sku),
        ean: text(v.ean),
        prices: numberMap(v.prices),
        stock: numberMap(v.stock),
      })
    }
    const name = textField(p.text_fields, "name") ?? text(p.name) ?? ""
    out.push({
      blProductId,
      parentId: idOf(p.parent_id),
      isBundle: p.is_bundle === true || p.is_bundle === 1 || p.is_bundle === "1",
      sku: text(p.sku),
      ean: text(p.ean),
      name,
      description: textField(p.text_fields, "description"),
      taxRate: num(p.tax_rate),
      weightKg: num(p.weight),
      categoryId: positiveId(p.category_id),
      manufacturerId: positiveId(p.manufacturer_id),
      images: imageList(p.images),
      prices: numberMap(p.prices),
      stock: numberMap(p.stock),
      variants: variants.sort((a, b) => Number(a.blProductId) - Number(b.blProductId)),
    })
  }
  return out
}

export interface PriceGroupInfo {
  id: number
  name: string
  currency: string
  isDefault: boolean
  /** Computed by BaseLinker from another group: writing into it is pointless. */
  derived: boolean
}

export function parsePriceGroups(raw: unknown): PriceGroupInfo[] {
  const out: PriceGroupInfo[] = []
  for (const [key, g] of entriesOf(raw)) {
    const id = positiveId(g.price_group_id) ?? positiveId(key)
    if (!id) continue
    out.push({
      id,
      name: text(g.name) ?? `#${id}`,
      currency: (text(g.currency) ?? "").toUpperCase(),
      isDefault: g.is_default === true || g.is_default === 1,
      derived: (positiveId(g.source_price_group_id) ?? 0) > 0,
    })
  }
  return out
}

export interface WarehouseInfo {
  /** `bl_205`, `shop_2334`: the key stock maps use. */
  key: string
  type: string
  id: number
  name: string
  /** Manual stock editing permitted (`stock_edition`). */
  editable: boolean
  isDefault: boolean
}

export function parseWarehouses(raw: unknown): WarehouseInfo[] {
  const out: WarehouseInfo[] = []
  for (const [, w] of entriesOf(raw)) {
    const type = (text(w.warehouse_type) ?? "").toLowerCase()
    const id = positiveId(w.warehouse_id)
    if (!type || !id) continue
    out.push({
      key: `${type}_${id}`,
      type,
      id,
      name: text(w.name) ?? `${type}_${id}`,
      editable: w.stock_edition === true || w.stock_edition === 1,
      isDefault: w.is_default === true || w.is_default === 1,
    })
  }
  return out
}

/** Categories of `getInventoryCategories`: id to name (and parent). */
export function parseCategories(raw: unknown): Map<number, { name: string; parentId: number | null }> {
  const out = new Map<number, { name: string; parentId: number | null }>()
  for (const [key, c] of entriesOf(raw)) {
    const id = positiveId(c.category_id) ?? positiveId(key)
    const name = text(c.name)
    if (id && name) out.set(id, { name, parentId: positiveId(c.parent_id) })
  }
  return out
}

/** Manufacturers of `getInventoryManufacturers`: id to name. */
export function parseManufacturers(raw: unknown): Map<number, string> {
  const out = new Map<number, string>()
  for (const [key, m] of entriesOf(raw)) {
    const id = positiveId(m.manufacturer_id) ?? positiveId(key)
    const name = text(m.name) ?? text(m.manufacturer_name)
    if (id && name) out.set(id, name)
  }
  return out
}

export interface OrderSourceInfo {
  type: string
  id: number
  name: string
}

/**
 * `sources` of `getOrderSources`: a map of type to a map of id to name. The
 * `order_return` type comes as a plain list and is not an order source to
 * import, so it is left out.
 */
export function parseOrderSources(raw: unknown): OrderSourceInfo[] {
  const out: OrderSourceInfo[] = []
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const [type, accounts] of Object.entries(raw as Record<string, unknown>)) {
    if (type === "order_return" || !accounts || typeof accounts !== "object" || Array.isArray(accounts)) continue
    for (const [id, name] of Object.entries(accounts as Record<string, unknown>)) {
      if (!/^\d+$/.test(id)) continue
      out.push({ type: type.toLowerCase(), id: Number(id), name: text(name) ?? `${type} ${id}` })
    }
  }
  return out.sort((a, b) => (a.type === b.type ? a.id - b.id : a.type < b.type ? -1 : 1))
}

/** Custom order fields of `getOrderExtraFields`. */
export function parseExtraFields(raw: unknown): Array<{ id: number; name: string; type: string }> {
  const out: Array<{ id: number; name: string; type: string }> = []
  for (const [key, f] of entriesOf(raw)) {
    const id = positiveId(f.extra_field_id) ?? positiveId(key)
    if (id) out.push({ id, name: text(f.name) ?? `#${id}`, type: text(f.editor_type) ?? "text" })
  }
  return out
}
