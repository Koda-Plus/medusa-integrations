/**
 * THE BUYER OF A DOCUMENT. Pure: an order in, the `buyer_*` fields out.
 *
 * COMPANY OR PERSON. A valid tax ID (NIP) makes the buyer a company: the
 * name from the billing address `company` (or the company module, or the
 * order metadata), `buyer_tax_no` and `buyer_company: true`. Without one the
 * buyer is a person: `buyer_first_name`, `buyer_last_name` and
 * `buyer_company: false`. The flag is always sent: Fakturownia creates the
 * buyer as a company when it is missing (measured in production: B2C
 * receipts came out as companies), and KSeF sends company documents
 * automatically by this flag (KSeF.md, "Konfiguracja automatycznej wysyłki").
 *
 * THE TAX ID comes from the sources of `nipSources` (`lib/nip.ts`): by
 * default the order metadata, then the billing address metadata, under the
 * keys of `taxIdMetadataKeys` (nip, tax_id, invoice_nip), then a `tax_id`
 * field on the billing address. A Polish NIP must pass the checksum and an
 * EU VAT number must have the right shape.
 *
 * AN INVALID TAX ID, OR A COMPANY NAME WITHOUT ONE, gives a CONSUMER document
 * and a warning on the row for the admin (`warning`), never a surprise
 * refusal (HTTP 422) from Fakturownia or KSeF. The warning names the problem
 * and the source, never the number itself.
 *
 * THE ADDRESS comes from the billing address, or the shipping address when
 * the billing one is empty. Street is `address_1` and `address_2` together:
 * measured in production, people type the house number in the second line.
 *
 * Nothing here is stored: the plugin tables keep only `company` or `person`
 * and the warning.
 */

import { COMPANY_METADATA_KEYS } from "./constants"
import { checkTaxId, findTaxIdIn, isValidNip, resolveNipSources, type CompanyLookup, type NipSource } from "./nip"

export { isValidNip }

export interface AddressRecord {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  address_1?: string | null
  address_2?: string | null
  postal_code?: string | null
  city?: string | null
  province?: string | null
  country_code?: string | null
  phone?: string | null
  tax_id?: string | null
  metadata?: Record<string, unknown> | null
}

export interface BuyerSource {
  email?: string | null
  metadata?: Record<string, unknown> | null
  billing_address?: AddressRecord | null
  shipping_address?: AddressRecord | null
  /** Companies found by the `company` sources of `nipSources`, by entity (filled in before the build). */
  company_lookup?: Record<string, CompanyLookup | null> | null
}

export type BuyerType = "company" | "person"

export interface BuyerFields {
  buyer_company: boolean
  buyer_name: string
  buyer_tax_no?: string
  buyer_first_name?: string
  buyer_last_name?: string
  buyer_email?: string
  buyer_street?: string
  buyer_post_code?: string
  buyer_city?: string
  buyer_country?: string
}

/** Why a buyer that looks like a company got a consumer document. */
export interface BuyerWarning {
  code: "invalid_nip" | "company_without_nip"
  /** For an invalid NIP: what is wrong with it. */
  reason: "checksum" | "length" | "shape" | null
  /** Where the value was found ("order.metadata.nip"). */
  source: string | null
}

export interface Buyer {
  type: BuyerType
  taxId: string | null
  fields: BuyerFields
  warning: BuyerWarning | null
  /** Where the tax ID came from, for the admin. */
  taxIdSource: string | null
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const t = String(value).trim()
  return t.length > 0 ? t : undefined
}

/**
 * A tax ID as Fakturownia expects it, without validation (0.1.0). "PL1234563218",
 * "123-456-32-18" and "123 456 32 18" become "1234563218"; "DE123456789" stays;
 * text without digits ("brak") is no tax ID at all. `checkTaxId` also validates.
 */
export function cleanTaxId(raw: unknown): string | null {
  const t = text(raw)
  if (!t) return null
  let s = t.toUpperCase().replace(/[\s.\-_/\\]/g, "")
  if (s.startsWith("PL")) s = s.slice(2)
  else if (/^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(s) && /\d/.test(s)) return s
  const digits = s.replace(/\D/g, "")
  return digits.length > 0 ? digits : null
}

function metaText(meta: Record<string, unknown> | null | undefined, keys: readonly string[]): string | undefined {
  if (!meta || typeof meta !== "object") return undefined
  for (const key of keys) {
    const v = text(meta[key])
    if (v) return v
  }
  return undefined
}

/** The buyer's tax ID under the given metadata keys, cleaned (not validated), or null. Kept from 0.1.0. */
export function findTaxId(order: BuyerSource, keys: readonly string[]): string | null {
  const candidates = [metaText(order.metadata, keys), metaText(order.billing_address?.metadata, keys), text(order.billing_address?.tax_id)]
  for (const c of candidates) {
    const cleaned = cleanTaxId(c)
    if (cleaned) return cleaned
  }
  return null
}

function hasAddress(a: AddressRecord | null | undefined): a is AddressRecord {
  return Boolean(a && (text(a.address_1) || text(a.city) || text(a.postal_code)))
}

function names(a: AddressRecord | null | undefined): { first?: string; last?: string } | null {
  const first = text(a?.first_name)
  const last = text(a?.last_name)
  return first || last ? { first, last } : null
}

/** `nipSources` as given, or the metadata keys of 0.1.0 (a list of strings that are not source paths). */
function sourcesOf(sourcesOrKeys: readonly NipSource[] | readonly string[]): NipSource[] {
  if (sourcesOrKeys.length > 0 && typeof sourcesOrKeys[0] === "string") return resolveNipSources(undefined, sourcesOrKeys as readonly string[])
  return [...(sourcesOrKeys as readonly NipSource[])]
}

export function mapBuyer(order: BuyerSource, sourcesOrKeys: readonly NipSource[] | readonly string[]): Buyer {
  const billing = order.billing_address ?? null
  const shipping = order.shipping_address ?? null
  const address = hasAddress(billing) ? billing : hasAddress(shipping) ? shipping : null
  const person = names(billing) ?? names(shipping)
  const fullName = person ? [person.first, person.last].filter(Boolean).join(" ") : undefined
  const email = text(order.email)
  const found = findTaxIdIn(order, sourcesOf(sourcesOrKeys))

  const location: Partial<BuyerFields> = {}
  if (address) {
    const street = [text(address.address_1), text(address.address_2)].filter(Boolean).join(" ")
    if (street) location.buyer_street = street
    const postCode = text(address.postal_code)
    if (postCode) location.buyer_post_code = postCode
    const city = text(address.city)
    if (city) location.buyer_city = city
    const country = text(address.country_code)
    if (country) location.buyer_country = country.toUpperCase().slice(0, 2)
  }
  if (email) location.buyer_email = email

  const companyName = text(billing?.company) ?? text(found.companyName) ?? metaText(order.metadata, COMPANY_METADATA_KEYS) ?? text(shipping?.company)

  if (found.verdict.kind === "valid") {
    const taxId = found.verdict.taxId
    return {
      type: "company",
      taxId,
      fields: { buyer_company: true, buyer_name: (companyName ?? fullName ?? email ?? taxId).slice(0, 512), buyer_tax_no: taxId, ...location },
      warning: null,
      taxIdSource: found.source,
    }
  }

  const fields: BuyerFields = { buyer_company: false, buyer_name: (fullName ?? email ?? "-").slice(0, 512), ...location }
  if (person?.first) fields.buyer_first_name = person.first
  if (person?.last) fields.buyer_last_name = person.last
  const warning: BuyerWarning | null =
    found.verdict.kind === "invalid"
      ? { code: "invalid_nip", reason: found.verdict.reason, source: found.source }
      : text(billing?.company) || text(found.companyName)
        ? { code: "company_without_nip", reason: null, source: null }
        : null
  return { type: "person", taxId: null, fields, warning, taxIdSource: found.source }
}

/** Whether a raw value would make a company buyer (a valid tax ID). */
export function isCompanyTaxId(raw: unknown): boolean {
  return checkTaxId(raw).kind === "valid"
}
