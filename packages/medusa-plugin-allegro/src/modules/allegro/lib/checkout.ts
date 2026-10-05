/**
 * A FULL ALLEGRO CHECKOUT FORM, for the order import. Zero imports.
 *
 * Unlike the journal parser (`orders.ts`), this one reads the buyer, the
 * delivery and the invoice data, because a Medusa order needs them. The
 * result lives IN MEMORY for the duration of one import: the plugin's own
 * tables never store it. The Medusa order is where it lands, as with any
 * order placed in the store.
 *
 * Field names are verified in the official OpenAPI file (`CheckoutForm` and
 * its parts), see docs/allegro-api-notes.md.
 */

export interface Money {
  value: number
  currency: string
}

export interface CheckoutAddress {
  firstName: string | null
  lastName: string | null
  companyName: string | null
  street: string | null
  city: string | null
  zipCode: string | null
  countryCode: string | null
  phoneNumber: string | null
}

export interface CheckoutLine {
  /** Allegro line item id (a UUID): the parcels refer to it. */
  id: string
  offerId: string
  offerName: string
  externalId: string | null
  quantity: number
  /** Price of one item after discounts. */
  price: Money | null
  originalPrice: Money | null
  /** VAT rate Allegro shows for the line, e.g. "23.00". */
  taxRate: string | null
  boughtAt: string | null
}

export interface CheckoutForm {
  id: string
  /** BOUGHT, FILLED_IN, READY_FOR_PROCESSING or CANCELLED. */
  status: string
  revision: string | null
  updatedAt: string | null
  buyer: {
    email: string | null
    login: string | null
    firstName: string | null
    lastName: string | null
    companyName: string | null
    phoneNumber: string | null
    guest: boolean
  }
  payment: {
    id: string | null
    /** CASH_ON_DELIVERY, WIRE_TRANSFER, ONLINE, SPLIT_PAYMENT, EXTENDED_TERM */
    type: string | null
    finishedAt: string | null
    /** Present only after the payment was completed; null for cash on delivery. */
    paidAmount: Money | null
  }
  fulfillmentStatus: string | null
  delivery: {
    address: CheckoutAddress | null
    methodId: string | null
    methodName: string | null
    pickupPoint: { id: string | null; name: string | null; description: string | null; address: CheckoutAddress | null } | null
    cost: Money | null
  }
  invoice: {
    required: boolean
    address: (CheckoutAddress & { nip: string | null }) | null
  }
  lines: CheckoutLine[]
  total: Money | null
  marketplace: string | null
  boughtAt: string | null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function text(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

function money(v: unknown): Money | null {
  const m = obj(v)
  const value = Number(m.amount)
  const currency = text(m.currency)
  if (!Number.isFinite(value) || !currency) return null
  return { value, currency: currency.toUpperCase() }
}

function iso(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function address(v: unknown, zipKey: "zipCode" | "postCode" = "zipCode"): CheckoutAddress | null {
  const a = obj(v)
  if (Object.keys(a).length === 0) return null
  const out: CheckoutAddress = {
    firstName: text(a.firstName, 100),
    lastName: text(a.lastName, 100),
    companyName: text(a.companyName, 200),
    street: text(a.street, 200),
    city: text(a.city, 100),
    zipCode: text(a[zipKey], 20),
    countryCode: text(a.countryCode, 2)?.toUpperCase() ?? null,
    phoneNumber: text(a.phoneNumber, 40),
  }
  return out.street || out.city || out.firstName || out.lastName ? out : null
}

/** NIP from `company.ids` (type PL_NIP), falling back to the deprecated `company.taxId`. */
export function nipOf(company: unknown): string | null {
  const c = obj(company)
  for (const id of Array.isArray(c.ids) ? c.ids : []) {
    const i = obj(id)
    if (String(i.type ?? "").toUpperCase() === "PL_NIP") {
      const v = text(i.value, 30)
      if (v) return v.replace(/[\s-]/g, "")
    }
  }
  const legacy = text(c.taxId, 30)
  return legacy ? legacy.replace(/[\s-]/g, "") : null
}

/** One `GET /order/checkout-forms/{id}` answer, or null without an id. */
export function checkoutFormFromApi(raw: unknown): CheckoutForm | null {
  const o = obj(raw)
  const id = text(o.id, 64)
  if (!id) return null
  const buyer = obj(o.buyer)
  const payment = obj(o.payment)
  const delivery = obj(o.delivery)
  const pickup = obj(delivery.pickupPoint)
  const invoice = obj(o.invoice)
  const invoiceAddress = obj(invoice.address)
  const company = obj(invoiceAddress.company)
  const person = obj(invoiceAddress.naturalPerson)

  const lines: CheckoutLine[] = []
  let boughtAt: string | null = null
  for (const item of Array.isArray(o.lineItems) ? o.lineItems : []) {
    const li = obj(item)
    const offer = obj(li.offer)
    const lineId = text(li.id, 64)
    const offerId = text(offer.id, 32)
    if (!lineId || !offerId) continue
    const quantity = Number(li.quantity)
    const bought = iso(li.boughtAt)
    if (bought && (!boughtAt || bought < boughtAt)) boughtAt = bought
    lines.push({
      id: lineId,
      offerId,
      offerName: text(offer.name, 200) ?? offerId,
      externalId: text(obj(offer.external).id, 100),
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 0,
      price: money(li.price),
      originalPrice: money(li.originalPrice),
      taxRate: text(obj(li.tax).rate, 10),
      boughtAt: bought,
    })
  }

  const invoiceAddr = address(invoiceAddress)
  return {
    id,
    status: (text(o.status, 40) ?? "BOUGHT").toUpperCase(),
    revision: text(o.revision, 64),
    updatedAt: iso(o.updatedAt),
    buyer: {
      email: text(buyer.email, 200),
      login: text(buyer.login, 100),
      firstName: text(buyer.firstName, 100),
      lastName: text(buyer.lastName, 100),
      companyName: text(buyer.companyName, 200),
      phoneNumber: text(buyer.phoneNumber, 40),
      guest: buyer.guest === true,
    },
    payment: {
      id: text(payment.id, 64),
      type: text(payment.type, 40)?.toUpperCase() ?? null,
      finishedAt: iso(payment.finishedAt),
      paidAmount: money(payment.paidAmount),
    },
    fulfillmentStatus: text(obj(o.fulfillment).status, 40)?.toUpperCase() ?? null,
    delivery: {
      address: address(delivery.address),
      methodId: text(obj(delivery.method).id, 100),
      methodName: text(obj(delivery.method).name, 200),
      pickupPoint:
        Object.keys(pickup).length > 0
          ? { id: text(pickup.id, 100), name: text(pickup.name, 200), description: text(pickup.description, 300), address: address(pickup.address) }
          : null,
      cost: money(delivery.cost),
    },
    invoice: {
      required: invoice.required === true,
      address:
        invoice.required === true && invoiceAddr
          ? {
              ...invoiceAddr,
              firstName: text(person.firstName, 100),
              lastName: text(person.lastName, 100),
              companyName: text(company.name, 200),
              nip: Object.keys(company).length > 0 ? nipOf(company) : null,
            }
          : null,
    },
    lines,
    total: money(obj(o.summary).totalToPay),
    marketplace: text(obj(o.marketplace).id, 40),
    boughtAt,
  }
}

/**
 * Paid means Allegro holds the money: an online payment with `paidAmount`.
 * Cash on delivery is never paid at import time (paidAmount is null).
 */
export function isPaid(form: Pick<CheckoutForm, "payment">): boolean {
  if (form.payment.type === "CASH_ON_DELIVERY") return false
  return Boolean(form.payment.paidAmount && form.payment.paidAmount.value > 0)
}
