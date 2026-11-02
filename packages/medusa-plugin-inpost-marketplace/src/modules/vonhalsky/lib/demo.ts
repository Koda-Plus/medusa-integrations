/**
 * DEMO MODE: the simulated marketplace. Nothing here calls fetch or any
 * outside address. It answers the same interface as the seller API and
 * behaves like it in the ways that matter to the flows:
 *
 *   writes are commands: PENDING when sent, SUCCESS (or FAILURE) on the next
 *   read of the command;
 *   an offer without an image or a description stays PENDING with
 *   validation errors, like the marketplace's own checks;
 *   events are kept newest first with backwards paging;
 *   orders come from "Simulate an order", parcels from "Ship (demo)",
 *   returns and claims from "Simulate a return / a claim";
 *   a small category tree with attributes, a catalog hint for any valid EAN.
 *
 * State lives in memory: a restart forgets the simulated marketplace (the
 * plugin's own rows stay). Sample buyers use example.com addresses and
 * sample streets and parcel lockers.
 */

import { createHash } from "node:crypto"
import type { MarketplaceClient, MarketplaceOrder, MarketplaceOrderLine } from "./client"
import type { OfferPatchBody, OfferProposal } from "./offer-payload"
import type { AttributeDefinition, CommandState, DictionaryEntry, OfferCreated, ProductHint, RemoteCategory, RemoteClaim, RemoteEvent, RemoteOffer, RemoteRefund, RemoteReturn } from "./remote"
import { toMinor } from "./pricing"

export interface DemoCall {
  at: string
  call: string
  detail?: string
}

export interface DemoClient extends MarketplaceClient {
  readonly log: DemoCall[]
  /** Keeps a simulated order (and its CREATED and PAID events). */
  remember(order: MarketplaceOrder): void
  /** A parcel on a simulated order, as a linked ShipX shipment would appear. */
  addParcel(orderId: string, trackingNumber: string): boolean
  /** A new return or claim on a simulated order. Null when the order is unknown. */
  simulateCase(kind: "return" | "claim", orderId: string, n: number): RemoteReturn | RemoteClaim | null
}

/** The offer id the simulated marketplace gives a variant: stable, so a second listing finds the same offer. */
export function demoOfferId(externalId: string): string {
  return `demo-${createHash("sha256").update(externalId).digest("hex").slice(0, 12)}`
}

const hash = (s: string, n = 8): string => createHash("sha256").update(s).digest("hex").slice(0, n)

/* The demo tree: Polish names, the shape of the real one (leaves carry attributes). */
const TREE: RemoteCategory[] = [
  {
    id: "demo-cat-dom",
    name: "Dom i ogród",
    leaf: false,
    gpsrFree: false,
    description: null,
    children: [
      { id: "demo-cat-meble", name: "Meble", leaf: true, gpsrFree: false, description: null, children: [] },
      { id: "demo-cat-oswietlenie", name: "Oświetlenie", leaf: true, gpsrFree: false, description: null, children: [] },
      { id: "demo-cat-ogrod", name: "Ogród", leaf: true, gpsrFree: false, description: null, children: [] },
    ],
  },
  {
    id: "demo-cat-moda",
    name: "Moda",
    leaf: false,
    gpsrFree: false,
    description: null,
    children: [
      { id: "demo-cat-odziez", name: "Odzież", leaf: true, gpsrFree: false, description: null, children: [] },
      { id: "demo-cat-obuwie", name: "Obuwie", leaf: true, gpsrFree: false, description: null, children: [] },
    ],
  },
  {
    id: "demo-cat-ksiazki",
    name: "Książki i e-booki",
    leaf: false,
    gpsrFree: true,
    description: null,
    children: [{ id: "demo-cat-ksiazki-papierowe", name: "Książki papierowe", leaf: true, gpsrFree: true, description: null, children: [] }],
  },
  {
    id: "demo-cat-elektronika",
    name: "Elektronika",
    leaf: false,
    gpsrFree: false,
    description: null,
    children: [
      { id: "demo-cat-audio", name: "Audio", leaf: true, gpsrFree: false, description: null, children: [] },
      { id: "demo-cat-akcesoria", name: "Akcesoria komputerowe", leaf: true, gpsrFree: false, description: null, children: [] },
    ],
  },
]

const LEAVES = TREE.flatMap((c) => c.children)

const ATTRIBUTES: AttributeDefinition[] = [
  { id: "demo-attr-kolor", name: "Kolor", type: "DICTIONARY", expected: "ONE", required: true, description: null, lang: "pl", options: [{ id: "demo-opt-czarny", value: "czarny" }, { id: "demo-opt-bialy", value: "biały" }, { id: "demo-opt-szary", value: "szary" }, { id: "demo-opt-inny", value: "inny" }], unit: null },
  { id: "demo-attr-material", name: "Materiał", type: "TEXT_VALUE", expected: "NULL_OR_ONE", required: false, description: null, lang: "pl", options: [], unit: null },
  { id: "demo-attr-gwarancja", name: "Gwarancja", type: "NUMERIC", expected: "NULL_OR_ONE", required: false, description: null, lang: "pl", options: [], unit: "miesiące" },
]

const DICTS = {
  refundReasons: [
    { id: "demo-rr-1", code: "PRODUCT_DAMAGED", description: "Produkt uszkodzony" },
    { id: "demo-rr-2", code: "NOT_AS_DESCRIBED", description: "Niezgodny z opisem" },
  ],
  returnRejectReasons: [
    { id: "demo-rj-1", code: "PRODUCT_USED", description: "Produkt nosi ślady używania" },
    { id: "demo-rj-2", code: "AFTER_DEADLINE", description: "Zwrot po terminie" },
  ],
  claimTypes: [
    { id: "demo-ct-1", code: "demo-ct-1", description: "Produkt nie ma właściwości opisanych w ofercie" },
    { id: "demo-ct-2", code: "demo-ct-2", description: "Produkt uszkodzony w transporcie" },
  ],
} satisfies Record<string, DictionaryEntry[]>

const RETURN_REASONS = ["Zmiana decyzji", "Niewłaściwy rozmiar", "Produkt niezgodny z opisem"]

interface DemoOffer extends RemoteOffer {
  proposal: OfferProposal
  basePriceMinor: number
}

interface Pending {
  command: CommandState
  /** What happens when the command is read. */
  apply: () => void
}

export function createDemoClient(): DemoClient {
  const log: DemoCall[] = []
  const offers = new Map<string, DemoOffer>()
  const orders = new Map<string, MarketplaceOrder>()
  const commands = new Map<string, Pending>()
  const offerEvents: RemoteEvent[] = []
  const orderEvents: RemoteEvent[] = []
  const returns = new Map<string, RemoteReturn>()
  const claims = new Map<string, RemoteClaim>()
  const refunds = new Map<string, RemoteRefund>()
  let seq = 0

  const nowIso = () => new Date().toISOString()
  const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(8, "0")}`
  const note = (call: string, detail?: string) => {
    log.push({ at: nowIso(), call, ...(detail ? { detail } : {}) })
    if (log.length > 200) log.splice(0, log.length - 200)
  }
  const event = (list: RemoteEvent[], subjectId: string, externalId: string | null, type: string) => {
    list.unshift({ id: nextId("demo-ev"), subjectId, externalId, type, at: nowIso() })
    if (list.length > 500) list.length = 500
  }
  const offerEvent = (o: DemoOffer, type: string) => event(offerEvents, o.id, o.externalId, type)

  /** Final price: the promotion, then the price program (5% off, as a stand-in for the marketplace's discount). */
  const reprice = (o: DemoOffer) => {
    const base = o.basePriceMinor
    let promo: number | null = null
    const p = o.promotion
    if (p && p.mode && p.value !== null) {
      promo = p.mode === "PERCENTAGE" ? Math.round(base * (1 - p.value / 100)) : p.mode === "AMOUNT" ? base - Math.round(p.value * 100) : Math.round(p.value * 100)
      promo = Math.max(1, promo)
    }
    o.grossPriceMinor = base
    o.promotionPriceMinor = promo
    const afterPromo = promo ?? base
    o.finalPriceMinor = o.program === "IN" ? Math.round(afterPromo * 0.95) : afterPromo
  }

  /** The marketplace's own checks: an image and a description, a leaf category. */
  const validate = (p: OfferProposal): Array<{ code: string; message: string | null }> => {
    const errors: Array<{ code: string; message: string | null }> = []
    if (!p.images?.length) errors.push({ code: "IMAGES_REQUIRED", message: "Oferta musi mieć co najmniej jedno zdjęcie." })
    if (!p.product.description?.trim()) errors.push({ code: "DESCRIPTION_REQUIRED", message: "Opis produktu jest wymagany." })
    if (!LEAVES.some((l) => l.id === p.product.categoryId)) errors.push({ code: "CATEGORY_NOT_LEAF", message: "Wybierz kategorię najniższego poziomu." })
    return errors
  }

  const settle = (o: DemoOffer) => {
    o.validationErrors = validate(o.proposal)
    if (o.validationErrors.length) {
      o.status = "PENDING"
      offerEvent(o, "VALIDATION_FAILED")
    } else if (o.status !== "CLOSED") {
      o.status = (o.stock ?? 0) > 0 ? "PUBLISHED" : "SOLDOUT"
      offerEvent(o, o.status === "PUBLISHED" ? "PUBLISHED" : "SOLDOUT")
    }
    o.updatedAt = nowIso()
  }

  const command = (offerId: string | null, apply: () => void, fail?: string): CommandState => {
    const c: CommandState = { commandId: nextId("demo-cmd"), offerId, status: "PENDING", errors: [] }
    commands.set(c.commandId, {
      command: c,
      apply: () => {
        if (fail) {
          c.status = "FAILURE"
          c.errors = [{ field: null, message: fail }]
          return
        }
        apply()
        c.status = "SUCCESS"
      },
    })
    if (commands.size > 2000) commands.delete(commands.keys().next().value as string)
    return { ...c }
  }

  const fromProposal = (p: OfferProposal, id: string): DemoOffer => {
    const base = toMinor(p.price.grossPrice.amount) ?? 0
    const o: DemoOffer = {
      id,
      externalId: p.externalId,
      status: "PENDING",
      name: p.product.name,
      sku: p.product.sku ?? null,
      ean: p.product.ean ?? null,
      categoryId: p.product.categoryId,
      stock: p.stock.quantity,
      grossPriceMinor: base,
      promotionPriceMinor: null,
      finalPriceMinor: base,
      promotion: null,
      program: null,
      validationErrors: [],
      rejectionReasons: [],
      imageCount: p.images?.length ?? 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      proposal: p,
      basePriceMinor: base,
    }
    return o
  }

  const view = (o: DemoOffer): RemoteOffer => {
    const { proposal: _p, basePriceMinor: _b, ...rest } = o
    return { ...rest, validationErrors: [...rest.validationErrors], promotion: rest.promotion ? { ...rest.promotion } : null }
  }

  const page = <T>(list: T[], offset: number, limit: number) => list.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(30, Math.max(1, limit)))

  const eventsPage = (list: RemoteEvent[], q: { limit: number; untilId?: string | null }) => {
    /* An unknown untilId pages nothing (the marketplace forgot it), never the newest page again. */
    const at = q.untilId ? list.findIndex((e) => e.id === q.untilId) : -1
    if (q.untilId && at < 0) return []
    const start = at + 1
    return list.slice(start, start + Math.min(1000, Math.max(1, q.limit))).map((e) => ({ ...e }))
  }

  const refundOf = (orderId: string, amountMinor: number, source: "RETURN" | "CLAIM" | "INDEPENDENT"): RemoteRefund => {
    const r: RemoteRefund = {
      id: nextId("demo-ref"),
      displayId: `RF-${orderId}-${refunds.size + 1}`,
      orderId,
      status: "ACCEPTED",
      paymentStatus: "REFUNDED",
      source,
      createdBy: "MERCHANT",
      amountMinor,
      submittedAt: nowIso(),
      updatedAt: nowIso(),
      declinedReason: null,
      reason: null,
    }
    refunds.set(r.id, r)
    const order = orders.get(orderId)
    if (order) {
      const refunded = [...refunds.values()].filter((x) => x.orderId === orderId).reduce((s, x) => s + (x.amountMinor ?? 0), 0)
      event(orderEvents, orderId, null, refunded >= (order.totalMinor ?? 0) ? "REFUNDED" : "PARTIALLY_REFUNDED")
    }
    return r
  }

  return {
    mode: "demo",
    available: true,
    log,
    limits: () => ({ limit: null, remaining: null, resetAt: null }),

    remember(order) {
      orders.set(order.id, order)
      event(orderEvents, order.id, null, "CREATED")
      if (order.paid) event(orderEvents, order.id, null, "PAID")
      if (orders.size > 300) orders.delete(orders.keys().next().value as string)
      for (const l of order.lines) {
        const o = offers.get(l.offerId)
        if (o && typeof o.stock === "number") {
          o.stock = Math.max(0, o.stock - l.quantity)
          if (o.stock === 0 && o.status === "PUBLISHED") {
            o.status = "SOLDOUT"
            offerEvent(o, "SOLDOUT")
          }
        }
      }
    },
    addParcel(orderId, trackingNumber) {
      const o = orders.get(orderId)
      if (!o) return false
      if (!o.delivery.parcels.some((p) => p.trackingNumber === trackingNumber)) {
        const created = nowIso()
        o.delivery.parcels.push({ trackingNumber, createdAt: created, status: "RECEIVED" })
        o.delivery.expectedAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
        o.updatedAt = created
        event(orderEvents, orderId, null, "SHIPPED")
      }
      note("parcel", `${orderId}: ${trackingNumber}`)
      return true
    },
    simulateCase(kind, orderId, n) {
      const order = orders.get(orderId)
      if (!order || order.lines.length === 0) return null
      const line = order.lines[n % order.lines.length]
      const caseLine = { offerId: line.offerId, productId: null, name: line.name, ean: line.ean, quantity: 1, priceMinor: line.unitPriceMinor, reason: kind === "return" ? RETURN_REASONS[n % RETURN_REASONS.length] : null }
      const created = nowIso()
      if (kind === "return") {
        const r: RemoteReturn = {
          id: nextId("demo-ret"),
          displayId: `ZW-${orderId}`,
          orderId,
          status: "NEW",
          method: n % 2 ? "COURIER" : "APM",
          source: "CUSTOMER",
          reason: caseLine.reason,
          parcelSize: "A",
          trackingNumber: null,
          createdAt: created,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          deliveredAt: null,
          refundId: null,
          refundPaymentStatus: null,
          refundMinor: line.unitPriceMinor,
          remainingRefundMinor: order.totalMinor,
          orderValueMinor: order.totalMinor,
          lines: [caseLine],
        }
        returns.set(r.id, r)
        event(orderEvents, orderId, null, "RETURN_CREATED")
        note("return", r.id)
        return r
      }
      const c: RemoteClaim = {
        id: nextId("demo-clm"),
        orderId,
        state: "RESOLUTION_IN_PROGRESS",
        resolution: null,
        requested: n % 2 ? "PARTIAL_REFUND" : "REFUND",
        partialPercent: n % 2 ? 20 : null,
        type: DICTS.claimTypes[n % DICTS.claimTypes.length].description,
        createdAt: created,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: created,
        lines: [caseLine],
      }
      claims.set(c.id, c)
      note("claim", c.id)
      return c
    },

    async check() {
      note("check")
      return { ok: true as const, organization: "Sklep demo" }
    },

    async categories() {
      note("categories")
      return structuredClone(TREE)
    },
    async categoryAttributes(categoryId) {
      note("attributes", categoryId)
      return LEAVES.some((l) => l.id === categoryId) ? structuredClone(ATTRIBUTES) : []
    },
    async hints(q) {
      note("hint", q.ean ?? q.mpn ?? q.name ?? "")
      const key = q.ean ?? q.mpn
      if (!key) return []
      const leaf = LEAVES[parseInt(hash(key, 4), 16) % LEAVES.length]
      const hint: ProductHint = {
        productId: `demo-prd-${hash(key)}`,
        name: q.name ? `${q.name} (katalog demo)` : `Produkt ${key} (katalog demo)`,
        description: "Opis z katalogu demo: tak wygląda podpowiedź katalogu marketplace.",
        brand: "Marka demo",
        categoryId: leaf.id,
        model: null,
        mpn: q.mpn ?? null,
        ean: q.ean ?? null,
        attributes: [{ id: "demo-attr-kolor", lang: "pl", values: ["czarny"] }],
        dimension: null,
        manufacturers: [],
      }
      return [hint]
    },
    async depositTypes() {
      return [{ id: "demo-dep-pet", name: "Butelki PET i puszki metalowe", priceMinor: 50 }]
    },

    async createOffers(proposals) {
      note("create_offers", String(proposals.length))
      const out: OfferCreated[] = []
      for (const p of proposals) {
        const id = demoOfferId(p.externalId)
        const existing = offers.get(id)
        const o = fromProposal(p, id)
        if (existing) {
          o.promotion = existing.promotion
          o.program = existing.program
          o.createdAt = existing.createdAt
        }
        reprice(o)
        offers.set(id, o)
        offerEvent(o, "CREATED")
        const c = command(id, () => settle(o))
        out.push({ commandId: c.commandId, offerId: id, externalId: p.externalId })
      }
      return out
    },
    async patchOffer(offerId, patch: OfferPatchBody) {
      note("patch_offer", offerId)
      const o = offers.get(offerId)
      if (!o) return null
      o.proposal = { ...o.proposal, ...patch, product: { ...o.proposal.product, ...(patch.product ?? {}) }, externalId: o.proposal.externalId }
      if (patch.price) o.basePriceMinor = toMinor(patch.price.grossPrice.amount) ?? o.basePriceMinor
      if (patch.stock) o.stock = patch.stock.quantity
      if (patch.product?.name) o.name = patch.product.name
      if (patch.product?.categoryId) o.categoryId = patch.product.categoryId
      if (patch.images) o.imageCount = patch.images.length
      reprice(o)
      if (o.status === "PENDING") settle(o)
      else offerEvent(o, "UPDATED")
      return view(o)
    },
    async getOffer(offerId) {
      const o = offers.get(offerId)
      return o ? view(o) : null
    },
    async listOffers(q) {
      const list = [...offers.values()].filter((o) => !q.statuses?.length || (o.status && q.statuses.includes(o.status))).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      return { offers: page(list, q.offset, q.limit).map(view), total: list.length }
    },
    async updatePrices(items) {
      note("prices", String(items.length))
      return items.map((i) => {
        const o = offers.get(i.offerId)
        return command(
          i.offerId,
          () => {
            if (!o) return
            o.basePriceMinor = i.grossPriceMinor
            reprice(o)
            o.updatedAt = nowIso()
            offerEvent(o, "UPDATED")
          },
          o ? undefined : "Offer not found",
        )
      })
    },
    async updateStocks(items) {
      note("stocks", String(items.length))
      return items.map((i) => {
        const o = offers.get(i.offerId)
        return command(
          i.offerId,
          () => {
            if (!o) return
            o.stock = i.quantity
            if (o.status === "PUBLISHED" && i.quantity === 0) {
              o.status = "SOLDOUT"
              offerEvent(o, "SOLDOUT")
            } else if (o.status === "SOLDOUT" && i.quantity > 0) {
              o.status = "PUBLISHED"
              offerEvent(o, "PUBLISHED")
            } else offerEvent(o, "UPDATED")
            o.updatedAt = nowIso()
          },
          o ? undefined : "Offer not found",
        )
      })
    },
    async closeOffer(offerId) {
      note("close_offer", offerId)
      const o = offers.get(offerId)
      if (!o) return null
      return command(offerId, () => {
        o.status = "CLOSED"
        o.updatedAt = nowIso()
        offerEvent(o, "CLOSED")
      })
    },
    async reopenOffer(offerId) {
      note("reopen_offer", offerId)
      const o = offers.get(offerId)
      if (!o) return null
      return command(offerId, () => {
        o.status = "PENDING"
        offerEvent(o, "REOPENED")
        settle(o)
      })
    },
    async offerCommand(commandId) {
      const p = commands.get(commandId)
      if (!p) return null
      if (p.command.status === "PENDING") p.apply()
      return { ...p.command, errors: [...p.command.errors] }
    },
    async campaignCommand(commandId) {
      /* One store of commands in the simulation: a declaration command reads like an offer command. */
      const p = commands.get(commandId)
      if (!p) return null
      if (p.command.status === "PENDING") p.apply()
      return { ...p.command, errors: [...p.command.errors] }
    },
    async offerEvents(q) {
      return eventsPage(offerEvents, q)
    },
    async setPromotion(offerId, p) {
      note("promotion", offerId)
      const o = offers.get(offerId)
      if (!o) return null
      return command(offerId, () => {
        const started = Date.parse(p.start) <= Date.now()
        o.promotion = { start: p.start, end: p.end, status: started ? "ACTIVE" : "PENDING", mode: p.mode, value: p.value, isVisible: true }
        reprice(o)
        offerEvent(o, "UPDATED")
      })
    },
    async deletePromotion(offerId) {
      note("promotion_off", offerId)
      const o = offers.get(offerId)
      if (!o) return null
      return command(offerId, () => {
        o.promotion = null
        reprice(o)
        offerEvent(o, "UPDATED")
      })
    },
    async setProgram(items) {
      note("program", String(items.length))
      return items.map((i) => {
        const o = offers.get(i.offerId)
        return command(
          i.offerId,
          () => {
            if (!o) return
            o.program = i.mode
            reprice(o)
            offerEvent(o, "UPDATED")
          },
          o ? undefined : "Offer not found",
        )
      })
    },

    async listOrders(q) {
      const list = [...orders.values()]
        .filter((o) => !q.updatedSince || String(o.updatedAt ?? o.createdAt) >= q.updatedSince)
        .filter((o) => (q.paymentStatus === "NOT_PAID" ? !o.paid : q.paymentStatus === "PAID" ? o.paid : true))
        .filter((o) => !q.statuses?.length || q.statuses.includes(o.status))
        .sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)))
      return { orders: page(list, q.offset, q.limit).map((o) => structuredClone(o)), total: list.length }
    },
    async getOrder(orderId) {
      note("get_order", orderId)
      const o = orders.get(orderId)
      return o ? structuredClone(o) : null
    },
    async acceptOrder(orderId) {
      note("accept_order", orderId)
      const o = orders.get(orderId)
      if (o && o.status === "CREATED") {
        o.status = "ACCEPTED"
        event(orderEvents, orderId, null, "ACCEPTED")
      }
    },
    async orderEvents(q) {
      return eventsPage(orderEvents, q)
    },

    async listReturns(q) {
      const list = [...returns.values()].filter((r) => !q.status?.length || q.status.includes(r.status)).reverse()
      return { returns: page(list, q.offset, q.limit).map((r) => structuredClone(r)), total: list.length }
    },
    async getReturn(returnId) {
      const r = returns.get(returnId)
      return r ? structuredClone(r) : null
    },
    async acceptReturn(returnId, refundMinor) {
      note("accept_return", returnId)
      const r = returns.get(returnId)
      if (!r || r.status !== "NEW") return { refundId: null }
      const refund = refundOf(r.orderId ?? "", refundMinor, "RETURN")
      r.status = "ACCEPTED"
      r.refundId = refund.id
      r.refundMinor = refundMinor
      r.refundPaymentStatus = "REFUNDED"
      return { refundId: refund.id }
    },
    async rejectReturn(returnId) {
      note("reject_return", returnId)
      const r = returns.get(returnId)
      if (r && r.status === "NEW") r.status = "REJECTED"
    },
    async listRefunds(q) {
      const list = [...refunds.values()].filter((r) => !q.since || String(r.submittedAt) >= q.since).reverse()
      return { refunds: page(list, q.offset, q.limit).map((r) => ({ ...r })), total: list.length }
    },
    async getRefund(refundId) {
      const r = refunds.get(refundId)
      return r ? { ...r } : null
    },
    async refundOrder(orderId, amountMinor) {
      note("refund_order", orderId)
      const order = orders.get(orderId)
      if (!order) return { refundId: null, status: null }
      const r = refundOf(orderId, amountMinor ?? order.totalMinor ?? 0, "INDEPENDENT")
      return { refundId: r.id, status: "SUCCESS" }
    },
    async retryRefund(refundId) {
      note("retry_refund", refundId)
      const r = refunds.get(refundId)
      if (r && r.paymentStatus === "DECLINED") r.paymentStatus = "REFUNDED"
    },
    async listClaims(q) {
      const list = [...claims.values()].reverse()
      return { claims: page(list, q.offset, q.limit).map((c) => structuredClone(c)), total: list.length }
    },
    async getClaim(_orderId, claimId) {
      const c = claims.get(claimId)
      return c ? structuredClone(c) : null
    },
    async resolveClaim(orderId, claimId, how) {
      note("resolve_claim", `${claimId}: ${how}`)
      const c = claims.get(claimId)
      if (!c || c.resolution) return
      c.updatedAt = nowIso()
      if (how === "reject") {
        c.state = "REJECTED"
        c.resolution = "REJECTED"
        return
      }
      c.state = "APPROVED"
      c.resolution = how === "partial" ? "PARTIAL_REFUND" : "REFUND"
      const base = c.lines.reduce((s, l) => s + (l.priceMinor ?? 0) * l.quantity, 0)
      refundOf(orderId, how === "partial" ? Math.round((base * (c.partialPercent ?? 20)) / 100) : base, "CLAIM")
    },
    async dictionaries() {
      return structuredClone(DICTS)
    },
  }
}

export interface DemoOfferPick {
  remoteId: string
  variantId: string
  sku: string | null
  ean: string | null
  title: string
  priceMinor: number
  /** What a buyer pays on the simulated marketplace (a promotion or the price program), when known. */
  finalPriceMinor?: number | null
  stock: number
}

const LOCKERS = ["DEMO01M", "DEMO02A", "DEMO03P"]
const PAYMENTS = ["BLIK_CODE", "CARD", "PAY_BY_LINK", "GOOGLE_PAY", "APPLE_PAY"]

/**
 * A sample marketplace order from listed offers: one or two products (offers
 * with stock first), sometimes two pieces of one (two lines on the wire), a
 * parcel locker or a courier in turn, paid through the marketplace (BLIK, a
 * card...), and every fifth one with a company invoice.
 */
export function demoOrder(id: string, offers: readonly DemoOfferPick[], n: number, now: Date = new Date()): MarketplaceOrder | null {
  const pool = [...offers].filter((o) => o.priceMinor > 0).sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.variantId.localeCompare(b.variantId))
  if (pool.length === 0) return null
  const inStock = pool.filter((o) => o.stock > 0)
  const source = inStock.length > 0 ? inStock : pool
  const first = source[n % source.length]
  const second = source.length > 1 && n % 2 === 1 ? source[(n + 1) % source.length] : null
  const picked = [first, ...(second && second.variantId !== first.variantId ? [second] : [])]
  const locker = n % 3 !== 2
  const deliveryPrice = locker ? 999 : 1599
  const lines: MarketplaceOrderLine[] = picked.map((o, i) => {
    const final = o.finalPriceMinor && o.finalPriceMinor > 0 ? o.finalPriceMinor : o.priceMinor
    return {
      offerId: o.remoteId,
      externalId: o.variantId,
      sku: o.sku,
      ean: o.ean,
      name: o.title,
      quantity: i === 0 && n % 4 === 1 && o.stock > 1 ? 2 : 1,
      unitPriceMinor: final,
      basePriceMinor: o.priceMinor,
      promotionPriceMinor: final < o.priceMinor ? final : null,
      programDiscountMinor: null,
    }
  })
  const address = { street: "ul. Przykładowa", building: String(10 + (n % 40)), flat: null, city: "Warszawa", postCode: "00-001", countryCode: "PL" }
  const company = n % 5 === 4
  const at = now.toISOString()
  return {
    id,
    status: "ACCEPTED",
    createdAt: at,
    updatedAt: at,
    currency: "PLN",
    totalMinor: lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0) + deliveryPrice,
    buyer: { firstName: "Klient", lastName: `Demo ${n + 1}`, email: `buyer${n + 1}@example.com`, phone: "+48500000000", address },
    delivery: {
      type: locker ? "APM" : "COURIER",
      point: locker ? LOCKERS[n % LOCKERS.length] : null,
      name: locker ? "Paczkomat (demo)" : "Kurier (demo)",
      address: locker ? null : address,
      phone: "+48500000000",
      email: `demo-${hash(id)}@example.com`,
      priceMinor: deliveryPrice,
      expectedAt: null,
      parcels: [],
    },
    invoice: company ? { companyName: "Firma Demo sp. z o.o.", taxId: "0000000000", firstName: null, lastName: null, email: `faktury${n + 1}@example.com`, address } : null,
    lines,
    paymentType: PAYMENTS[n % PAYMENTS.length],
    paid: true,
    paidAt: at,
    comment: "Simulated order (demo)",
  }
}

/** A sample tracking number in the shape of a 24 digit parcel number, never a real one (starts with 99). */
export function demoTrackingNumber(seed: string): string {
  const digits = createHash("sha256").update(seed).digest("hex").replace(/[a-f]/g, "").padEnd(22, "7").slice(0, 22)
  return `99${digits}`
}
