/**
 * THE SIMULATED CENEO ACCOUNT (`demo: true`). Same transport as the live
 * one, no network: the sync, the matching and the admin run the very code
 * a real account runs. Pure and deterministic: the orders of a day are the
 * same on every read, a new day brings new ones.
 *
 * Built from the store's own feed offers, so the items match variants. One
 * order a week carries an id the feed does not have, to show how an
 * unmatched item looks. Personal data are made up and marked as such.
 */

import type { CeneoDictEntry, CeneoItemRaw, CeneoOrderDetailRaw, CeneoOrderRaw, CeneoTransport } from "./kup-teraz"
import { parseCeneoDate, toCeneoWallTime } from "./odata"

export interface DemoOffer {
  offerId: string
  title: string
  price: number
}

/* The two states the Ceneo Swagger documents, then simulated ones (the real list comes with an account). */
export const DEMO_STATES: CeneoDictEntry[] = [
  { id: 1, value: "WaitingForPlatnosciPlConfirmation", description: "Oczekiwanie na informację z platnosci.pl o zdefiniowania przelewu" },
  { id: 2, value: "UnconfirmedByPlatnosci", description: "Zamówienie nie zostało opłacone" },
  { id: 101, value: "DemoPaid", description: "Opłacone (stan symulowany)" },
  { id: 102, value: "DemoSent", description: "Wysłane (stan symulowany)" },
]

const DAY = 86_400_000
const DAYS = 14

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function guid(seed: string): string {
  const hex = [0, 1, 2, 3].map((i) => hash(`${seed}:${i}`).toString(16).padStart(8, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const r2 = (n: number) => Math.round(n * 100) / 100

interface DemoOrder {
  raw: CeneoOrderRaw
  items: CeneoItemRaw[]
}

export function demoOrders(offers: readonly DemoOffer[], now: number): DemoOrder[] {
  if (offers.length === 0) return []
  const sorted = [...offers].sort((a, b) => (a.offerId < b.offerId ? -1 : 1))
  const today = Math.floor(now / DAY)
  const out: DemoOrder[] = []
  for (let d = today - DAYS + 1; d <= today; d += 1) {
    const perDay = (hash(`day:${d}`) % 2) + 1
    for (let k = 0; k < perDay; k += 1) {
      const seed = `${d}:${k}`
      const created = d * DAY + (8 + ((hash(seed) % 12) + k)) * 3_600_000
      if (created > now) continue
      const lines = (hash(`${seed}:n`) % 3) + 1
      const items: CeneoItemRaw[] = []
      for (let l = 0; l < lines; l += 1) {
        const o = sorted[hash(`${seed}:${l}`) % sorted.length]
        if (items.some((i) => i.ShopProductId === o.offerId)) continue
        const count = (hash(`${seed}:${l}:q`) % 2) + 1
        items.push({ ShopProductId: o.offerId, Name: o.title, Price: o.price, Count: count, TotalItemPrice: r2(o.price * count), Returned: 0 })
      }
      if (d % 7 === 0 && k === 0) items.push({ ShopProductId: "DEMO-USUNIETY-1", Name: "Produkt usunięty z feedu (demo)", Price: 19.99, Count: 1, TotalItemPrice: 19.99, Returned: 0 })
      const products = r2(items.reduce((a, i) => a + (i.TotalItemPrice ?? 0), 0))
      const delivery = hash(`${seed}:dl`) % 2 === 0 ? 12.99 : 0
      const age = Math.floor((now - created) / DAY)
      const state = age >= 3 ? 102 : age >= 1 ? 101 : hash(`${seed}:s`) % 3 === 0 ? 2 : 1
      out.push({
        raw: {
          Id: guid(seed),
          DisplayedOrderId: `DEMO${String(hash(seed) % 1_000_000).padStart(6, "0")}`,
          ShopOrderId: null,
          CreatedDate: toCeneoWallTime(new Date(created)),
          OrderStateId: state,
          PaymentTypeId: hash(`${seed}:pt`) % 4 === 0 ? 2 : 1,
          PaymentMethodId: 2,
          ShopDeliveryFormName: delivery > 0 ? "Kurier, płatność z góry (demo)" : "Paczkomat, płatność z góry (demo)",
          DeliveryCost: delivery,
          OrderValue: r2(products + delivery),
          ProductsValue: products,
          CustomerRemark: null,
        },
        items,
      })
    }
  }
  return out
}

export function demoTransport(offers: readonly DemoOffer[], now: () => number = () => Date.now()): CeneoTransport {
  const all = () => demoOrders(offers, now())
  const find = (id: string) => all().find((o) => o.raw.Id === id.toLowerCase())
  return {
    demo: true,
    async orders(filter, skip) {
      const from = filter.createdFrom?.getTime() ?? Number.NEGATIVE_INFINITY
      const to = filter.createdTo?.getTime() ?? Number.POSITIVE_INFINITY
      return all()
        .filter((o) => {
          const t = parseCeneoDate(o.raw.CreatedDate)?.getTime() ?? 0
          return t >= from && t < to && (filter.stateId === undefined || o.raw.OrderStateId === filter.stateId)
        })
        .slice(skip, skip + 20)
        .map((o) => o.raw)
    },
    async items(id) {
      return find(id)?.items ?? []
    },
    async detail(id): Promise<CeneoOrderDetailRaw> {
      const o = find(id)
      if (!o) return { shipping: [], invoice: [], pickup: [], services: [], remark: null }
      const paczkomat = (o.raw.DeliveryCost ?? 0) === 0
      return {
        shipping: [{ Email: "klient.demo@example.com", PhoneNumber: "500000000", ShippingFirstName: "Jan", ShippingLastName: "Testowy (demo)", ShippingAddress: "Przykładowa 1", ShippingPostCode: "00-001", ShippingCity: "Warszawa", ShippingCountry: "Polska" }],
        invoice: [],
        pickup: paczkomat ? [{ Name: "WAW01DEMO", StreetAddress: "Przykładowa 2", City: "Warszawa", PostCode: "00-002" }] : [],
        services: [],
        remark: o.raw.CustomerRemark ?? null,
      }
    },
    async states() {
      return DEMO_STATES
    },
  }
}
