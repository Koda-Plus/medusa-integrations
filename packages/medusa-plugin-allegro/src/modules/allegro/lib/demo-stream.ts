/**
 * DEMO MODE, PART TWO: A SIMULATED ALLEGRO ACCOUNT THAT SELLS. Zero imports
 * beyond the demo helpers.
 *
 * From the demo offers (built from the store's own catalog) this file makes
 * a deterministic stream of checkout forms: three to five a day, never more
 * than five, at fixed times of the day, with the events Allegro would emit
 * for them (BOUGHT, READY_FOR_PROCESSING, and now and then a cancellation).
 * The order import reads them through the SAME parsers and the SAME
 * workflow as a real account, so an armed import really creates Medusa
 * orders, in the "Allegro (demo)" sales channel.
 *
 * Buyers are fictional and every e-mail is at example.com, a domain reserved
 * for examples. Returns, disputes, claims and message threads are derived
 * from the same stream. Nothing here ever reaches Allegro.
 */

import { DEMO_FORMS_PER_DAY } from "./constants"
import { demoUuid, hash32 } from "./demo"

const DAY_MS = 24 * 60 * 60 * 1000
const EPOCH = Date.UTC(2026, 0, 1)

/** Minutes after midnight UTC of the five daily purchases. */
const SLOTS = [8 * 60 + 10, 10 * 60 + 45, 13 * 60 + 20, 16 * 60 + 35, 19 * 60 + 50]

const BUYERS = [
  { first: "Anna", last: "Nowak", city: "Warszawa", zip: "00-950" },
  { first: "Piotr", last: "Kowalski", city: "Kraków", zip: "30-001" },
  { first: "Katarzyna", last: "Wiśniewska", city: "Wrocław", zip: "50-001" },
  { first: "Tomasz", last: "Wójcik", city: "Poznań", zip: "60-001" },
  { first: "Magdalena", last: "Kamińska", city: "Gdańsk", zip: "80-001" },
  { first: "Michał", last: "Lewandowski", city: "Łódź", zip: "90-001" },
]

export interface DemoOffer {
  id: string
  name: string
  external: string | null
  price: number
  currency: string
  status: string
}

/** The demo offers as plain facts (from the raw `GET /sale/offers` shapes of `buildDemoRawOffers`). */
export function demoOffersFromRaw(raw: ReadonlyArray<Record<string, unknown>>): DemoOffer[] {
  return raw.map((r) => {
    const selling = (r.sellingMode ?? {}) as { price?: { amount?: string; currency?: string } | null }
    const pub = (r.publication ?? {}) as { status?: string }
    const ext = (r.external ?? null) as { id?: string } | null
    return {
      id: String(r.id),
      name: String(r.name),
      external: ext?.id ?? null,
      price: Number(selling.price?.amount ?? 0),
      currency: String(selling.price?.currency ?? "PLN").toUpperCase(),
      status: String(pub.status ?? ""),
    }
  })
}

export function dayStart(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

export function dayIndex(day: Date): number {
  return Math.max(0, Math.floor((dayStart(day).getTime() - EPOCH) / DAY_MS))
}

/** Numeric event ids that grow with time: 9, the day, the minute of the day, the kind. */
export function demoEventId(day: Date, minute: number, kind: number): string {
  return `9${String(dayIndex(day)).padStart(5, "0")}${String(Math.max(0, Math.min(1439, minute))).padStart(4, "0")}${kind}`
}

export interface DemoFormSeed {
  id: string
  day: string
  slot: number
  boughtAt: Date
  readyAt: Date
  cancelAt: Date | null
  buyer: (typeof BUYERS)[number] & { n: number; email: string; login: string; phone: string }
  locker: boolean
  cod: boolean
  invoice: boolean
  lines: Array<{ lineId: string; offer: DemoOffer; quantity: number }>
}

function money(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2)
}

/**
 * The purchases of one day: three to five, at fixed minutes. Lines come from
 * live offers with a signature in the catalog; every third day the last
 * purchase is a set whose signature is NOT in the catalog, so the import
 * shows how it holds an order instead of inventing a product.
 */
export function demoFormSeeds(offers: readonly DemoOffer[], day: Date): DemoFormSeed[] {
  const start = dayStart(day)
  const dayKey = start.toISOString().slice(0, 10)
  const index = dayIndex(start)
  const live = offers.filter((o) => o.status === "ACTIVE" && o.external && o.price > 0)
  const mapped = live.filter((o) => !/-KPL2$|-B$/.test(o.external as string))
  const set = live.find((o) => /-KPL2$/.test(o.external as string)) ?? null
  if (mapped.length === 0) return []
  const count = Math.min(DEMO_FORMS_PER_DAY, 3 + (hash32(`count#${dayKey}`) % 3))
  const out: DemoFormSeed[] = []
  for (let slot = 0; slot < count; slot += 1) {
    const h = hash32(`form#${dayKey}#${slot}`)
    const buyerIndex = (index + slot) % BUYERS.length
    const n = (index * 7 + slot) % 997
    const boughtAt = new Date(start.getTime() + SLOTS[slot] * 60_000)
    const readyAt = new Date(boughtAt.getTime() + 4 * 60_000)
    const first = mapped[h % mapped.length]
    const second = mapped[(h >>> 8) % mapped.length]
    const unmappedDay = index % 3 === 0 && slot === count - 1 && set !== null
    const lines: DemoFormSeed["lines"] = unmappedDay
      ? [{ lineId: demoUuid(`line#${dayKey}#${slot}#0`), offer: set as DemoOffer, quantity: 1 }]
      : [{ lineId: demoUuid(`line#${dayKey}#${slot}#0`), offer: first, quantity: 1 + ((h >>> 4) % 2) }]
    if (!unmappedDay && slot === 2 && second.id !== first.id) lines.push({ lineId: demoUuid(`line#${dayKey}#${slot}#1`), offer: second, quantity: 1 })
    out.push({
      id: demoUuid(`checkout#${dayKey}#${slot}`),
      day: dayKey,
      slot,
      boughtAt,
      readyAt,
      /* Every other day the fourth purchase is cancelled by the buyer 90 minutes later. */
      cancelAt: slot === 3 && index % 2 === 0 ? new Date(boughtAt.getTime() + 90 * 60_000) : null,
      buyer: {
        ...BUYERS[buyerIndex],
        n,
        email: `kupujacy.${(h >>> 4).toString(36).slice(0, 6)}@example.com`,
        login: `demo_kupujacy_${n}`,
        phone: `+48 000 000 ${String(n).padStart(3, "0")}`,
      },
      locker: slot % 2 === 0,
      cod: slot === 1,
      invoice: slot === 2,
      lines,
    })
  }
  return out
}

/** Seeds of the given days, purchases up to `now` only. */
export function demoSeedsUntil(offers: readonly DemoOffer[], days: readonly Date[], now: Date): DemoFormSeed[] {
  return days.flatMap((d) => demoFormSeeds(offers, d)).filter((s) => s.boughtAt.getTime() <= now.getTime())
}

/**
 * One seed as `GET /order/checkout-forms/{id}` would answer at `now`.
 * `fulfillment` is the simulated seller status (the shipping writer moves it).
 */
export function demoCheckoutFormRaw(seed: DemoFormSeed, now: Date, fulfillment: string | null = null): Record<string, unknown> {
  const cancelled = seed.cancelAt !== null && now.getTime() >= seed.cancelAt.getTime()
  const ready = now.getTime() >= seed.readyAt.getTime()
  const status = cancelled ? "CANCELLED" : ready ? "READY_FOR_PROCESSING" : "BOUGHT"
  const currency = seed.lines[0]?.offer.currency ?? "PLN"
  const goods = seed.lines.reduce((s, l) => s + l.offer.price * l.quantity, 0)
  const shipping = goods >= 200 ? 0 : seed.locker ? 9.99 : 14.99
  const total = goods + shipping
  const b = seed.buyer
  const street = `ul. Przykładowa ${(b.n % 90) + 1}`
  return {
    id: seed.id,
    messageToSeller: null,
    buyer: {
      id: String(100000 + b.n),
      email: b.email,
      login: b.login,
      firstName: b.first,
      lastName: b.last,
      companyName: null,
      guest: false,
      phoneNumber: b.phone,
    },
    payment: {
      id: demoUuid(`payment#${seed.id}`),
      type: seed.cod ? "CASH_ON_DELIVERY" : "ONLINE",
      provider: seed.cod ? null : "P24",
      finishedAt: ready ? seed.readyAt.toISOString() : null,
      paidAmount: !seed.cod && ready ? { amount: money(total), currency } : null,
    },
    status,
    fulfillment: { status: cancelled ? "CANCELLED" : fulfillment ?? "NEW" },
    delivery: {
      address: { firstName: b.first, lastName: b.last, street, city: b.city, zipCode: b.zip, countryCode: "PL", companyName: null, phoneNumber: b.phone },
      method: seed.locker
        ? { id: "demo-allegro-paczkomaty-inpost", name: "Allegro Paczkomaty InPost" }
        : { id: "demo-allegro-kurier-dpd", name: "Allegro Kurier DPD" },
      pickupPoint: seed.locker
        ? {
            id: `DEMO${String(b.n).padStart(3, "0")}M`,
            name: `Paczkomat DEMO${String(b.n).padStart(3, "0")}M`,
            description: "Punkt przykładowy (demo)",
            address: { street: "ul. Przykładowa 1", zipCode: b.zip, city: b.city, countryCode: "PL" },
          }
        : null,
      cost: { amount: money(shipping), currency },
      smart: false,
    },
    invoice: seed.invoice
      ? {
          required: true,
          address: {
            street: "ul. Przykładowa 10",
            city: b.city,
            zipCode: b.zip,
            countryCode: "PL",
            company: { name: "Przykładowa Firma Sp. z o.o.", ids: [{ type: "PL_NIP", value: "1234563218" }], vatPayerStatus: "ACTIVE" },
            naturalPerson: null,
          },
        }
      : { required: false },
    lineItems: seed.lines.map((l) => ({
      id: l.lineId,
      offer: { id: l.offer.id, name: l.offer.name, external: l.offer.external ? { id: l.offer.external } : null },
      quantity: l.quantity,
      originalPrice: { amount: money(l.offer.price), currency },
      price: { amount: money(l.offer.price), currency },
      tax: { rate: "23.00", subject: "GOODS", exemption: null },
      boughtAt: seed.boughtAt.toISOString(),
    })),
    surcharges: [],
    marketplace: { id: "allegro-pl" },
    summary: { totalToPay: { amount: money(total), currency } },
    updatedAt: (cancelled ? (seed.cancelAt as Date) : ready ? seed.readyAt : seed.boughtAt).toISOString(),
    revision: (hash32(`${seed.id}#${status}#${fulfillment ?? ""}`) >>> 0).toString(16).padStart(8, "0"),
  }
}

/** The events of the given seeds that happened up to `now`, oldest first, shaped like `GET /order/events`. */
export function demoEventsRaw(seeds: readonly DemoFormSeed[], now: Date): Array<Record<string, unknown>> {
  const events: Array<{ id: string; type: string; at: Date; form: string }> = []
  for (const s of seeds) {
    const day = dayStart(s.boughtAt)
    const minute = (t: Date) => Math.floor((t.getTime() - day.getTime()) / 60_000)
    events.push({ id: demoEventId(day, minute(s.boughtAt), 0), type: "BOUGHT", at: s.boughtAt, form: s.id })
    events.push({ id: demoEventId(day, minute(s.readyAt), 1), type: "READY_FOR_PROCESSING", at: s.readyAt, form: s.id })
    if (s.cancelAt) events.push({ id: demoEventId(day, minute(s.cancelAt), 2), type: "BUYER_CANCELLED", at: s.cancelAt, form: s.id })
  }
  return events
    .filter((e) => e.at.getTime() <= now.getTime())
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => ({ id: e.id, type: e.type, occurredAt: e.at.toISOString(), order: { checkoutForm: { id: e.form } } }))
}

/** The simulated carriers: only ids the Allegro documentation shows. */
export function demoCarriersRaw(): Record<string, unknown> {
  return {
    carriers: [
      { id: "INPOST", name: "InPost" },
      { id: "DHL", name: "DHL" },
      { id: "UPS", name: "UPS" },
      { id: "POCZTA_POLSKA", name: "Poczta Polska" },
      { id: "OTHER", name: "Other" },
    ],
  }
}

/** A tracking number shaped like an InPost one (24 digits), stable per order. */
export function demoWaybill(checkoutFormId: string): string {
  const a = String(hash32(`waybill#${checkoutFormId}#a`)).padStart(10, "0")
  const b = String(hash32(`waybill#${checkoutFormId}#b`)).padStart(10, "0")
  return `6000${a}${b}`.slice(0, 24)
}

/** Returns, disputes and claims built from the purchases of the last week. */
export function demoIssuesRaw(seeds: readonly DemoFormSeed[], now: Date): { returns: Record<string, unknown>; issues: Record<string, unknown> } {
  const ready = seeds.filter((s) => s.cancelAt === null && s.readyAt.getTime() <= now.getTime()).sort((a, b) => a.boughtAt.getTime() - b.boughtAt.getTime())
  const pick = (i: number) => ready[Math.max(0, Math.min(ready.length - 1, i))]
  const customerReturns: Array<Record<string, unknown>> = []
  const issues: Array<Record<string, unknown>> = []
  if (ready.length >= 2) {
    const r1 = pick(0)
    customerReturns.push({
      id: demoUuid(`return#${r1.id}`),
      createdAt: new Date(r1.boughtAt.getTime() + 2 * DAY_MS).toISOString(),
      referenceNumber: `ZW/${r1.day.replace(/-/g, "")}/1`,
      orderId: r1.id,
      items: r1.lines.map((l) => ({ offerId: l.offer.id, quantity: 1, name: l.offer.name, reason: { type: "DONT_LIKE_IT" } })),
      status: "DELIVERED",
      marketplaceId: "allegro-pl",
    })
    const r2 = pick(1)
    customerReturns.push({
      id: demoUuid(`return#${r2.id}`),
      createdAt: new Date(r2.boughtAt.getTime() + 3 * DAY_MS).toISOString(),
      referenceNumber: `ZW/${r2.day.replace(/-/g, "")}/2`,
      orderId: r2.id,
      items: r2.lines.map((l) => ({ offerId: l.offer.id, quantity: 1, name: l.offer.name, reason: { type: "DAMAGED" } })),
      status: "IN_TRANSIT",
      marketplaceId: "allegro-pl",
    })
  }
  if (ready.length >= 3) {
    const d = pick(ready.length - 2)
    issues.push({
      id: demoUuid(`dispute#${d.id}`),
      type: "DISPUTE",
      referenceNumber: null,
      decisionDueDate: null,
      openedDate: new Date(d.boughtAt.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      subject: "NO_PRODUCT_RECEIVED",
      checkoutForm: { id: d.id },
      currentState: { status: "DISPUTE_ONGOING", statusDueDate: null, returnRequired: null, chatActive: true },
      chat: { lastMessage: { status: "BUYER_REPLIED", createdAt: new Date(d.boughtAt.getTime() + 7 * 60 * 60 * 1000).toISOString() }, messagesCount: 3 },
      right: null,
    })
    const c = pick(1)
    const opened = new Date(c.boughtAt.getTime() + DAY_MS)
    issues.push({
      id: demoUuid(`claim#${c.id}`),
      type: "CLAIM",
      referenceNumber: `${(dayIndex(c.boughtAt) % 50) + 1}/2026`,
      decisionDueDate: new Date(opened.getTime() + 14 * DAY_MS).toISOString(),
      openedDate: opened.toISOString(),
      subject: "PRODUCT_DAMAGED_PARCEL_INTACT",
      checkoutForm: { id: c.id },
      currentState: { status: "CLAIM_SUBMITTED", statusDueDate: new Date(opened.getTime() + 14 * DAY_MS).toISOString(), returnRequired: true, chatActive: true },
      chat: { lastMessage: { status: "NEW", createdAt: opened.toISOString() }, messagesCount: 1 },
      right: "WARRANTY",
    })
  }
  return { returns: { count: customerReturns.length, customerReturns }, issues: { issues } }
}

/** One page of message threads: nine threads, two of them unread. */
export function demoThreadsRaw(now: Date): Record<string, unknown> {
  const threads = Array.from({ length: 9 }, (_, i) => ({
    id: demoUuid(`thread#${dayStart(now).toISOString()}#${i}`),
    read: i >= 2,
    lastMessageDateTime: new Date(now.getTime() - (i + 1) * 3 * 60 * 60 * 1000).toISOString(),
    interlocutor: { login: `demo_kupujacy_${i}` },
  }))
  return { threads, offset: 0, limit: 20 }
}

/** EAN-13 with the Polish prefix 590, stable per SKU, for demo variants that have none. */
export function demoEan(sku: string): string {
  const body = `590${String(hash32(`ean#${sku}`) % 1_000_000_000).padStart(9, "0")}`
  const sum = body
    .split("")
    .map(Number)
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/** `GET /sale/products` for a demo EAN: one catalog product. */
export function demoProductsRaw(ean: string, title: string): Record<string, unknown> {
  return {
    products: [{ id: demoUuid(`product#${ean}`), name: title, category: { id: String(260000 + (hash32(ean) % 9000)) }, publication: { status: "LISTED" } }],
  }
}
