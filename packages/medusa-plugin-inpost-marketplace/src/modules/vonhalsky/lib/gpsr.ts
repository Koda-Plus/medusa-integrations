/**
 * THE GPSR MANUFACTURER OF A PRODUCT, from the best source there is:
 *
 *   1. the EU Compliance plugin of Koda Plus, when its module is in the
 *      container: `compliance_product.manufacturer_id` names an operator
 *      with a name, an address and an e-mail;
 *   2. product metadata: `gpsr_manufacturer` (an object, or the same as a
 *      JSON string) or the flat keys `manufacturer_name`,
 *      `manufacturer_email`, `manufacturer_address`, `manufacturer_phone`.
 *
 * Pure: the caller reads the rows, this picks and cleans.
 */

export interface GpsrManufacturer {
  name: string
  email: string | null
  address: string | null
  phone: string | null
}

const text = (v: unknown, max = 300): string | null => {
  if (typeof v !== "string") return null
  const s = v.trim().slice(0, max)
  return s ? s : null
}

export interface ComplianceOperatorLike {
  name?: unknown
  email?: unknown
  address?: unknown
  metadata?: Record<string, unknown> | null
}

export function fromCompliance(op: ComplianceOperatorLike | null | undefined): GpsrManufacturer | null {
  if (!op) return null
  const name = text(op.name)
  if (!name) return null
  const phone = op.metadata && typeof op.metadata === "object" ? text((op.metadata as Record<string, unknown>).phone, 40) : null
  return { name, email: text(op.email, 200), address: text(op.address), phone }
}

export function fromMetadata(metadata: Record<string, unknown> | null | undefined): GpsrManufacturer | null {
  if (!metadata || typeof metadata !== "object") return null
  let nested: unknown = metadata.gpsr_manufacturer
  if (typeof nested === "string") {
    try {
      nested = JSON.parse(nested)
    } catch {
      nested = { name: nested }
    }
  }
  const n = nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : {}
  const name = text(n.name) ?? text(metadata.manufacturer_name)
  if (!name) return null
  return {
    name,
    email: text(n.email, 200) ?? text(metadata.manufacturer_email, 200),
    address: text(n.address) ?? text(metadata.manufacturer_address),
    phone: text(n.phone, 40) ?? text(metadata.manufacturer_phone, 40),
  }
}

/** Compliance first (a complete record there is the store's own GPSR data), product metadata second. */
export function pickManufacturer(
  compliance: GpsrManufacturer | null,
  metadata: GpsrManufacturer | null,
): { manufacturer: GpsrManufacturer | null; source: "compliance" | "metadata" | null } {
  if (compliance) return { manufacturer: compliance, source: "compliance" }
  if (metadata) return { manufacturer: metadata, source: "metadata" }
  return { manufacturer: null, source: null }
}
