/**
 * THE MARKETPLACE CLIENT: one interface, two implementations.
 *
 *   demo  `createDemoClient()` in `demo.ts`: an in-memory marketplace, never calls fetch.
 *   live  `createLiveClient()` below: the InPost Von Halsky seller API
 *         (sandbox: InPost's stage environment; live: production), as a
 *         merchant application (OAuth2 Client Credentials, see `http.ts`).
 *
 * Every path, parameter and body follows the OpenAPI file 1.7.6 and the
 * integration guidelines of the seller API. The answers are read by the
 * lenient parsers of `remote.ts` and `orders.ts`.
 *
 * WRITES ARE ASYNCHRONOUS on the marketplace: creating an offer, a price or
 * stock change, closing, a promotion answer with a command that is PENDING
 * first. A 201 does not mean the offer exists; the flows follow the command
 * and the offer events (kept 24 and 72 hours by InPost).
 */

import { createHttp, isApiError, maskSecrets, MarketplaceApiError, type Http, type HttpConfig } from "./http"
import type { OfferPatchBody, OfferProposal } from "./offer-payload"
import { parseMarketplaceOrder } from "./orders"
import {
  arr,
  int,
  moneyMinor,
  obj,
  pageOf,
  parseAttribute,
  parseCategory,
  parseClaim,
  parseCommand,
  parseDictionary,
  parseEvent,
  parseHint,
  parseOfferCreated,
  parseRefund,
  parseRemoteOffer,
  parseReturn,
  text,
  type AttributeDefinition,
  type CommandState,
  type DictionaryEntry,
  type OfferCreated,
  type ParcelFact,
  type ProductHint,
  type RemoteCategory,
  type RemoteClaim,
  type RemoteEvent,
  type RemoteOffer,
  type RemoteRefund,
  type RemoteReturn,
} from "./remote"

export { isApiError, maskSecrets, MarketplaceApiError }

export type MoneyMinor = { amountMinor: number; currency: string }

export interface MarketplaceAddress {
  street: string | null
  building: string | null
  flat: string | null
  city: string | null
  postCode: string | null
  countryCode: string | null
}

/** One product of an order. The marketplace sends one line per piece; the parser adds them up per offer and price. */
export interface MarketplaceOrderLine {
  /** The marketplace offer id the buyer bought. */
  offerId: string
  /** The seller's own id of the offer (this plugin sends the Medusa variant id). */
  externalId: string | null
  sku: string | null
  ean: string | null
  name: string
  quantity: number
  /** What the buyer paid for one piece (`offer.price`). */
  unitPriceMinor: number
  /** The regular price of one piece, before a promotion or the price program. */
  basePriceMinor: number | null
  /** The promotion price of one piece, when a promotion applied. */
  promotionPriceMinor: number | null
  /** The price program discount on one piece ("Cenowy Sztos"), when it applied. */
  programDiscountMinor: number | null
}

/** A marketplace order (the API's `Order`), normalized. */
export interface MarketplaceOrder {
  id: string
  /** CREATED, ACCEPTED, REFUSED, REJECTED, CANCELED, UNKNOWN */
  status: string
  createdAt: string | null
  updatedAt: string | null
  currency: string
  totalMinor: number | null
  buyer: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null; address: MarketplaceAddress | null }
  delivery: {
    type: "APM" | "COURIER" | "UNKNOWN"
    point: string | null
    name: string | null
    address: MarketplaceAddress | null
    phone: string | null
    /** The hashed address InPost links a ShipX shipment to this order by. */
    email: string | null
    priceMinor: number
    expectedAt: string | null
    parcels: ParcelFact[]
  }
  invoice: { companyName: string | null; taxId: string | null; firstName: string | null; lastName: string | null; email: string | null; address: MarketplaceAddress | null } | null
  lines: MarketplaceOrderLine[]
  paymentType: string | null
  /** The marketplace collected the money (anything but cash on delivery). */
  paid: boolean
  /** When the first payment was booked (`paymentDetails.payments`); null while unpaid. */
  paidAt: string | null
  comment: string | null
}

export interface OfferListQuery {
  offset: number
  limit: number
  statuses?: string[]
}

export interface OrderListQuery {
  offset: number
  limit: number
  /** Orders changed since (ISO date). */
  updatedSince?: string | null
  paymentStatus?: "PAID" | "NOT_PAID" | null
  /** Only orders in these statuses. */
  statuses?: string[] | null
}

export interface MarketplaceClient {
  readonly mode: "demo" | "sandbox" | "live"
  /** Always true now: kept for hosts that read it. */
  readonly available: boolean
  /** Proves the credentials, the scopes and the organization id: the organization's name, or an error. */
  check(): Promise<{ ok: true; organization: string | null }>
  /** The last rate limit headers seen (live), for the admin. */
  limits(): { limit: number | null; remaining: number | null; resetAt: number | null }

  /* Catalog */
  categories(): Promise<RemoteCategory[]>
  categoryAttributes(categoryId: string): Promise<AttributeDefinition[]>
  hints(q: { ean?: string | null; mpn?: string | null; name?: string | null }): Promise<ProductHint[]>
  depositTypes(): Promise<Array<{ id: string; name: string; priceMinor: number | null }>>

  /* Offers */
  createOffers(proposals: OfferProposal[]): Promise<OfferCreated[]>
  patchOffer(offerId: string, patch: OfferPatchBody): Promise<RemoteOffer | null>
  getOffer(offerId: string): Promise<RemoteOffer | null>
  listOffers(q: OfferListQuery): Promise<{ offers: RemoteOffer[]; total: number }>
  updatePrices(items: Array<{ offerId: string; grossPriceMinor: number }>): Promise<CommandState[]>
  updateStocks(items: Array<{ offerId: string; quantity: number }>): Promise<CommandState[]>
  closeOffer(offerId: string): Promise<CommandState | null>
  reopenOffer(offerId: string): Promise<CommandState | null>
  offerCommand(commandId: string): Promise<CommandState | null>
  /** A price program declaration command (its own endpoint). */
  campaignCommand(commandId: string): Promise<CommandState | null>
  offerEvents(q: { limit: number; untilId?: string | null }): Promise<RemoteEvent[]>
  setPromotion(offerId: string, p: { start: string; end: string; mode: "PERCENTAGE" | "FIXED_PRICE" | "AMOUNT"; value: number }): Promise<CommandState | null>
  deletePromotion(offerId: string): Promise<CommandState | null>
  setProgram(items: Array<{ offerId: string; mode: "IN" | "OUT" }>): Promise<CommandState[]>

  /* Orders */
  listOrders(q: OrderListQuery): Promise<{ orders: MarketplaceOrder[]; total: number }>
  /** One order, fresh. Null when the marketplace does not know it. */
  getOrder(orderId: string): Promise<MarketplaceOrder | null>
  /** Accept an order (merchants: paid orders are accepted by InPost already; a repeat is harmless). */
  acceptOrder(orderId: string): Promise<void>
  orderEvents(q: { limit: number; untilId?: string | null }): Promise<RemoteEvent[]>

  /* After sale */
  listReturns(q: { offset: number; limit: number; status?: string[] }): Promise<{ returns: RemoteReturn[]; total: number }>
  getReturn(returnId: string): Promise<RemoteReturn | null>
  acceptReturn(returnId: string, refundMinor: number): Promise<{ refundId: string | null }>
  rejectReturn(returnId: string, reasonId: string): Promise<void>
  listRefunds(q: { offset: number; limit: number; since?: string | null }): Promise<{ refunds: RemoteRefund[]; total: number }>
  getRefund(refundId: string): Promise<RemoteRefund | null>
  /** A refund of the order without a return or a claim; null amount refunds everything. */
  refundOrder(orderId: string, amountMinor: number | null): Promise<{ refundId: string | null; status: string | null }>
  retryRefund(refundId: string): Promise<void>
  listClaims(q: { offset: number; limit: number }): Promise<{ claims: RemoteClaim[]; total: number }>
  getClaim(orderId: string, claimId: string): Promise<RemoteClaim | null>
  resolveClaim(orderId: string, claimId: string, how: "reject" | "partial" | "full", description: string | null): Promise<void>
  dictionaries(): Promise<{ refundReasons: DictionaryEntry[]; returnRejectReasons: DictionaryEntry[]; claimTypes: DictionaryEntry[] }>
}

/** The API's money: two decimals, PLN. */
export const money = (minor: number, currency = "PLN"): { amount: number; currency: string } => ({ amount: Math.round(minor) / 100, currency: currency.toUpperCase() })

/** The batch limits of the API (`BatchOffersProposal` up to 500, price program declarations up to 200). */
export const BATCH_OFFERS = 500
export const BATCH_DECLARATIONS = 200
/** Price and stock batches: the API names no limit; the plugin sends at most this many per request. */
export const BATCH_PRICE_STOCK = 100
/** The largest page the API serves (`Page.limit` max 30). */
export const PAGE_MAX = 30
/** Category levels read per request (InPost's module never asks for more). */
const CATEGORY_DEPTH = 3

const chunks = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const commandsOf = (v: unknown): CommandState[] => arr(v).map(parseCommand).filter((c): c is CommandState => Boolean(c))

export function createLiveClient(config: { mode: "sandbox" | "live" } & HttpConfig, http: Http = createHttp(config)): MarketplaceClient {
  const o = (p: string) => http.org(`/v1/organizations/{org}${p}`)
  const o2 = (p: string) => http.org(`/v2/organizations/{org}${p}`)
  const id = (v: string) => encodeURIComponent(v)
  const page = (offset: number, limit: number) => ({ offset: Math.max(0, Math.round(offset)), limit: Math.min(PAGE_MAX, Math.max(1, Math.round(limit))) })

  return {
    mode: config.mode,
    available: true,
    limits: () => http.limits(),

    async check() {
      // `GET /v1/organizations` is for integrators (Authorization Code apps). A
      // merchant's Client Credentials app gets 401 or 403 there although its token
      // is good (stage, 06.11.2026): then the organization's offers prove it alone.
      let orgs: Record<string, unknown>[] = []
      try {
        orgs = arr(await http.request("GET", "/v1/organizations"))
      } catch (e) {
        if (!isApiError(e) || e.code === "TOKEN" || (e.status !== 401 && e.status !== 403)) throw e
      }
      const mine = orgs.find((x) => text(x.id, 80) === config.organizationId)
      if (orgs.length && !mine) throw new MarketplaceApiError(403, "FORBIDDEN", "The API application does not see this organizationId: copy it from the Merchant Portal (Settings, Organization).")
      await http.request("GET", o("/offers"), { query: { limit: 1, offset: 0 } })
      return { ok: true as const, organization: mine ? text(mine.name, 200) : null }
    },

    async categories() {
      // InPost's own module reads three levels at a time and fetches a branch again
      // when it says leaf=false without children; the tree has five levels. A node
      // is a leaf only when the marketplace says so or its own read has no children;
      // past the request budget it stays a branch (never offered as a category).
      const tree = arr(await http.request("GET", "/v1/categories", { query: { depth: CATEGORY_DEPTH } }))
        .map((c) => parseCategory(c))
        .filter((c): c is RemoteCategory => Boolean(c))
      let budget = 400
      const expand = async (list: RemoteCategory[], level: number): Promise<void> => {
        for (const c of list) {
          if (c.children.length) await expand(c.children, level + 1)
          else if (!c.leaf && budget > 0) {
            budget -= 1
            const branch = parseCategory(await http.request("GET", `/v1/categories/${id(c.id)}`, { query: { depth: CATEGORY_DEPTH } }))
            c.children = branch?.children ?? []
            if (!c.children.length) c.leaf = true
            else await expand(c.children, level + 1)
          }
        }
      }
      await expand(tree, 0)
      return tree
    },
    async categoryAttributes(categoryId) {
      const body = await http.request("GET", `/v1/categories/${id(categoryId)}/attributes`)
      return arr(body)
        .map(parseAttribute)
        .filter((a): a is AttributeDefinition => Boolean(a))
    },
    async hints(q) {
      const body = obj(await http.request("GET", o("/offers/hint"), { query: { ean: q.ean ?? undefined, mpn: q.mpn ?? undefined, name: q.name ?? undefined, limit: 10, offset: 0 } }))
      return arr(body.data).map(parseHint)
    },
    async depositTypes() {
      const body = obj(await http.request("GET", "/v1/offers/deposit-types"))
      return arr(body.data)
        .map((d) => ({ id: text(obj(d.depositType).id, 80) ?? "", name: text(d.name, 200) ?? "", priceMinor: moneyMinor(obj(d.depositType).price) }))
        .filter((d) => d.id)
    },

    async createOffers(proposals) {
      const out: OfferCreated[] = []
      for (const batch of chunks(proposals, BATCH_OFFERS)) {
        const body = await http.request("POST", o("/offers/batch"), { body: batch })
        out.push(...arr(body).map(parseOfferCreated).filter((x): x is OfferCreated => Boolean(x)))
      }
      return out
    },
    async patchOffer(offerId, patch) {
      return parseRemoteOffer(await http.request("PATCH", o(`/offers/${id(offerId)}`), { body: patch, contentType: "application/merge-patch+json" }))
    },
    async getOffer(offerId) {
      const body = await http.request("GET", o(`/offers/${id(offerId)}`), { notFound: "null" })
      return body ? parseRemoteOffer(body) : null
    },
    async listOffers(q) {
      const body = obj(await http.request("GET", o("/offers"), { query: { ...page(q.offset, q.limit), offerStatus: q.statuses, sort: "-updatedAt" } }))
      const offers = arr(body.data)
        .map(parseRemoteOffer)
        .filter((x): x is RemoteOffer => Boolean(x))
      return { offers, total: pageOf(body.page, offers.length).total }
    },
    async updatePrices(items) {
      const out: CommandState[] = []
      for (const batch of chunks(items, BATCH_PRICE_STOCK)) {
        out.push(...commandsOf(await http.request("PATCH", o("/offers/prices"), { body: batch.map((i) => ({ offerId: i.offerId, price: money(i.grossPriceMinor) })) })))
      }
      return out
    },
    async updateStocks(items) {
      const out: CommandState[] = []
      for (const batch of chunks(items, BATCH_PRICE_STOCK)) {
        out.push(...commandsOf(await http.request("PATCH", o("/offers/stocks"), { body: batch.map((i) => ({ offerId: i.offerId, stock: { quantity: Math.max(0, Math.min(999_999, Math.round(i.quantity))), unit: "UNIT" } })) })))
      }
      return out
    },
    async closeOffer(offerId) {
      return parseCommand(await http.request("POST", o(`/offers/${id(offerId)}/close`)))
    },
    async reopenOffer(offerId) {
      return parseCommand(await http.request("POST", o(`/offers/${id(offerId)}/reopen`)))
    },
    async offerCommand(commandId) {
      const body = await http.request("GET", o(`/offers/commands/${id(commandId)}`), { notFound: "null" })
      return body ? parseCommand(body) : null
    },
    async campaignCommand(commandId) {
      const body = await http.request("GET", o(`/campaigns/commands/${id(commandId)}`), { notFound: "null" })
      return body ? parseCommand(body) : null
    },
    async offerEvents(q) {
      const body = obj(await http.request("GET", o("/offers/events"), { query: { limit: q.limit, untilId: q.untilId ?? undefined } }))
      return arr(body.data)
        .map((e) => parseEvent(e, "offer"))
        .filter((e): e is RemoteEvent => Boolean(e))
    },
    async setPromotion(offerId, p) {
      return parseCommand(await http.request("PUT", o(`/offers/${id(offerId)}/promotion`), { body: p }))
    },
    async deletePromotion(offerId) {
      return parseCommand(await http.request("DELETE", o(`/offers/${id(offerId)}/promotion`)))
    },
    async setProgram(items) {
      const out: CommandState[] = []
      for (const batch of chunks(items, BATCH_DECLARATIONS)) {
        out.push(...commandsOf(await http.request("POST", o("/campaigns/declarations"), { body: batch.map((i) => ({ offerId: i.offerId, participationMode: i.mode })) })))
      }
      return out
    },

    async listOrders(q) {
      const body = obj(
        await http.request("GET", o("/orders"), {
          query: { ...page(q.offset, q.limit), sort: "-updatedAt", updatedAtGte: q.updatedSince ?? undefined, paymentStatus: q.paymentStatus ?? undefined, orderStatus: q.statuses?.length ? q.statuses : undefined },
        }),
      )
      const orders = arr(body.data)
        .map(parseMarketplaceOrder)
        .filter((x) => x.id)
      return { orders, total: pageOf(body.page, orders.length).total }
    },
    async getOrder(orderId) {
      const body = await http.request("GET", o(`/orders/${id(orderId)}`), { notFound: "null" })
      return body ? parseMarketplaceOrder(body) : null
    },
    async acceptOrder(orderId) {
      await http.request("POST", o(`/orders/${id(orderId)}/accept`))
    },
    async orderEvents(q) {
      const body = obj(await http.request("GET", o("/orders/events"), { query: { limit: q.limit, untilId: q.untilId ?? undefined } }))
      return arr(body.data)
        .map((e) => parseEvent(e, "order"))
        .filter((e): e is RemoteEvent => Boolean(e))
    },

    async listReturns(q) {
      /* status is form style without explode: one comma separated value. */
      const body = obj(await http.request("GET", o2("/returns"), { query: { ...page(q.offset, q.limit), status: q.status?.length ? q.status.join(",") : undefined } }))
      const returns = arr(body.items)
        .map(parseReturn)
        .filter((x): x is RemoteReturn => Boolean(x))
      return { returns, total: pageOf(body.page, returns.length).total }
    },
    async getReturn(returnId) {
      const body = await http.request("GET", o2(`/returns/${id(returnId)}`), { notFound: "null" })
      return body ? parseReturn(body) : null
    },
    async acceptReturn(returnId, refundMinor) {
      const body = obj(await http.request("POST", o2(`/returns/${id(returnId)}/accept`), { body: { refundAmount: money(refundMinor) } }))
      return { refundId: text(body.refundId, 80) }
    },
    async rejectReturn(returnId, reasonId) {
      await http.request("POST", o2(`/returns/${id(returnId)}/reject`), { body: { rejectReasonId: reasonId } })
    },
    async listRefunds(q) {
      const body = obj(
        await http.request("GET", o2("/refunds"), {
          query: { limit: Math.min(PAGE_MAX, Math.max(1, q.limit)), offset: Math.max(0, q.offset), submissionDateFrom: q.since ?? undefined, sortBy: "DATE_SUBMITTED", sortOrder: "DESC" },
        }),
      )
      const refunds = arr(body.items)
        .map(parseRefund)
        .filter((x): x is RemoteRefund => Boolean(x))
      return { refunds, total: pageOf(body.page, refunds.length).total }
    },
    async getRefund(refundId) {
      const body = await http.request("GET", o2(`/refunds/${id(refundId)}`), { notFound: "null" })
      return body ? parseRefund(body) : null
    },
    async refundOrder(orderId, amountMinor) {
      const body = obj(await http.request("POST", o2(`/orders/${id(orderId)}/refund`), { body: amountMinor === null ? {} : { amount: money(amountMinor) } }))
      return { refundId: text(body.refundId, 80), status: text(body.status, 20) }
    },
    async retryRefund(refundId) {
      await http.request("POST", o2(`/refunds/${id(refundId)}/payments/retry`))
    },
    async listClaims(q) {
      const body = obj(await http.request("GET", o("/claims"), { query: { ...page(q.offset, q.limit), sort: "-submission_date" } }))
      const claims = arr(body.items)
        .map(parseClaim)
        .filter((x): x is RemoteClaim => Boolean(x))
      return { claims, total: pageOf(body.page, claims.length).total }
    },
    async getClaim(orderId, claimId) {
      const body = await http.request("GET", o(`/orders/${id(orderId)}/claims/${id(claimId)}`), { notFound: "null" })
      return body ? parseClaim(body) : null
    },
    async resolveClaim(orderId, claimId, how, description) {
      const path = how === "reject" ? "reject" : how === "partial" ? "partial-refund" : "refund"
      await http.request("POST", o(`/orders/${id(orderId)}/claims/${id(claimId)}/${path}`), { body: description ? { description: description.slice(0, 1000) } : {} })
    },
    async dictionaries() {
      const [refundReasons, returnRejectReasons, claimTypes] = await Promise.all([
        http.request("GET", "/v2/dictionaries/refund-reasons"),
        http.request("GET", "/v2/dictionaries/return-reject-reasons"),
        http.request("GET", "/v1/orders/claim-types"),
      ])
      return { refundReasons: parseDictionary(refundReasons), returnRejectReasons: parseDictionary(returnRejectReasons), claimTypes: parseDictionary(claimTypes) }
    },
  }
}

/** A short, safe reason for an API failure, for rows and the log. */
export function failureText(err: unknown): string {
  if (isApiError(err)) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

export { int }
