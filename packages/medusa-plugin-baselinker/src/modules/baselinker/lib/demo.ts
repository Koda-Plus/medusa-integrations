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

/** When the simulated warehouse moves an order on, after it was sent. */
export const DEMO_IN_PROGRESS_AFTER_MS = 60 * 1000
export const DEMO_SHIPPED_AFTER_MS = 3 * 60 * 1000

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

/**
 * The `products` object of a simulated `getInventoryProductsList` answer:
 * keyed by card id, like the real one. Feed it to `parseProductsList`.
 */
export function buildDemoProducts(variants: readonly DemoVariant[]): Record<string, Record<string, unknown>> {
  const picked = variants.filter((v) => v.sku && v.sku.trim()).sort(bySku).slice(0, 200)
  const used = new Set<string>()
  const out: Record<string, Record<string, unknown>> = {}
  const card = (seed: string, fields: { sku: string; ean: string; name: string; stock: number; price: number | null }) => {
    const id = cardId(seed, used)
    out[id] = {
      id: Number(id),
      sku: fields.sku,
      ean: fields.ean,
      name: fields.name,
      prices: fields.price !== null ? { [DEMO_PRICE_GROUP]: fields.price } : [],
      stock: { [DEMO_WAREHOUSE_ID]: fields.stock },
    }
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
      card(`${sku}#ean`, { sku: `${sku}-BL`, ean: v.ean ?? "", name: v.title, stock: demoStock(v), price: v.price })
      return
    }
    card(`${sku}#main`, {
      sku,
      ean: "",
      name: v.title,
      stock: i === negativeIndex ? -1 : demoStock(v),
      price: v.price,
    })
  })

  const second = picked[1]
  if (second) {
    /* The same SKU on a second card, with another stock: which one is right? Never guessed. */
    card(`${second.sku}#copy`, { sku: second.sku.trim(), ean: "", name: `${second.title} (kopia)`, stock: (demoStock(second) + 2) % 9, price: second.price })
  }
  card("demo#no-sku", { sku: "", ean: "", name: "Zestaw upominkowy (karta bez SKU)", stock: 3, price: null })
  card("demo#bl-only-1", { sku: "BL-ONLY-01", ean: "", name: "Produkt tylko w BaseLinkerze 1", stock: 12, price: null })
  card("demo#bl-only-2", { sku: "BL-ONLY-02", ean: "", name: "Produkt tylko w BaseLinkerze 2", stock: 0, price: null })
  return out
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
  const shipped = elapsed >= DEMO_SHIPPED_AFTER_MS
  const status = shipped ? DEMO_STATUSES[2] : elapsed >= DEMO_IN_PROGRESS_AFTER_MS ? DEMO_STATUSES[1] : DEMO_STATUSES[0]
  return {
    order_id: args.blOrderId,
    order_status_id: status.id,
    admin_comments: `[medusa:${args.orderId}]`,
    delivery_package_nr: shipped ? demoTrackingNumber(args.orderId) : "",
    delivery_package_module: shipped ? "inpost" : "",
  }
}
