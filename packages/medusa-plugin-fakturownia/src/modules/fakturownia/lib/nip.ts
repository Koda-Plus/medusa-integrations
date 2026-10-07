/**
 * THE BUYER'S TAX ID (NIP): WHERE IT IS, AND WHETHER IT IS ONE. Zero imports.
 *
 * WHERE (`nipSources`, in order, the first value found wins):
 *
 *   "order.metadata.<key>"           a key of the order metadata
 *   "billing_address.metadata.<key>" a key of the billing address metadata
 *   "billing_address.tax_id"         a `tax_id` field a store added to its addresses
 *   "billing_address.company"        a NIP typed into the company name
 *                                    ("Firma sp. z o.o., NIP 123-456-32-18");
 *                                    only a number that passes the checksum
 *   { entity, customerField?, nipField?, nameField? }
 *                                    a module of the store that keeps companies
 *                                    by customer (B2B), read with Query:
 *                                    `{ entity: "company" }` reads the
 *                                    `company` whose `customer_id` is the
 *                                    order's customer, its `nip` and `name`
 *
 * Without the option: the keys of `taxIdMetadataKeys` in the order metadata,
 * then in the billing address metadata, then `billing_address.tax_id` (the
 * behaviour of 0.1.0).
 *
 * WHETHER: a Polish NIP must have ten digits and pass the checksum (weights
 * 6 5 7 2 3 4 5 6 7, modulo 11). A tax ID with another EU country prefix
 * ("DE123456789") is kept when its shape is right: each country has its own
 * checksum, and Fakturownia marks it `nip_ue`. A value that is neither is
 * not a tax ID: the document is issued for a consumer and the admin says why,
 * instead of a refusal (HTTP 422) from Fakturownia or KSeF.
 */

export type NipSource =
  | { kind: "order_metadata"; key: string }
  | { kind: "billing_metadata"; key: string }
  | { kind: "billing_tax_id" }
  | { kind: "billing_company" }
  | { kind: "company"; entity: string; customerField: string; nipField: string; nameField: string | null }

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/
const METADATA_KEY = /^[A-Za-z0-9_.-]{1,64}$/

/** One source from the option, or null when it is not one this version knows. */
export function parseNipSource(v: unknown): NipSource | null {
  if (typeof v === "string") {
    const s = v.trim()
    const order = /^order\.metadata\.(.+)$/.exec(s)
    if (order && METADATA_KEY.test(order[1])) return { kind: "order_metadata", key: order[1] }
    const billing = /^billing_address\.metadata\.(.+)$/.exec(s)
    if (billing && METADATA_KEY.test(billing[1])) return { kind: "billing_metadata", key: billing[1] }
    if (s === "billing_address.tax_id") return { kind: "billing_tax_id" }
    if (s === "billing_address.company") return { kind: "billing_company" }
    const company = /^company:([A-Za-z_][A-Za-z0-9_]{0,62})$/.exec(s)
    if (company) return { kind: "company", entity: company[1], customerField: "customer_id", nipField: "nip", nameField: "name" }
    return null
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const entity = typeof o.entity === "string" ? o.entity.trim() : ""
    if (!NAME.test(entity)) return null
    const field = (x: unknown, fallback: string | null) => (typeof x === "string" && NAME.test(x.trim()) ? x.trim() : fallback)
    return {
      kind: "company",
      entity,
      customerField: field(o.customerField, "customer_id") as string,
      nipField: field(o.nipField, "nip") as string,
      nameField: o.nameField === null ? null : field(o.nameField, "name"),
    }
  }
  return null
}

/** The sources of the option; the default of 0.1.0 when the option is missing or holds nothing usable. */
export function resolveNipSources(option: unknown, taxIdMetadataKeys: readonly string[]): NipSource[] {
  const raw = Array.isArray(option) ? option : typeof option === "string" ? option.split(",") : null
  const parsed = (raw ?? []).map(parseNipSource).filter((s): s is NipSource => s !== null)
  if (parsed.length > 0) return parsed
  return [
    ...taxIdMetadataKeys.map((key) => ({ kind: "order_metadata" as const, key })),
    ...taxIdMetadataKeys.map((key) => ({ kind: "billing_metadata" as const, key })),
    { kind: "billing_tax_id" as const },
  ]
}

/** How a source reads in the admin: "order.metadata.nip", "company (customer_id, nip)". */
export function describeNipSource(s: NipSource): string {
  switch (s.kind) {
    case "order_metadata":
      return `order.metadata.${s.key}`
    case "billing_metadata":
      return `billing_address.metadata.${s.key}`
    case "billing_tax_id":
      return "billing_address.tax_id"
    case "billing_company":
      return "billing_address.company"
    case "company":
      return `${s.entity} (${s.customerField}, ${s.nipField}${s.nameField ? `, ${s.nameField}` : ""})`
  }
}

/** The Polish NIP checksum (weights 6 5 7 2 3 4 5 6 7). */
export function isValidNip(nip: string | null | undefined): boolean {
  if (!nip || !/^\d{10}$/.test(nip)) return false
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const sum = w.reduce((acc, weight, i) => acc + weight * Number(nip[i]), 0)
  return sum % 11 === Number(nip[9])
}

/**
 * The VAT numbers of the other EU countries (and Northern Ireland, XI), by
 * prefix: the shape of the part after it, as the VIES service describes it.
 * Greece uses EL, not GR. A prefix outside the list (US, AB) is not an EU
 * VAT number: such a buyer gets a consumer document with a warning.
 */
export const EU_VAT_SHAPES: Readonly<Record<string, RegExp>> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d[A-Z0-9+*]\d{5}[A-Z]|\d{7}[A-Z]{1,2})$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
}

/** An EU VAT number of another country: a known prefix and the shape of that country's numbers. */
export function isEuVatShape(value: string): boolean {
  const shape = EU_VAT_SHAPES[value.slice(0, 2)]
  return Boolean(shape) && shape.test(value.slice(2))
}

export type TaxIdVerdict =
  | { kind: "valid"; taxId: string }
  | { kind: "invalid"; reason: "checksum" | "length" | "shape" }
  | { kind: "none" }

/**
 * A raw value as a tax ID. "PL 123-456-32-18", "123 456 32 18" and
 * "1234563218" are the same NIP; "DE123456789" stays as it is; text without
 * digits ("brak") is no tax ID at all.
 */
export function checkTaxId(raw: unknown): TaxIdVerdict {
  if (raw === null || raw === undefined) return { kind: "none" }
  const t = String(raw).trim()
  if (!t || !/\d/.test(t)) return { kind: "none" }
  let s = t.toUpperCase().replace(/^NIP[:\s]*/, "").replace(/[\s.\-_/\\]/g, "")
  if (/^[A-Z]{2}/.test(s) && !s.startsWith("PL")) return isEuVatShape(s) ? { kind: "valid", taxId: s } : { kind: "invalid", reason: "shape" }
  if (s.startsWith("PL")) s = s.slice(2)
  /* Ten digits decide, whatever else was typed around them ("1234563218 (firma)"): the checksum guards against junk. */
  const digits = s.replace(/\D/g, "")
  if (digits.length !== 10) return { kind: "invalid", reason: "length" }
  return isValidNip(digits) ? { kind: "valid", taxId: digits } : { kind: "invalid", reason: "checksum" }
}

/**
 * A NIP typed into a company name: a group of ten digits (with the usual
 * separators) that passes the checksum. Anything else in the name is ignored,
 * so a street number or a phone number is never taken for a NIP.
 */
export function nipInText(text: unknown): string | null {
  if (typeof text !== "string") return null
  const re = /(?:PL\s*)?(\d(?:[\s-]?\d){9})(?!\d)/gi
  for (const m of text.matchAll(re)) {
    const digits = m[1].replace(/\D/g, "")
    if (digits.length === 10 && isValidNip(digits)) return digits
  }
  return null
}

/** A company found by a `company` source: what the store's module holds for the order's customer. */
export interface CompanyLookup {
  nip: string | null
  name: string | null
}

export interface NipSourcesInput {
  metadata?: Record<string, unknown> | null
  billing_address?: { company?: string | null; tax_id?: string | null; metadata?: Record<string, unknown> | null } | null
  /** Results of the `company` sources, by entity name (filled in by the workflow before the document is built). */
  company_lookup?: Record<string, CompanyLookup | null> | null
}

export interface FoundTaxId {
  verdict: TaxIdVerdict
  /** Which source gave the value, for the admin ("order.metadata.nip"). Null when none did. */
  source: string | null
  /** The company name the source knew (a company module). */
  companyName: string | null
}

function metaValue(meta: Record<string, unknown> | null | undefined, key: string): unknown {
  if (!meta || typeof meta !== "object") return undefined
  const v = meta[key]
  return typeof v === "string" || typeof v === "number" ? v : undefined
}

/**
 * The first source that holds a value decides. A value that is not a valid
 * tax ID is reported as invalid and NOT replaced by a later source: a buyer
 * who typed a wrong NIP should be told, not silently invoiced with another
 * number the store happens to hold.
 */
export function findTaxIdIn(order: NipSourcesInput, sources: readonly NipSource[]): FoundTaxId {
  for (const s of sources) {
    let value: unknown
    let companyName: string | null = null
    switch (s.kind) {
      case "order_metadata":
        value = metaValue(order.metadata, s.key)
        break
      case "billing_metadata":
        value = metaValue(order.billing_address?.metadata, s.key)
        break
      case "billing_tax_id":
        value = order.billing_address?.tax_id
        break
      case "billing_company":
        value = nipInText(order.billing_address?.company)
        break
      case "company": {
        const found = order.company_lookup?.[s.entity] ?? null
        value = found?.nip
        companyName = found?.name ?? null
        break
      }
    }
    const verdict = checkTaxId(value)
    if (verdict.kind !== "none") return { verdict, source: describeNipSource(s), companyName }
  }
  return { verdict: { kind: "none" }, source: null, companyName: null }
}
