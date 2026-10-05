/**
 * DEMO MODE: A SIMULATED BASELINKER BUILT FROM THE STORE'S OWN CATALOG.
 * Zero imports.
 *
 * Lets anyone evaluate the plugin without a BaseLinker account. The simulated
 * catalog page goes through the SAME parser, matching and stock plan as a real
 * `getInventoryProductsList` answer, so the admin shows what a connected
 * account would. Nothing leaves Medusa, and stock is always plan-only.
 *
 * DETERMINISTIC (FNV-1a hash of the SKU): the same catalog gives the same
 * cards, so the hourly run reports "no changes" instead of churning tables.
 * Every case the admin should demonstrate is in it:
 *
 *   - cards for most variants, stock equal to Medusa for most of them and
 *     different for some, so the stock plan has rows (one is negative);
 *   - a few variants missing in BaseLinker ("only in Medusa");
 *   - one SKU on two cards (a `duplicate_sku` conflict);
 *   - one card without a SKU and two cards that exist only in BaseLinker;
 *   - one card linked by EAN, when a variant of the catalog has an EAN.
 *
 * Since 0.2 the simulated account also has what the catalog import and the
 * writers need: products with several variants as a main card with variant
 * cards (like `include_variants` returns them), product details (name,
 * description, images, weight, category, manufacturer), a product only in
 * BaseLinker with two variants, an EAN shared by two cards, a bundle, a price
 * that differs for some products, price groups, warehouses and order
 * sources. What a simulated writer changed (`DemoOverlay`) is part of the
 * next read, so an applied plan converges to "nothing to change".
 *
 * Orders get BaseLinker ids in seconds (9100000 + sequence), then the
 * simulated warehouse moves them on: "Nowe" right away, "W realizacji" after
 * about a minute, "Wysłane" with an InPost tracking number after about three.
 * Status names are Polish, as a Polish BaseLinker account sends them.
 */

export interface DemoVariant {
  sku: string
  /** First valid EAN of the variant (ean, barcode or upc), if any. */
  ean: string | null
  title: string
  /** Medusa available quantity at the stock location; null when unknown or not managed. */
  available: number | null
  price: number | null
  /* 0.2, optional: products with several variants become a main card with variant cards. */
  productId?: string | null
  productTitle?: string | null
  variantTitle?: string | null
  description?: string | null
  image?: string | null
  category?: string | null
}

/** What the simulated writers changed, read back by the next simulated read. */
export interface DemoOverlay {
  /** Cards created from Medusa variants, by variant id. */
  cards?: Record<string, { blId: string; sku: string; name: string; ean: string | null }>
  /** Names and EANs of cards updated from Medusa, by card id. */
  cardUpdates?: Record<string, { name?: string; ean?: string | null }>
  /** Warehouse stock written from Medusa, by card id. */
  stock?: Record<string, number>
  /** Prices written from Medusa, by card id. */
  prices?: Record<string, number>
}

/** Ids of the simulated account. */
export const DEMO_INVENTORY_ID = 1001
export const DEMO_WAREHOUSE_ID = "bl_1001"
export const DEMO_PRICE_GROUP = "1001"
export const DEMO_ORDER_ID_BASE = 9_100_000

export const DEMO_STATUSES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 100001, name: "Nowe" },
  { id: 100002, name: "W realizacji" },
  { id: 100003, name: "Wysłane" },
  { id: 100004, name: "Dostarczone" },
  { id: 100005, name: "Anulowane" },
]

/** When the simulated warehouse moves an order on, after it was sent (at the fastest pace). */
export const DEMO_IN_PROGRESS_AFTER_MS = 60 * 1000
export const DEMO_SHIPPED_AFTER_MS = 3 * 60 * 1000
/** A shipped order is delivered this long after it shipped. */
export const DEMO_DELIVERED_AFTER_MS = 6 * 60 * 60 * 1000

/**
 * The simulated warehouse is not equally fast for every order, so a list of
 * orders sent at once does not move in lockstep: the fastest ship after about
 * three minutes, the slowest after about 24.
 */
export function demoPace(orderId: string): number {
  return [1, 1, 2, 4, 8][hash32(`${orderId}#pace`) % 5]
}

/** FNV-1a, 32 bit. Stable across processes, so demo data does not jump on a restart. */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function cardId(seed: string, used: Set<string>): string {
  let n = 100_000_000 + (hash32(seed) % 800_000_000)
  while (used.has(String(n))) n += 1
  used.add(String(n))
  return String(n)
}

const DRIFT = [-2, -1, 1, 3]

/** BaseLinker stock of a demo card: Medusa's own number for most cards, a little off for some. */
export function demoStock(v: DemoVariant): number {
  const h = hash32(`stock:${v.sku.toUpperCase()}`)
  if (v.available === null) return 4 + (h % 17)
  if (h % 4 !== 1) return v.available
  return Math.max(0, v.available + DRIFT[(h >>> 3) % DRIFT.length])
}

const bySku = (a: DemoVariant, b: DemoVariant) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)

/** Some BaseLinker prices are 10 % above Medusa's: the price plans of both directions get rows. */
export function demoPrice(v: Pick<DemoVariant, "sku" | "price">): number | null {
  if (v.price === null) return null
  return hash32(`price:${v.sku.toUpperCase()}`) % 6 === 2 ? Math.round(v.price * 110) / 100 : v.price
}

/** Products that exist only in the simulated BaseLinker (and what the catalog import makes of them). */
export const DEMO_BL_ONLY: ReadonlyArray<{
  seed: string
  sku: string
  ean: string
  name: string
  stock: number
  price: number | null
  bundle?: boolean
  variants?: Array<{ seed: string; sku: string; name: string; stock: number; price: number }>
}> = [
  { seed: "demo#bl-only-1", sku: "BL-ONLY-01", ean: "5906660000014", name: "Uchwyt ścienny na narzędzia", stock: 12, price: 49.99 },
  { seed: "demo#bl-only-2", sku: "BL-ONLY-02", ean: "", name: "Organizer warsztatowy", stock: 0, price: 89 },
  { seed: "demo#bl-only-3", sku: "BL-ONLY-03", ean: "5906660000038", name: "Taśma izolacyjna czarna", stock: 30, price: 7.5 },
  { seed: "demo#bl-only-4", sku: "BL-ONLY-04", ean: "5906660000038", name: "Taśma izolacyjna czarna (stara karta)", stock: 2, price: 7.5 },
  { seed: "demo#bl-set", sku: "BL-SET-01", ean: "", name: "Zestaw startowy (komplet)", stock: 4, price: 199, bundle: true },
  {
    seed: "demo#gloves",
    sku: "",
    ean: "",
    name: "Rękawice robocze nitrylowe",
    stock: 0,
    price: null,
    variants: [
      { seed: "demo#gloves-m", sku: "BL-GLOVES-M", name: "M", stock: 40, price: 19.9 },
      { seed: "demo#gloves-l", sku: "BL-GLOVES-L", name: "L", stock: 25, price: 19.9 },
    ],
  },
]

/**
 * The `products` object of a simulated `getInventoryProductsList` answer
 * (with `include_variants`): keyed by card id, like the real one. Feed it to
 * `parseProductsList`. `overlay` is what the simulated writers changed.
 */
export function buildDemoProducts(variants: readonly DemoVariant[], overlay: DemoOverlay = {}): Record<string, Record<string, unknown>> {
  const picked = variants.filter((v) => v.sku && v.sku.trim()).sort(bySku).slice(0, 200)
  const used = new Set<string>()
  const out: Record<string, Record<string, unknown>> = {}
  const groupOf = new Map<string, string>()
  const card = (
    seed: string,
    fields: { sku: string; ean: string; name: string; stock: number; price: number | null; productId?: string | null; parent?: string },
  ): string => {
    const id = cardId(seed, used)
    out[id] = {
      id: Number(id),
      parent_id: fields.parent ? Number(fields.parent) : 0,
      sku: fields.sku,
      ean: fields.ean,
      name: fields.name,
      prices: fields.price !== null ? { [DEMO_PRICE_GROUP]: fields.price } : [],
      stock: { [DEMO_WAREHOUSE_ID]: fields.stock },
    }
    if (fields.productId) groupOf.set(id, fields.productId)
    return id
  }

  /* The first variant (after the special cases) that has an EAN is linked by EAN only. */
  const eanIndex = picked.findIndex((v, i) => i > 2 && Boolean(v.ean))
  /* One card goes negative: overselling, clamped to zero by the plan. */
  const negativeIndex = picked.length > 7 ? (eanIndex === 6 ? 7 : 6) : -1

  picked.forEach((v, i) => {
    const sku = v.sku.trim()
    const h = hash32(`missing:${sku.toUpperCase()}`)
    if (i > 3 && i !== eanIndex && i !== negativeIndex && h % 9 === 0) return
    if (i === eanIndex) {
      card(`${sku}#ean`, { sku: `${sku}-BL`, ean: v.ean ?? "", name: v.title, stock: demoStock(v), price: demoPrice(v), productId: v.productId })
      return
    }
    card(`${sku}#main`, {
      sku,
      ean: "",
      /* One product was renamed in BaseLinker: the name plans of both directions get a row. */
      name: i === 2 ? `${v.title} (wersja BaseLinker)` : v.title,
      stock: i === negativeIndex ? -1 : demoStock(v),
      price: demoPrice(v),
      productId: v.productId,
    })
  })

  /* Variants of one Medusa product become variant cards of one main card, as BaseLinker keeps them. */
  const members = new Map<string, string[]>()
  for (const [id, productId] of groupOf) {
    const list = members.get(productId)
    if (list) list.push(id)
    else members.set(productId, [id])
  }
  const byProduct = new Map(picked.filter((v) => v.productId).map((v) => [v.productId as string, v]))
  for (const [productId, ids] of [...members.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ids.length < 2) continue
    const sample = byProduct.get(productId)
    const parent = card(`${productId}#parent`, { sku: "", ean: "", name: sample?.productTitle ?? sample?.title ?? productId, stock: 0, price: null })
    for (const id of ids) out[id].parent_id = Number(parent)
  }

  const second = picked[1]
  if (second) {
    /* The same SKU on a second card, with another stock: which one is right? Never guessed. */
    card(`${second.sku}#copy`, { sku: second.sku.trim(), ean: "", name: `${second.title} (kopia)`, stock: (demoStock(second) + 2) % 9, price: second.price })
  }
  card("demo#no-sku", { sku: "", ean: "", name: "Zestaw upominkowy (karta bez SKU)", stock: 3, price: null })
  for (const p of DEMO_BL_ONLY) {
    const parent = card(p.seed, { sku: p.sku, ean: p.ean, name: p.name, stock: p.stock, price: p.price })
    for (const v of p.variants ?? []) card(v.seed, { sku: v.sku, ean: "", name: `${p.name} ${v.name}`, stock: v.stock, price: v.price, parent })
  }

  /* What the simulated writers did. */
  for (const c of Object.values(overlay.cards ?? {})) {
    if (out[c.blId]) continue
    used.add(c.blId)
    out[c.blId] = { id: Number(c.blId), parent_id: 0, sku: c.sku, ean: c.ean ?? "", name: c.name, prices: [], stock: { [DEMO_WAREHOUSE_ID]: 0 } }
  }
  for (const [id, u] of Object.entries(overlay.cardUpdates ?? {})) {
    if (!out[id]) continue
    if (u.name !== undefined) out[id].name = u.name
    if (u.ean !== undefined) out[id].ean = u.ean ?? ""
  }
  for (const [id, qty] of Object.entries(overlay.stock ?? {})) if (out[id]) out[id].stock = { [DEMO_WAREHOUSE_ID]: qty }
  for (const [id, price] of Object.entries(overlay.prices ?? {})) if (out[id]) out[id].prices = { [DEMO_PRICE_GROUP]: price }
  return out
}

/* ------------------------------------------------------------------ */
/* 0.2: details, dictionaries and sources of the simulated account     */
/* ------------------------------------------------------------------ */

export const DEMO_MANUFACTURERS: ReadonlyArray<{ manufacturer_id: number; name: string }> = [
  { manufacturer_id: 7, name: "Koda Supply" },
  { manufacturer_id: 8, name: "Robotex" },
]

/** Category of products only in BaseLinker. */
export const DEMO_BL_CATEGORY = "Akcesoria warsztatowe"

/**
 * Simulated `getInventoryProductsData`, `getInventoryCategories` and
 * `getInventoryManufacturers` for every main card of `list` (the output of
 * `buildDemoProducts`). Feed the parts to the real parsers.
 */
export function buildDemoDetails(
  variants: readonly DemoVariant[],
  list: Record<string, Record<string, unknown>>,
): { products: Record<string, Record<string, unknown>>; categories: Array<{ category_id: number; name: string; parent_id: number }>; manufacturers: typeof DEMO_MANUFACTURERS } {
  const bySku = new Map(variants.map((v) => [v.sku.trim().toUpperCase(), v]))
  const blOnly = new Map<string, (typeof DEMO_BL_ONLY)[number]>()
  for (const p of DEMO_BL_ONLY) blOnly.set(p.name, p)
  const names = new Set<string>([DEMO_BL_CATEGORY])
  for (const v of variants) if (v.category) names.add(v.category)
  const categories = [...names].sort().map((name, i) => ({ category_id: 101 + i, name, parent_id: 0 }))
  const categoryId = new Map(categories.map((c) => [c.name, c.category_id]))

  const children = new Map<string, Array<[string, Record<string, unknown>]>>()
  for (const [id, entry] of Object.entries(list)) {
    const parent = String(entry.parent_id ?? 0)
    if (parent === "0") continue
    const kids = children.get(parent)
    if (kids) kids.push([id, entry])
    else children.set(parent, [[id, entry]])
  }

  const variantOf = (entry: Record<string, unknown>): DemoVariant | undefined => {
    const sku = String(entry.sku ?? "").trim().toUpperCase()
    return bySku.get(sku) ?? bySku.get(sku.replace(/-BL$/, ""))
  }

  const products: Record<string, Record<string, unknown>> = {}
  for (const [id, entry] of Object.entries(list)) {
    if (String(entry.parent_id ?? 0) !== "0") continue
    const kids = children.get(id) ?? []
    const own = variantOf(entry) ?? (kids.length > 0 ? variantOf(kids[0][1]) : undefined)
    const special = blOnly.get(String(entry.name ?? ""))
    const listName = String(entry.name ?? "")
    /*
     * The product name, as BaseLinker keeps it on the main card: the product
     * title for a main card with variants or a card named like its variant;
     * the renamed card keeps its new name, a copy keeps its own.
     */
    const renamed = listName.endsWith(" (wersja BaseLinker)")
    const name =
      kids.length > 0
        ? own?.productTitle ?? listName
        : own && listName === own.title
          ? own.productTitle ?? listName
          : renamed && own?.productTitle
            ? `${own.productTitle} (wersja BaseLinker)`
            : listName
    const h = hash32(`details:${id}`)
    const category = own?.category ?? (special ? DEMO_BL_CATEGORY : null)
    const description = own
      ? own.description && h % 7 === 3
        ? `${own.description} Opis uzupełniony w BaseLinkerze.`
        : own.description ?? null
      : special
        ? `${name}. Produkt dodany w BaseLinkerze, jeszcze nie ma go w sklepie.`
        : null
    products[id] = {
      is_bundle: special?.bundle === true,
      parent_id: 0,
      sku: entry.sku ?? "",
      ean: entry.ean ?? "",
      tax_rate: 23,
      weight: Math.round((0.2 + (h % 40) / 10) * 100) / 100,
      category_id: category ? categoryId.get(category) ?? 0 : 0,
      manufacturer_id: special ? 8 : 7,
      prices: entry.prices,
      stock: entry.stock,
      text_fields: { name, ...(description ? { description } : {}) },
      images: own?.image ? { "1": own.image } : {},
      variants: Object.fromEntries(
        kids.map(([kidId, kid]) => {
          const v = variantOf(kid)
          return [
            kidId,
            {
              name: v?.variantTitle ?? String(kid.name ?? "").replace(`${listName} `, ""),
              sku: kid.sku ?? "",
              ean: kid.ean ?? "",
              prices: kid.prices,
              stock: kid.stock,
            },
          ]
        }),
      ),
    }
  }
  return { products, categories, manufacturers: DEMO_MANUFACTURERS }
}

/** Simulated `getInventoryPriceGroups`: a retail group (the configured one) and one derived from it. */
export function demoPriceGroups(): Array<Record<string, unknown>> {
  return [
    { price_group_id: Number(DEMO_PRICE_GROUP), name: "Detal PLN", currency: "PLN", is_default: true, source_price_group_id: 0 },
    { price_group_id: 1002, name: "Allegro PLN (z detalu)", currency: "PLN", is_default: false, source_price_group_id: Number(DEMO_PRICE_GROUP) },
  ]
}

/** Simulated `getInventoryWarehouses`: the BaseLinker warehouse and a shop warehouse that cannot take stock. */
export function demoWarehouses(): Array<Record<string, unknown>> {
  return [
    { warehouse_type: "bl", warehouse_id: 1001, name: "Magazyn główny", stock_edition: true, is_default: true },
    { warehouse_type: "shop", warehouse_id: 2001, name: "Sklep internetowy (stany zewnętrzne)", stock_edition: false, is_default: false },
  ]
}

/** Account ids of the simulated marketplaces. */
export const DEMO_SOURCE_ACCOUNTS = { allegro: 1455, amazon: 7245, medusa: 900001 } as const

/** Simulated `getOrderSources`. */
export function demoOrderSources(): Record<string, Record<string, string>> {
  return {
    personal: { "0": "Osobiście / telefon", [String(DEMO_SOURCE_ACCOUNTS.medusa)]: "Sklep Medusa (Koda Plus)" },
    allegro: { [String(DEMO_SOURCE_ACCOUNTS.allegro)]: "Allegro: koda-demo" },
    amazon: { [String(DEMO_SOURCE_ACCOUNTS.amazon)]: "Amazon.pl demo" },
  }
}

/** Simulated `getOrderExtraFields`: one text field for the invoice number. */
export function demoExtraFields(): Array<Record<string, unknown>> {
  return [{ extra_field_id: 1, name: "Numer faktury", editor_type: "text" }]
}

/** A card id for a card the simulated `cards` writer creates: stable per variant, far from the catalog ids. */
export function demoNewCardId(variantId: string): string {
  return String(950_000_000 + (hash32(`new-card:${variantId}`) % 40_000_000))
}

/** Simulated `getInventories`, for the connection check. */
export function demoInventories(): Array<{ inventory_id: number; name: string; warehouses: string[]; default_warehouse: string }> {
  return [{ inventory_id: DEMO_INVENTORY_ID, name: "Katalog demo", warehouses: [DEMO_WAREHOUSE_ID], default_warehouse: DEMO_WAREHOUSE_ID }]
}

/** The next simulated BaseLinker order id, after the highest one given out. */
export function nextDemoOrderId(highestGiven: number | null): number {
  return highestGiven && highestGiven >= DEMO_ORDER_ID_BASE ? highestGiven + 1 : DEMO_ORDER_ID_BASE + 1
}

/** A 24 digit InPost-like parcel number, stable per order. */
export function demoTrackingNumber(orderId: string): string {
  let digits = "6"
  let seed = orderId
  while (digits.length < 24) {
    seed = String(hash32(seed))
    digits += seed
  }
  return digits.slice(0, 24)
}

/**
 * The simulated BaseLinker order as `getOrders` would return it now: the
 * status follows the time since the order was sent.
 */
export function demoOrder(args: { blOrderId: string; orderId: string; sentAt: Date; now: Date }): {
  order_id: string
  order_status_id: number
  admin_comments: string
  delivery_package_nr: string
  delivery_package_module: string
} {
  const elapsed = args.now.getTime() - args.sentAt.getTime()
  const pace = demoPace(args.orderId)
  const shipAfter = DEMO_SHIPPED_AFTER_MS * pace
  const shipped = elapsed >= shipAfter
  const status =
    elapsed >= shipAfter + DEMO_DELIVERED_AFTER_MS
      ? DEMO_STATUSES[3]
      : shipped
        ? DEMO_STATUSES[2]
        : elapsed >= DEMO_IN_PROGRESS_AFTER_MS * pace
          ? DEMO_STATUSES[1]
          : DEMO_STATUSES[0]
  return {
    order_id: args.blOrderId,
    order_status_id: status.id,
    admin_comments: `[medusa:${args.orderId}]`,
    delivery_package_nr: shipped ? demoTrackingNumber(args.orderId) : "",
    delivery_package_module: shipped ? "inpost" : "",
  }
}
