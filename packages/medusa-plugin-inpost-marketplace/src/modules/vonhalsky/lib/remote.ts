/**
 * WHAT THE SELLER API ANSWERS, read into the plugin's own shapes. Lenient on
 * purpose: a missing field becomes null, never a parse error, so one odd
 * record never stops a sync. Amounts become minor units (grosze). Names and
 * contact data of buyers are not read here: the plugin's tables keep ids,
 * statuses, amounts and products only (the admin reads the rest live).
 *
 * Shapes follow the OpenAPI file 1.7.6 of the InPost Von Halsky seller API.
 */

import { toMinor } from "./pricing"

export type Raw = Record<string, unknown>

export const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {})
export const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : [])
export const text = (v: unknown, max = 500): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  const s = v.trim().slice(0, max)
  return s ? s : null
}
export const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : null
}
export const moneyMinor = (v: unknown): number | null => toMinor(obj(v).amount)
export const upper = (v: unknown, max = 40): string | null => text(v, max)?.toUpperCase() ?? null
/** An ISO date, or null. */
export const date = (v: unknown): string | null => {
  const s = text(v, 60)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export interface Page {
  limit: number
  offset: number
  total: number
}

export function pageOf(v: unknown, fallbackCount: number): Page {
  const p = obj(v)
  return { limit: int(p.limit) ?? fallbackCount, offset: int(p.offset) ?? 0, total: int(p.total) ?? fallbackCount }
}

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

export type RemoteOfferStatus = "PENDING" | "REJECTED" | "PUBLISHED" | "CLOSED" | "SOLDOUT"

export interface RemotePromotion {
  start: string | null
  end: string | null
  /** PENDING (upcoming) or ACTIVE. */
  status: string | null
  mode: "PERCENTAGE" | "FIXED_PRICE" | "AMOUNT" | null
  value: number | null
  isVisible: boolean
}

export interface RemoteOffer {
  id: string
  externalId: string | null
  status: RemoteOfferStatus | null
  name: string | null
  sku: string | null
  ean: string | null
  /** The manufacturer part number the offer carries (matching on import). */
  mpn: string | null
  categoryId: string | null
  stock: number | null
  grossPriceMinor: number | null
  promotionPriceMinor: number | null
  /** What a buyer pays now, after a promotion or the price program. */
  finalPriceMinor: number | null
  promotion: RemotePromotion | null
  /** The price program declaration: IN, OUT, or none. */
  program: "IN" | "OUT" | null
  validationErrors: Array<{ code: string; message: string | null }>
  rejectionReasons: string[]
  imageCount: number
  createdAt: string | null
  updatedAt: string | null
}

const OFFER_STATUSES = ["PENDING", "REJECTED", "PUBLISHED", "CLOSED", "SOLDOUT"]

/** One `OfferDetails` ({ metadata, offer }) or a bare `Offer`. */
export function parseRemoteOffer(input: unknown): RemoteOffer | null {
  const d = obj(input)
  const o = d.offer ? obj(d.offer) : d
  const meta = obj(d.metadata)
  const id = text(o.id, 80)
  if (!id) return null
  const product = obj(o.product)
  const price = obj(o.price)
  const promo = o.promotion ? obj(o.promotion) : null
  const status = upper(o.status, 20)
  const mode = upper(promo?.mode, 20)
  const program = upper(obj(o.priceProgram).mode, 5)
  return {
    id,
    externalId: text(o.externalId, 255),
    status: status && OFFER_STATUSES.includes(status) ? (status as RemoteOfferStatus) : null,
    name: text(product.name, 150),
    sku: text(product.sku, 100),
    ean: text(product.ean, 14),
    mpn: text(product.manufacturerProductNumber, 255),
    categoryId: text(product.categoryId, 80),
    stock: int(obj(o.stock).quantity),
    grossPriceMinor: moneyMinor(price.grossPrice),
    promotionPriceMinor: moneyMinor(price.promotionPrice),
    finalPriceMinor: moneyMinor(price.finalPrice) ?? moneyMinor(price.grossPrice),
    promotion: promo
      ? {
          start: date(promo.start),
          end: date(promo.end),
          status: upper(promo.status, 20),
          mode: mode === "PERCENTAGE" || mode === "FIXED_PRICE" || mode === "AMOUNT" ? mode : null,
          value: typeof promo.value === "number" ? promo.value : null,
          isVisible: promo.isVisible !== false,
        }
      : null,
    program: program === "IN" || program === "OUT" ? program : null,
    validationErrors: arr(meta.validationErrors)
      .map((e) => ({ code: text(e.validationCode, 120) ?? "UNKNOWN", message: text(e.validationMessage, 500) }))
      .slice(0, 30),
    rejectionReasons: arr(meta.rejectionReasons)
      .map((r) => text(r.reasonMessage, 500))
      .filter((x): x is string => Boolean(x))
      .slice(0, 10),
    imageCount: Array.isArray(o.images) ? o.images.length : 0,
    createdAt: date(o.createdAt),
    updatedAt: date(o.updatedAt),
  }
}

/** `OfferCreated` (also the items of `BatchOffersCreated`). */
export interface OfferCreated {
  commandId: string
  offerId: string
  externalId: string | null
}

export function parseOfferCreated(input: unknown): OfferCreated | null {
  const o = obj(input)
  const commandId = text(o.commandId, 80)
  const offerId = text(o.offerId, 80)
  return commandId && offerId ? { commandId, offerId, externalId: text(o.externalId, 255) } : null
}

export type CommandStatus = "PENDING" | "SUCCESS" | "FAILURE"

export interface CommandState {
  commandId: string
  offerId: string | null
  status: CommandStatus
  errors: Array<{ field: string | null; message: string }>
}

/** `CommandDetails`, `OfferCommandDetails` or `OfferCommandStatusDetails`. */
export function parseCommand(input: unknown): CommandState | null {
  const o = obj(input)
  const commandId = text(o.commandId, 80)
  if (!commandId) return null
  const s = upper(o.status, 20)
  return {
    commandId,
    offerId: text(o.offerId, 80),
    status: s === "SUCCESS" || s === "FAILURE" ? s : "PENDING",
    errors: arr(o.errors)
      .map((e) => ({ field: text(e.fieldName, 200), message: text(e.message, 500) ?? "" }))
      .filter((e) => e.message)
      .slice(0, 20),
  }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export interface RemoteEvent {
  id: string
  /** The offer or order the event is about. */
  subjectId: string
  externalId: string | null
  type: string
  at: string | null
}

/** One item of `OffersEvents.data` or `OrdersEvents.data`. */
export function parseEvent(input: unknown, kind: "offer" | "order"): RemoteEvent | null {
  const o = obj(input)
  const id = text(o.id, 80)
  const subject = obj(kind === "offer" ? o.offer : o.order)
  const subjectId = text(subject.id, 80)
  if (!id || !subjectId) return null
  return { id, subjectId, externalId: text(subject.externalId, 255), type: upper(kind === "offer" ? o.offerEventType : o.orderEventType, 40) ?? "UNKNOWN", at: date(o.occurredAt) }
}

/**
 * The events newer than the last one seen, oldest first. The API returns the
 * newest first and pages only backwards (`untilId`): the caller reads pages
 * until it meets `lastSeenId` (or the list ends), and this picks what is new.
 */
export function newerThan(events: readonly RemoteEvent[], lastSeenId: string | null): { fresh: RemoteEvent[]; reachedKnown: boolean } {
  const out: RemoteEvent[] = []
  let reachedKnown = false
  for (const e of events) {
    if (lastSeenId && e.id === lastSeenId) {
      reachedKnown = true
      break
    }
    out.push(e)
  }
  return { fresh: out.reverse(), reachedKnown }
}

/* ------------------------------------------------------------------ */
/* Categories, attributes, hints                                       */
/* ------------------------------------------------------------------ */

export interface RemoteCategory {
  id: string
  name: string
  leaf: boolean
  /** The whole category is outside GPSR: offers in it send no `gpsr`. */
  gpsrFree: boolean
  description: string | null
  children: RemoteCategory[]
}

export function parseCategory(input: unknown, depth = 0): RemoteCategory | null {
  const o = obj(input)
  const id = text(o.id, 80)
  const name = text(o.name, 100)
  if (!id || !name || depth > 6) return null
  return {
    id,
    name,
    leaf: o.leaf === true,
    gpsrFree: o.doesNotRequireGpsrInfo === true,
    description: text(o.description, 1024),
    children: arr(o.children)
      .map((c) => parseCategory(c, depth + 1))
      .filter((c): c is RemoteCategory => Boolean(c)),
  }
}

export interface FlatCategory {
  id: string
  parentId: string | null
  name: string
  /** "Dom i ogród > Kuchnia > Kubki" */
  path: string
  depth: number
  leaf: boolean
  gpsrFree: boolean
}

/** The tree as rows, parents first. */
export function flattenCategories(tree: readonly RemoteCategory[]): FlatCategory[] {
  const out: FlatCategory[] = []
  const walk = (c: RemoteCategory, parent: FlatCategory | null) => {
    const row: FlatCategory = { id: c.id, parentId: parent?.id ?? null, name: c.name, path: parent ? `${parent.path} > ${c.name}` : c.name, depth: parent ? parent.depth + 1 : 0, leaf: c.leaf, gpsrFree: c.gpsrFree }
    out.push(row)
    for (const child of c.children) walk(child, row)
  }
  for (const c of tree) walk(c, null)
  return out
}

export type AttributeType = "TEXT_VALUE" | "LONG_TEXT_VALUE" | "DICTIONARY" | "NUMERIC" | "NUMERIC_FLOAT" | "DATE" | "URL"

export interface AttributeDefinition {
  id: string
  type: AttributeType | null
  /** NULL_OR_ONE (optional), ONE (required), AT_LEAST_ONE (required, many), ANY (optional, many). */
  expected: string | null
  required: boolean
  name: string
  description: string | null
  lang: string | null
  options: Array<{ id: string; value: string }>
  unit: string | null
}

const ATTRIBUTE_TYPES = ["TEXT_VALUE", "LONG_TEXT_VALUE", "DICTIONARY", "NUMERIC", "NUMERIC_FLOAT", "DATE", "URL"]

export function parseAttribute(input: unknown): AttributeDefinition | null {
  const o = obj(input)
  const id = text(o.id, 80)
  const name = text(o.name, 100)
  if (!id || !name) return null
  const type = upper(o.type, 30)
  const expected = upper(o.expectedValue, 20)
  return {
    id,
    type: type && ATTRIBUTE_TYPES.includes(type) ? (type as AttributeType) : null,
    expected,
    required: expected === "ONE" || expected === "AT_LEAST_ONE",
    name,
    description: text(o.description, 512),
    lang: text(o.lang, 5),
    options: arr(obj(o.dictionary).options)
      .filter((x) => x.active !== false)
      .map((x) => ({ id: text(x.id, 80) ?? "", value: text(x.value, 100) ?? "" }))
      .filter((x) => x.id && x.value)
      .slice(0, 500),
    unit: text(obj(o.unitOfMeasureDetails).symbol, 20),
  }
}

/** `AttributeValue`: what an offer carries for one attribute. */
export interface AttributeValue {
  id: string
  lang?: string
  values: string[]
}

export function parseAttributeValues(v: unknown): AttributeValue[] {
  return arr(v)
    .map((a) => ({ id: text(a.id, 80) ?? "", ...(text(a.lang, 5) ? { lang: text(a.lang, 5) as string } : {}), values: (Array.isArray(a.values) ? a.values : []).map((x) => text(x, 1024)).filter((x): x is string => Boolean(x)) }))
    .filter((a) => a.id && a.values.length > 0)
    .slice(0, 120)
}

export interface Dimension {
  width: number | null
  height: number | null
  length: number | null
  weight: number | null
}

export function parseDimension(v: unknown): Dimension | null {
  const d = obj(v)
  const out = { width: int(d.width), height: int(d.height), length: int(d.length), weight: int(d.weight) }
  return Object.values(out).some((x) => x !== null) ? out : null
}

export interface RemoteManufacturer {
  name: string
  email: string | null
  phone: string | null
  countryCode: string | null
  address: string | null
}

/** One `Hint` of `GET .../offers/hint`: what InPost's catalog knows about a product. */
export interface ProductHint {
  productId: string | null
  name: string | null
  description: string | null
  brand: string | null
  categoryId: string | null
  model: string | null
  mpn: string | null
  ean: string | null
  attributes: AttributeValue[]
  dimension: Dimension | null
  manufacturers: RemoteManufacturer[]
}

function addressLine(v: unknown): string | null {
  const a = obj(v)
  const street = [text(a.street, 255), [text(a.building, 10), text(a.flat, 10)].filter(Boolean).join("/")].filter(Boolean).join(" ")
  const city = [text(a.postCode, 10), text(a.city, 255)].filter(Boolean).join(" ")
  const line = [street, city, text(a.countryCode, 2)].filter(Boolean).join(", ")
  return line || null
}

export function parseHint(input: unknown): ProductHint {
  const h = obj(input)
  const p = obj(h.product)
  return {
    productId: text(p.productId, 80),
    name: text(p.name, 150),
    description: text(p.description, 100_000),
    brand: text(p.brand, 100),
    categoryId: text(p.categoryId, 80),
    model: text(p.model, 100),
    mpn: text(p.manufacturerProductNumber, 255),
    ean: text(p.ean, 14),
    attributes: parseAttributeValues(p.attributes),
    dimension: parseDimension(p.dimension),
    manufacturers: arr(h.gpsr)
      .map((g) => obj(g.manufacturer))
      .map((m) => ({ name: text(m.name, 500) ?? "", email: text(m.email, 500), phone: text(m.phone, 16), countryCode: text(m.countryCode, 2), address: addressLine(m.address) ?? text(m.unstructuredAddress, 300) }))
      .filter((m) => m.name)
      .slice(0, 5),
  }
}

/* ------------------------------------------------------------------ */
/* Orders: events and delivery facts beyond the import                 */
/* ------------------------------------------------------------------ */

export interface ParcelFact {
  trackingNumber: string
  createdAt: string | null
  status: string | null
}

export function parseParcels(v: unknown): ParcelFact[] {
  return arr(v)
    .map((p) => ({ trackingNumber: text(p.trackingNumber, 64) ?? "", createdAt: date(p.createdAt), status: upper(p.status, 20) }))
    .filter((p) => p.trackingNumber)
    .slice(0, 20)
}

/* ------------------------------------------------------------------ */
/* After sale: returns, refunds, claims, dictionaries                  */
/* ------------------------------------------------------------------ */

export interface AfterSaleLine {
  offerId: string | null
  productId: string | null
  name: string | null
  ean: string | null
  quantity: number
  priceMinor: number | null
  reason: string | null
}

function afterSaleLines(v: unknown): AfterSaleLine[] {
  return arr(v)
    .map((l) => {
      const offer = obj(l.offer ?? l)
      const product = obj(offer.product)
      return {
        offerId: text(offer.offerId, 80),
        productId: text(product.productId ?? product.id, 80),
        name: text(product.name, 300),
        ean: text(product.ean, 14),
        quantity: int(product.quantity) ?? 1,
        priceMinor: moneyMinor(offer.price),
        reason: text(product.returnReason, 300),
      }
    })
    .slice(0, 100)
}

export type ReturnStatus = "NEW" | "ACCEPTED" | "REJECTED"

export interface RemoteReturn {
  id: string
  displayId: string | null
  orderId: string | null
  status: ReturnStatus
  method: string | null
  source: string | null
  reason: string | null
  parcelSize: string | null
  trackingNumber: string | null
  createdAt: string | null
  expiresAt: string | null
  deliveredAt: string | null
  refundId: string | null
  refundPaymentStatus: string | null
  refundMinor: number | null
  remainingRefundMinor: number | null
  orderValueMinor: number | null
  lines: AfterSaleLine[]
}

/** `ReturnListItem` or `ReturnDetails` (v2). */
export function parseReturn(input: unknown): RemoteReturn | null {
  const r = obj(input)
  const id = text(r.id, 80)
  if (!id) return null
  const s = upper(r.status, 20)
  const order = obj(r.order)
  return {
    id,
    displayId: text(r.displayId, 80),
    orderId: text(r.orderId, 255),
    status: s === "ACCEPTED" || s === "REJECTED" ? s : "NEW",
    method: upper(r.returnMethod, 20),
    source: upper(r.source, 20),
    reason: text(obj(r.returnReason).text, 300),
    parcelSize: text(r.parcelSize, 4),
    trackingNumber: text(r.trackingNumber, 64),
    createdAt: date(r.createdAt),
    expiresAt: date(r.expiresAt),
    deliveredAt: date(r.deliveredAt),
    refundId: text(r.refundId, 80),
    refundPaymentStatus: upper(r.refundPaymentStatus, 30),
    refundMinor: moneyMinor(r.refundAmount),
    remainingRefundMinor: moneyMinor(r.remainingRefundAmount),
    orderValueMinor: moneyMinor(order.totalOrderValue) ?? moneyMinor(order.orderValue),
    lines: afterSaleLines(r.orderLines),
  }
}

export interface RemoteRefund {
  id: string
  displayId: string | null
  orderId: string | null
  /** The case: NEW, ACCEPTED, REJECTED. */
  status: string | null
  /** The money: NEW, REFUNDED, PARTIALLY_REFUNDED, DECLINED. */
  paymentStatus: string | null
  /** INDEPENDENT, RETURN, CLAIM. */
  source: string | null
  createdBy: string | null
  amountMinor: number | null
  submittedAt: string | null
  updatedAt: string | null
  declinedReason: string | null
  reason: string | null
}

/** `RefundListItem` or `RefundDetails` (v2). */
export function parseRefund(input: unknown): RemoteRefund | null {
  const r = obj(input)
  const id = text(r.id, 80)
  if (!id) return null
  return {
    id,
    displayId: text(r.displayId, 80),
    orderId: text(r.orderId, 255) ?? text(obj(r.order).orderId, 255),
    status: upper(r.status, 20),
    paymentStatus: upper(r.refundPaymentStatus, 30),
    source: upper(r.refundSource, 20),
    createdBy: upper(r.source, 20),
    amountMinor: moneyMinor(r.refundAmount),
    submittedAt: date(r.dateSubmitted),
    updatedAt: date(r.updatedAt),
    declinedReason: upper(r.paymentDeclinedReason, 60),
    reason: text(r.returnReason, 300) ?? text(r.rejectReason, 300),
  }
}

export interface RemoteClaim {
  id: string
  orderId: string | null
  /** APPROVED, REJECTED, RESOLUTION_IN_PROGRESS. */
  state: string | null
  /** REJECTED, PARTIAL_REFUND, REFUND, or null while open. */
  resolution: string | null
  requested: string | null
  partialPercent: number | null
  type: string | null
  createdAt: string | null
  expiresAt: string | null
  updatedAt: string | null
  lines: AfterSaleLine[]
}

/** `ClaimSummaryResponse` or `ClaimResponse` (v1). */
export function parseClaim(input: unknown): RemoteClaim | null {
  const c = obj(input)
  const id = text(c.claimId, 80)
  if (!id) return null
  const spec = obj(c.specification)
  const pct = Number(spec.partialRefundPercent)
  return {
    id,
    orderId: text(obj(c.relatedOrder).orderId, 255),
    state: upper(c.state, 40),
    resolution: upper(c.resolution, 30),
    requested: upper(spec.requestedResolution, 30),
    partialPercent: Number.isFinite(pct) ? pct : null,
    type: text(spec.claimTypeDescription, 255) ?? text(obj(spec.claimType).description, 255),
    createdAt: date(c.createdAt),
    expiresAt: date(c.expiresAt),
    updatedAt: date(c.updatedAt),
    lines: afterSaleLines(c.orderLines),
  }
}

export interface DictionaryEntry {
  id: string
  code: string
  description: string | null
}

export function parseDictionary(v: unknown): DictionaryEntry[] {
  const list = Array.isArray(v) ? v : arr(obj(v).data)
  return arr(list)
    .map((d) => ({ id: text(d.id, 80) ?? "", code: text(d.code, 120) ?? text(d.description, 120) ?? "", description: text(d.description, 300) }))
    .filter((d) => d.id)
}
