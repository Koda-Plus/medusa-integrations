/**
 * HOW THE CUSTOMER PAID. No runtime imports.
 *
 * Stripe reports the method on the charge (`payment_method_details`), and
 * for the wallets it hides inside a card: Apple Pay and Google Pay are
 * `type: "card"` with `card.wallet.type`. The panel splits them out, because
 * a Polish store wants to see BLIK, Przelewy24, cards and the wallets apart.
 *
 *   card + wallet apple_pay    apple_pay
 *   card + wallet google_pay   google_pay
 *   card + wallet link         link (older Link payments)
 *   card                       card (Samsung Pay and the other wallets stay cards)
 *   blik                       blik
 *   p24                        p24
 *   link                       link
 *   anything else              other (Klarna, PayPal, SEPA...), with the raw type kept
 *
 * Only the brand, the last four digits, the wallet and the Przelewy24 bank
 * and reference are read. Names, e-mails and the BLIK buyer id never are.
 */
import type { MethodDetailDto, MethodKey } from "./contract"
import type { RawCardDetails, RawCharge, RawPaymentIntent, RawPaymentMethod, RawPaymentMethodDetails } from "./stripe-types"

export interface Classified {
  method: MethodKey
  detail: MethodDetailDto
}

function emptyDetail(): MethodDetailDto {
  return { brand: null, last4: null, wallet: null, bank: null, reference: null, type: null }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)

function fromCard(card: RawCardDetails | null | undefined, detail: MethodDetailDto): MethodKey {
  detail.brand = str(card?.brand)
  detail.last4 = str(card?.last4)
  const wallet = str(card?.wallet?.type)
  detail.wallet = wallet
  if (wallet === "apple_pay") return "apple_pay"
  if (wallet === "google_pay") return "google_pay"
  if (wallet === "link") return "link"
  return "card"
}

/** A method from a payment method type alone (no charge yet), or null for a type the panel does not split out. */
export function methodOfType(type: unknown): MethodKey | null {
  switch (str(type)) {
    case "card":
      return "card"
    case "blik":
      return "blik"
    case "p24":
      return "p24"
    case "link":
      return "link"
    case "apple_pay":
      return "apple_pay"
    case "google_pay":
      return "google_pay"
    case null:
      return null
    default:
      return "other"
  }
}

/** The method of a charge, from its `payment_method_details`. Null when the charge has none. */
export function classifyDetails(details: RawPaymentMethodDetails | null | undefined): Classified | null {
  const type = str(details?.type)
  if (!details || !type) return null
  const detail = emptyDetail()
  detail.type = type
  if (type === "card") return { method: fromCard(details.card, detail), detail }
  if (type === "p24") {
    detail.bank = str(details.p24?.bank)
    detail.reference = str(details.p24?.reference)
    return { method: "p24", detail }
  }
  const method = methodOfType(type) ?? "other"
  return { method, detail }
}

/** The method of a saved or attempted payment method object (a failed attempt carries one). */
export function classifyPaymentMethod(pm: RawPaymentMethod | null | undefined): Classified | null {
  const type = str(pm?.type)
  if (!pm || !type) return null
  const detail = emptyDetail()
  detail.type = type
  if (type === "card") return { method: fromCard(pm.card, detail), detail }
  if (type === "p24") {
    detail.bank = str(pm.p24?.bank)
    return { method: "p24", detail }
  }
  return { method: methodOfType(type) ?? "other", detail }
}

export function chargeOf(pi: RawPaymentIntent): RawCharge | null {
  return pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null
}

/**
 * The method of a PaymentIntent: the latest charge first (what was used),
 * then the declined attempt, then the expanded payment method, then a single
 * allowed type (the BLIK and Przelewy24 providers create intents for one
 * type). Null when the customer has not chosen yet.
 */
export function classifyPaymentIntent(pi: RawPaymentIntent): Classified | null {
  const charge = chargeOf(pi)
  const fromCharge = classifyDetails(charge?.payment_method_details)
  if (fromCharge) return fromCharge
  const fromError = classifyPaymentMethod(pi.last_payment_error?.payment_method)
  if (fromError) return fromError
  if (pi.payment_method && typeof pi.payment_method === "object") {
    const fromPm = classifyPaymentMethod(pi.payment_method)
    if (fromPm) return fromPm
  }
  const types = Array.isArray(pi.payment_method_types) ? pi.payment_method_types.filter((t) => typeof t === "string") : []
  if (types.length === 1 && pi.automatic_payment_methods?.enabled !== true) {
    const method = methodOfType(types[0])
    if (method) return { method, detail: { ...emptyDetail(), type: types[0] } }
  }
  return null
}

/** Display names of the Przelewy24 banks (Stripe's `p24.bank` enum). Unknown values fall back to the enum, humanized. */
export const P24_BANKS: Record<string, string> = {
  alior_bank: "Alior Bank",
  bank_millennium: "Bank Millennium",
  bank_nowy_bfg_sa: "Bank Nowy BFG",
  bank_pekao_sa: "Bank Pekao",
  banki_spbdzielcze: "Banki Spółdzielcze",
  blik: "BLIK (Przelewy24)",
  bnp_paribas: "BNP Paribas",
  boz: "BOŚ Bank",
  citi_handlowy: "Citi Handlowy",
  credit_agricole: "Credit Agricole",
  envelobank: "EnveloBank",
  etransfer_pocztowy24: "Pocztowy24",
  getin_bank: "Getin Bank",
  ideabank: "Idea Bank",
  ing: "ING Bank Śląski",
  inteligo: "Inteligo",
  mbank_mtransfer: "mBank",
  nest_przelew: "Nest Bank",
  noble_pay: "Noble Pay",
  pbac_z_ipko: "PKO Bank Polski",
  plus_bank: "Plus Bank",
  santander_przelew24: "Santander",
  tmobile_usbugi_bankowe: "T-Mobile Usługi Bankowe",
  toyota_bank: "Toyota Bank",
  velobank: "VeloBank",
  volkswagen_bank: "Volkswagen Bank",
}

export function bankName(bank: string | null | undefined): string | null {
  const b = str(bank)
  if (!b) return null
  return P24_BANKS[b] ?? b.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

const BRANDS: Record<string, string> = {
  amex: "American Express",
  american_express: "American Express",
  cartes_bancaires: "Cartes Bancaires",
  diners: "Diners Club",
  discover: "Discover",
  eftpos_au: "eftpos",
  jcb: "JCB",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
}

export function brandName(brand: string | null | undefined): string | null {
  const b = str(brand)?.toLowerCase()
  if (!b || b === "unknown") return null
  return BRANDS[b] ?? b.charAt(0).toUpperCase() + b.slice(1)
}

/**
 * The method in a few words, without translation (brands and banks are
 * names): "Visa 4242", "PKO Bank Polski", "Mastercard 5454". The admin puts
 * the method label (BLIK, Apple Pay...) in front of it.
 */
export function describeDetail(detail: MethodDetailDto | null | undefined): string {
  if (!detail) return ""
  const bank = bankName(detail.bank)
  if (bank) return detail.reference ? `${bank}, ${detail.reference}` : bank
  const brand = brandName(detail.brand)
  if (brand && detail.last4) return `${brand} ${detail.last4}`
  if (detail.last4) return detail.last4
  return brand ?? ""
}
