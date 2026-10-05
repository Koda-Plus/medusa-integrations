/**
 * DEMO MODE: MARKETPLACE ORDERS AND RETURNS OF THE SIMULATED ACCOUNT. Pure;
 * imports only other pure files of this folder.
 *
 * The simulated BaseLinker collects a few orders a day from a simulated
 * Allegro and a simulated Amazon account: between one and five a day,
 * deterministic (the same day always has the same orders), confirmed at
 * times spread over the day, so a visitor sees new ones arrive. They are
 * built from the cards of the simulated catalog and go through the SAME
 * mapping and workflows as real ones, so an armed import really creates
 * Medusa orders in the demo store.
 *
 * Buyers are fictional and every e-mail address is on example.com (a domain
 * reserved for documentation, which never receives mail).
 *
 * The simulated warehouse moves an imported order on: "Nowe", then
 * "W realizacji" after 20 minutes, "Wysłane" with a parcel number after two
 * hours, "Dostarczone" a day later. The fourth order of a day is cancelled in
 * BaseLinker after 15 minutes, so the cancel rule shows. Some delivered
 * orders come back as returns.
 */

import { DEMO_INVENTORY_ID, DEMO_SOURCE_ACCOUNTS, DEMO_STATUSES, hash32 } from "./demo"
import type { BlOrder } from "./order-import"

export const DEMO_IMPORT_ORDER_ID_BASE = 9_200_000

/** A card the simulated marketplaces sell. */
export interface DemoSellable {
  blId: string
  sku: string
  name: string
  price: number | null
}

const BUYERS: ReadonlyArray<{ first: string; last: string; mail: string }> = [
  { first: "Anna", last: "Nowak", mail: "anna.nowak" },
  { first: "Piotr", last: "Wiśniewski", mail: "piotr.wisniewski" },
  { first: "Katarzyna", last: "Wójcik", mail: "katarzyna.wojcik" },
  { first: "Tomasz", last: "Kamiński", mail: "tomasz.kaminski" },
  { first: "Magdalena", last: "Lewandowska", mail: "magdalena.lewandowska" },
  { first: "Michał", last: "Zieliński", mail: "michal.zielinski" },
  { first: "Agnieszka", last: "Szymańska", mail: "agnieszka.szymanska" },
  { first: "Paweł", last: "Woźniak", mail: "pawel.wozniak" },
]

const PLACES: ReadonlyArray<{ street: string; postcode: string; city: string; point: string }> = [
  { street: "ul. Przykładowa 12", postcode: "00-950", city: "Warszawa", point: "WAW01M" },
  { street: "ul. Testowa 5/3", postcode: "30-001", city: "Kraków", point: "KRA02N" },
  { street: "ul. Demonstracyjna 8", postcode: "60-101", city: "Poznań", point: "POZ07A" },
  { street: "ul. Wzorcowa 21", postcode: "80-001", city: "Gdańsk", point: "GDA03M" },
  { street: "ul. Próbna 4", postcode: "50-001", city: "Wrocław", point: "WRO11B" },
]

/** At most five orders a day, at least one. */
export const DEMO_MAX_ORDERS_PER_DAY = 5

const DAY_MS = 24 * 3600 * 1000

export function dayNumber(at: Date): number {
  return Math.floor(at.getTime() / DAY_MS)
}

function hex(seed: string, length: number): string {
  let out = ""
  let s = seed
  while (out.length < length) {
    s = String(hash32(s))
    out += Number(s).toString(16).padStart(8, "0")
  }
  return out.slice(0, length)
}

function digits(seed: string, length: number): string {
  let out = ""
  let s = seed
  while (out.length < length) {
    s = String(hash32(s))
    out += s
  }
  return out.slice(0, length)
}

/** How many orders a day has: 1 to 5, stable per day. */
export function ordersOfDay(day: number): number {
  return 1 + (hash32(`day:${day}`) % DEMO_MAX_ORDERS_PER_DAY)
}

/** One simulated marketplace order, as `getOrders` would return it (status at `now`). */
export function demoMarketplaceOrder(day: number, index: number, cards: readonly DemoSellable[], now: Date): BlOrder | null {
  const count = ordersOfDay(day)
  if (index < 0 || index >= count || cards.length === 0) return null
  const h = hash32(`order:${day}:${index}`)
  const startMinute = 7 * 60 + Math.floor(((14 * 60) * (index + 0.5)) / count) + ((h % 21) - 10)
  const confirmed = Math.floor((day * DAY_MS + startMinute * 60 * 1000) / 1000)
  const allegro = hash32(`src:${day}:${index}`) % 5 < 3
  const buyer = BUYERS[h % BUYERS.length]
  const place = PLACES[(h >>> 4) % PLACES.length]
  const lineCount = 1 + ((h >>> 7) % 2)
  const products = Array.from({ length: lineCount }, (_, i) => {
    const card = cards[(hash32(`line:${day}:${index}:${i}`) >>> 2) % cards.length]
    return {
      storage: "db",
      storage_id: DEMO_INVENTORY_ID,
      order_product_id: Number(`${(day % 1000) * 100 + index * 10 + i + 1}`),
      product_id: card.blId,
      variant_id: "0",
      name: card.name,
      sku: card.sku,
      ean: "",
      price_brutto: card.price ?? 49.99,
      tax_rate: 23,
      quantity: 1 + ((h >>> (9 + i)) % 2),
    }
  })
  const deliveryPrice = allegro ? 9.99 : 14.99
  const total = Math.round((products.reduce((s, p) => s + p.price_brutto * p.quantity, 0) + deliveryPrice) * 100) / 100
  const cod = allegro && h % 5 === 4
  const invoice = h % 4 === 1
  const status = demoMarketplaceStatus({ day, index, confirmedAt: new Date(confirmed * 1000), now, carrier: allegro ? "inpost" : "dpd" })
  return {
    order_id: DEMO_IMPORT_ORDER_ID_BASE + (day % 50_000) * 10 + index,
    external_order_id: allegro
      ? `${hex(`a:${day}:${index}`, 8)}-${hex(`b:${day}:${index}`, 4)}-11ef-${hex(`c:${day}:${index}`, 4)}-${hex(`d:${day}:${index}`, 12)}`
      : `405-${digits(`e:${day}:${index}`, 7)}-${digits(`f:${day}:${index}`, 7)}`,
    order_source: allegro ? "allegro" : "amazon",
    order_source_id: allegro ? DEMO_SOURCE_ACCOUNTS.allegro : DEMO_SOURCE_ACCOUNTS.amazon,
    order_status_id: status.order_status_id,
    confirmed: true,
    date_add: confirmed - 120,
    date_confirmed: confirmed,
    currency: "PLN",
    payment_method: cod ? "Pobranie" : allegro ? "Allegro Finance" : "Amazon Pay",
    payment_method_cod: cod ? "1" : "0",
    payment_done: cod ? 0 : total,
    email: `${buyer.mail}.${day % 1000}${index}@example.com`,
    phone: `+48 500 000 ${String(100 + (h % 900))}`,
    user_comments: index === 0 ? "Proszę o staranne zapakowanie." : "",
    admin_comments: "",
    delivery_method: allegro ? "Allegro Paczkomaty InPost" : "Kurier DPD",
    delivery_price: deliveryPrice,
    delivery_fullname: `${buyer.first} ${buyer.last}`,
    delivery_company: "",
    delivery_address: place.street,
    delivery_postcode: place.postcode,
    delivery_city: place.city,
    delivery_state: "",
    delivery_country_code: "PL",
    delivery_point_id: allegro ? place.point : "",
    delivery_point_name: allegro ? `Paczkomat ${place.point}` : "",
    delivery_point_address: allegro ? place.street : "",
    delivery_point_postcode: allegro ? place.postcode : "",
    delivery_point_city: allegro ? place.city : "",
    want_invoice: invoice ? "1" : "0",
    invoice_fullname: invoice ? `${buyer.first} ${buyer.last}` : "",
    invoice_company: invoice ? "Firma Demo Sp. z o.o." : "",
    invoice_nip: invoice ? "5250000000" : "",
    invoice_address: invoice ? place.street : "",
    invoice_postcode: invoice ? place.postcode : "",
    invoice_city: invoice ? place.city : "",
    invoice_country_code: invoice ? "PL" : "",
    delivery_package_module: status.delivery_package_module,
    delivery_package_nr: status.delivery_package_nr,
    products,
  }
}

/** Every simulated order of the last `days` days (today included) that is confirmed by `now`, oldest first. */
export function demoMarketplaceOrders(args: { now: Date; days: number; cards: readonly DemoSellable[] }): BlOrder[] {
  const today = dayNumber(args.now)
  const out: BlOrder[] = []
  for (let d = today - Math.max(0, args.days - 1); d <= today; d += 1) {
    for (let i = 0; i < ordersOfDay(d); i += 1) {
      const o = demoMarketplaceOrder(d, i, args.cards, args.now)
      if (o && Number(o.date_confirmed) * 1000 <= args.now.getTime()) out.push(o)
    }
  }
  return out.sort((a, b) => Number(a.date_confirmed) - Number(b.date_confirmed) || Number(a.order_id) - Number(b.order_id))
}

/** The simulated order behind a BaseLinker id, or null when the id is not one of the simulation. */
export function demoMarketplaceOrderById(blOrderId: string | number, cards: readonly DemoSellable[], now: Date): BlOrder | null {
  const n = Number(blOrderId) - DEMO_IMPORT_ORDER_ID_BASE
  if (!Number.isFinite(n) || n < 0) return null
  const index = n % 10
  const today = dayNumber(now)
  /* The id keeps the day modulo 50 000: take the most recent day that matches. */
  const dayMod = Math.floor(n / 10)
  const day = today - ((((today % 50_000) - dayMod) % 50_000) + 50_000) % 50_000
  const o = demoMarketplaceOrder(day, index, cards, now)
  return o && Number(o.date_confirmed) * 1000 <= now.getTime() ? o : null
}

/** Status and parcel of a simulated marketplace order at `now`. */
export function demoMarketplaceStatus(args: { day: number; index: number; confirmedAt: Date; now: Date; carrier: string }): {
  order_status_id: number
  delivery_package_module: string
  delivery_package_nr: string
} {
  const elapsed = args.now.getTime() - args.confirmedAt.getTime()
  if (args.index === 3 && elapsed >= 15 * 60 * 1000) return { order_status_id: DEMO_STATUSES[4].id, delivery_package_module: "", delivery_package_nr: "" }
  if (elapsed < 20 * 60 * 1000) return { order_status_id: DEMO_STATUSES[0].id, delivery_package_module: "", delivery_package_nr: "" }
  if (elapsed < 2 * 3600 * 1000) return { order_status_id: DEMO_STATUSES[1].id, delivery_package_module: "", delivery_package_nr: "" }
  const parcel = args.carrier === "dpd" ? `1050${digits(`p:${args.day}:${args.index}`, 10)}U` : `6${digits(`p:${args.day}:${args.index}`, 23)}`
  const status = elapsed >= 26 * 3600 * 1000 ? DEMO_STATUSES[3] : DEMO_STATUSES[2]
  return { order_status_id: status.id, delivery_package_module: args.carrier, delivery_package_nr: parcel }
}

/* ------------------------------------------------------------------ */
/* Returns                                                             */
/* ------------------------------------------------------------------ */

export const DEMO_RETURN_STATUSES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 2001, name: "Nowy zwrot" },
  { id: 2002, name: "Przyjęty do magazynu" },
  { id: 2003, name: "Pieniądze zwrócone" },
]

export const DEMO_RETURN_REASONS: ReadonlyArray<{ return_reason_id: number; name: string }> = [
  { return_reason_id: 1002, name: "Pomyłka przy zakupie" },
  { return_reason_id: 1005, name: "Uszkodzony towar" },
  { return_reason_id: 1007, name: "Nie pasuje" },
]

/** An order the simulated return manager knows: one of ours (sent or imported). */
export interface DemoReturnSource {
  blOrderId: string
  source: string
  at: Date
  lines: Array<{ name: string; sku: string | null; price: number; quantity: number }>
}

/**
 * Simulated `getOrderReturns` (raw, personal fields included like the real
 * one, so the same code drops them): one order in four, delivered a day
 * earlier, comes back; the return moves from new to accepted to refunded.
 */
export function demoReturns(orders: readonly DemoReturnSource[], now: Date): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const o of orders) {
    const h = hash32(`return:${o.blOrderId}`)
    if (h % 4 !== 0 || o.lines.length === 0) continue
    const createdAt = o.at.getTime() + 28 * 3600 * 1000
    if (createdAt > now.getTime()) continue
    const elapsed = now.getTime() - createdAt
    const status = elapsed >= 30 * 3600 * 1000 ? DEMO_RETURN_STATUSES[2] : elapsed >= 6 * 3600 * 1000 ? DEMO_RETURN_STATUSES[1] : DEMO_RETURN_STATUSES[0]
    const line = o.lines[h % o.lines.length]
    const reason = DEMO_RETURN_REASONS[(h >>> 3) % DEMO_RETURN_REASONS.length]
    out.push({
      return_id: 3_000_000 + (h % 900_000),
      order_id: Number(o.blOrderId),
      external_order_id: o.source === "allegro" ? `ret-${hex(`r:${o.blOrderId}`, 10)}` : "",
      order_return_source: o.source,
      order_return_source_id: 0,
      status_id: status.id,
      date_add: Math.floor(createdAt / 1000),
      date_in_status: Math.floor(createdAt / 1000),
      currency: "PLN",
      refunded: status.id === DEMO_RETURN_STATUSES[2].id ? (line.price * 1).toFixed(2) : "0.00",
      email: "zwrot@example.com",
      phone: "+48 500 000 000",
      delivery_fullname: "Kupujący Demo",
      delivery_address: "ul. Przykładowa 1",
      order_return_account_number: "00000000000000000000000000",
      fulfillment_status: status.id === DEMO_RETURN_STATUSES[2].id ? 1 : 0,
      products: [
        {
          order_return_product_id: h % 100_000,
          name: line.name,
          sku: line.sku ?? "",
          price_brutto: line.price,
          quantity: 1,
          status_id: 0,
          return_reason_id: reason.return_reason_id,
          return_reason_comment: "Komentarz kupującego",
        },
      ],
    })
  }
  return out
}
