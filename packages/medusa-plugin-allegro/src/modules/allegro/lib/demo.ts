/**
 * DEMO MODE: SAMPLE OFFERS AND ORDERS BUILT FROM THE STORE'S OWN CATALOG.
 * Zero imports.
 *
 * Lets anyone evaluate the plugin without an Allegro developer account: the
 * objects below are shaped like `GET /sale/offers` and
 * `GET /order/checkout-forms` items and go through the SAME parsers, the SAME
 * matching and the SAME stock check as real data, so the admin shows exactly
 * what a connected account would. Nothing is sent to Allegro in demo mode.
 * Every row is flagged `demo`.
 *
 * Deterministic: the same catalog and the same day give the same offers and
 * orders, so the scheduled runs report "no changes" instead of churning.
 * Quantities are derived from the Medusa quantities on purpose, so the stock
 * check always has something to show: one offer that oversells, one that
 * under-lists, one ended while still in stock.
 */

export interface DemoVariant {
  sku: string
  productTitle: string
  price: { value: number; currency: string } | null
  /** Medusa quantity, null when the variant is not tracked. */
  available: number | null
}

/** FNV-1a, 32 bit. Stable ids across runs and processes. */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function offerId(seed: string, used: Set<string>): string {
  let n = 17_000_000_000 + (hash32(seed) % 900_000_000)
  while (used.has(String(n))) n += 1
  used.add(String(n))
  return String(n)
}

/** A stable UUID-shaped id, like the checkout form ids Allegro uses. */
export function demoUuid(seed: string): string {
  const hex = [0, 1, 2, 3].map((i) => hash32(`${seed}#${i}`).toString(16).padStart(8, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function amount(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function allegroPrice(price: DemoVariant["price"], factor = 1.05): { amount: string; currency: string } | null {
  if (!price) return null
  /* Marketplace prices usually carry the commission: a few percent up, ending in .99. */
  return { amount: amount(Math.max(1, Math.floor(price.value * factor)) + 0.99), currency: price.currency.toUpperCase() }
}

const DAY = 24 * 60 * 60 * 1000

function pickVariants(variants: readonly DemoVariant[]): DemoVariant[] {
  return [...variants]
    .filter((v) => v.sku && v.productTitle)
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))
    .slice(0, 12)
}

/**
 * Raw objects shaped like `GET /sale/offers` `offers[]` items. Feed them to
 * `offersFromApi`, exactly like a page read from Allegro.
 */
export function buildDemoRawOffers(variants: readonly DemoVariant[], now: Date): Record<string, unknown>[] {
  const picked = pickVariants(variants)
  const used = new Set<string>()
  const out: Record<string, unknown>[] = []

  const push = (args: {
    seed: string
    name: string
    status: "ACTIVE" | "ACTIVATING" | "INACTIVE" | "ENDED"
    externalId: string | null
    price: DemoVariant["price"]
    available: number
    ageDays: number
    priceFactor?: number
  }): string => {
    const id = offerId(args.seed, used)
    const started = new Date(now.getTime() - args.ageDays * DAY)
    const ended = args.status === "ENDED" ? new Date(started.getTime() + 9 * DAY) : null
    out.push({
      id,
      name: args.name.slice(0, 75),
      category: { id: String(260000 + (hash32(args.seed) % 9000)) },
      primaryImage: null,
      sellingMode: { format: "BUY_NOW", price: allegroPrice(args.price, args.priceFactor) },
      saleInfo: { currentPrice: null, biddersCount: 0 },
      stock: { available: args.available, sold: hash32(`${args.seed}#sold`) % 7 },
      publication: {
        status: args.status,
        startedAt: args.status === "INACTIVE" ? null : started.toISOString(),
        endingAt: null,
        endedBy: ended ? "USER" : null,
      },
      external: args.externalId ? { id: args.externalId } : null,
    })
    return id
  }

  picked.forEach((v, i) => {
    const medusa = v.available ?? 5
    const status = i === 3 ? "ENDED" : i === 7 ? "INACTIVE" : i === 9 ? "ACTIVATING" : "ACTIVE"
    let available = Math.max(1, medusa)
    if (i === 1) available = medusa + 3 /* oversell: Allegro sells three items Medusa does not have */
    if (i === 5) available = medusa + 1 /* oversell by one */
    if (i === 6) available = Math.max(1, medusa - 2) /* under-listed */
    if (status === "ENDED") available = 0
    push({ seed: `${v.sku}#main`, name: v.productTitle, status, externalId: v.sku, price: v.price, available, ageDays: 3 + i * 4 })
  })

  const [first, second] = picked
  if (first) {
    /* An older, ended offer of the first item: the live one must stay primary. */
    push({ seed: `${first.sku}#old`, name: first.productTitle, status: "ENDED", externalId: first.sku, price: first.price, available: 0, ageDays: 80 })
    /* A live set whose signature is not in the catalog: "live without product". */
    push({
      seed: `${first.sku}#set`,
      name: `${first.productTitle} (komplet 2 szt.)`,
      status: "ACTIVE",
      externalId: `${first.sku}-KPL2`,
      price: first.price,
      available: 2,
      ageDays: 5,
      priceFactor: 2.02,
    })
  }
  if (second) {
    push({
      seed: `${second.sku}#b`,
      name: `${second.productTitle} (powystawowy)`,
      status: "ACTIVE",
      externalId: `${second.sku}-B`,
      price: second.price,
      available: 1,
      ageDays: 8,
      priceFactor: 0.8,
    })
    /* A live offer with no signature at all: nothing to match on. */
    push({ seed: `${second.sku}#nosig`, name: `${second.productTitle} (używany)`, status: "ACTIVE", externalId: null, price: second.price, available: 1, ageDays: 12, priceFactor: 0.6 })
  }
  return out
}

const DELIVERY = ["Allegro Paczkomaty InPost", "Allegro Kurier DPD", "Allegro One Box, One Kurier", "Allegro Kurier24 InPost"]

/**
 * Raw objects shaped like `GET /order/checkout-forms` `checkoutForms[]` items,
 * built from the demo offers so the lines link the same way real ones do.
 * No buyer data, like the real journal.
 */
export function buildDemoRawOrders(rawOffers: readonly Record<string, unknown>[], now: Date): Record<string, unknown>[] {
  type O = { id: string; name: string; external: string | null; price: number; currency: string; status: string }
  const offers: O[] = rawOffers.map((r) => {
    const selling = (r.sellingMode ?? {}) as { price?: { amount?: string; currency?: string } | null }
    const pub = (r.publication ?? {}) as { status?: string }
    const ext = (r.external ?? null) as { id?: string } | null
    return {
      id: String(r.id),
      name: String(r.name),
      external: ext?.id ?? null,
      price: Number(selling.price?.amount ?? 0),
      currency: String(selling.price?.currency ?? "PLN"),
      status: String(pub.status ?? ""),
    }
  })
  const live = offers.filter((o) => o.status === "ACTIVE" || o.status === "ENDED")
  if (live.length === 0) return []

  const plans: Array<{ lines: Array<[number, number]>; status: string; fulfillment: string; hoursAgo: number }> = [
    { lines: [[0, 1]], status: "READY_FOR_PROCESSING", fulfillment: "NEW", hoursAgo: 3 },
    { lines: [[1, 2]], status: "READY_FOR_PROCESSING", fulfillment: "PROCESSING", hoursAgo: 20 },
    { lines: [[2, 1], [4, 1]], status: "READY_FOR_PROCESSING", fulfillment: "SENT", hoursAgo: 30 },
    { lines: [[live.length - 3, 1]], status: "READY_FOR_PROCESSING", fulfillment: "READY_FOR_SHIPMENT", hoursAgo: 44 },
    { lines: [[5, 1]], status: "CANCELLED", fulfillment: "CANCELLED", hoursAgo: 60 },
    { lines: [[6, 1]], status: "BOUGHT", fulfillment: "NEW", hoursAgo: 70 },
    { lines: [[8, 1], [0, 1]], status: "READY_FOR_PROCESSING", fulfillment: "PICKED_UP", hoursAgo: 96 },
    { lines: [[3, 1]], status: "READY_FOR_PROCESSING", fulfillment: "SENT", hoursAgo: 130 },
  ]

  return plans.map((plan, n) => {
    const bought = new Date(now.getTime() - plan.hoursAgo * 60 * 60 * 1000)
    const updated = new Date(bought.getTime() + (plan.fulfillment === "NEW" ? 15 : 26 * 60) * 60 * 1000)
    const lineItems = plan.lines.map(([index, quantity], k) => {
      const o = live[Math.abs(index) % live.length]
      return {
        id: demoUuid(`line#${n}#${k}`),
        offer: { id: o.id, name: o.name, external: o.external ? { id: o.external } : null },
        quantity,
        originalPrice: { amount: amount(o.price), currency: o.currency },
        price: { amount: amount(o.price), currency: o.currency },
        boughtAt: bought.toISOString(),
      }
    })
    const currency = lineItems[0]?.price.currency ?? "PLN"
    const goods = lineItems.reduce((s, l) => s + Number(l.price.amount) * l.quantity, 0)
    const shipping = n % 3 === 0 ? 0 : 12.99
    return {
      id: demoUuid(`order#${n}#${bought.toISOString().slice(0, 10)}`),
      status: plan.status,
      fulfillment: { status: plan.fulfillment },
      delivery: { method: { name: DELIVERY[n % DELIVERY.length] } },
      marketplace: { id: "allegro-pl" },
      summary: { totalToPay: { amount: amount(goods + shipping), currency } },
      lineItems,
      updatedAt: updated.toISOString(),
    }
  })
}
