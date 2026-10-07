/**
 * RECEIVER DATA AS SHIPX WANTS IT. Zero imports.
 *
 * Generalized from the payload builder of a Polish cosmetics wholesaler's
 * warehouse app, which ships its InPost parcels every day:
 *
 *   phone       ShipX takes Polish numbers only, nine digits without the
 *               country code: "+48 000-000-001" and "0048000000001" become
 *               "000000001", anything else is refused before sending
 *   post code   "00950" becomes "00-950"; other countries stay as typed
 *   address     ShipX wants the street and the building number apart, while
 *               Medusa keeps "ul. Kwiatowa 5/2" in one line: the number (with
 *               a letter, 12A), the flat after "/" or "m." or "lok.", and a
 *               number in address_2 are split out
 */

/** Nine digits, or null when the value cannot be one Polish number. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D+/g, "")
  if (d.length === 13 && d.startsWith("0048")) d = d.slice(4)
  if (d.length === 11 && d.startsWith("48")) d = d.slice(2)
  return /^\d{9}$/.test(d) ? d : null
}

/** "00-000" for Poland when the value has five digits; other countries trimmed. */
export function normalizePostCode(raw: unknown, countryCode = "PL"): string {
  const s = String(raw ?? "").trim()
  if (countryCode.toUpperCase() !== "PL") return s
  const d = s.replace(/\D+/g, "")
  return d.length === 5 ? `${d.slice(0, 2)}-${d.slice(2)}` : s
}

export function isPolishPostCode(code: string): boolean {
  return /^\d{2}-\d{3}$/.test(code)
}

/** A plain e-mail address check: a name, one at sign, a domain with a dot, no spaces. */
export function isEmail(raw: unknown): boolean {
  const s = String(raw ?? "").trim()
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)
}

export interface StreetParts {
  street: string
  building_number: string
  flat_number?: string
}

/**
 * Street, building and flat from Medusa's two address lines.
 *
 *   "ul. Kwiatowa 5/2"                 street "ul. Kwiatowa", 5, flat 2
 *   "Aleje Jerozolimskie 123A m. 4"    123A, flat 4
 *   "ul. 3 Maja 12"                    the number at the end wins
 *   "Rynek" + "7"                      the building from address_2
 *   "Polna 1" + "lok. 3"               a number in address_2 is the flat
 *
 * Returns null when no building number can be found: the plan then asks a
 * person to fix the address in Medusa instead of guessing one.
 */
export function splitStreet(address1: unknown, address2?: unknown): StreetParts | null {
  const a1 = String(address1 ?? "").trim()
  const a2 = String(address2 ?? "").trim()
  const NUMBER = String.raw`(\d+(?:\s?[A-Za-z])?)`
  const FLAT = String.raw`(?:\s*[/-]\s*(\d+[A-Za-z]?)|,?\s+(?:m\.?|lok\.?|mieszk\.?)\s*(\d+[A-Za-z]?))?`
  const m = a1.match(new RegExp(String.raw`^(.*?)[\s,]+${NUMBER}${FLAT}\s*$`))
  let street = a1
  let building = ""
  let flat: string | undefined
  if (m && m[1].trim()) {
    street = m[1].trim().replace(/,$/, "")
    building = m[2].replace(/\s/g, "")
    flat = m[3] || m[4] || undefined
  }
  if (building) {
    const a2num = a2.match(/(\d+[A-Za-z]?)/)?.[1]
    if (!flat && a2num) flat = a2num
  } else {
    /* No number in the first line: "5/2" or "5 m. 2" in the second, else its first number. */
    const m2 = a2.match(new RegExp(String.raw`^${NUMBER}${FLAT}$`))
    if (m2) {
      building = m2[1].replace(/\s/g, "")
      flat = m2[2] || m2[3] || undefined
    } else {
      const a2num = a2.match(/(\d+[A-Za-z]?)/)?.[1]
      if (a2num) building = a2num
    }
    street = a1 || ""
  }
  if (!street || !building) return null
  return { street: street.slice(0, 100), building_number: building.slice(0, 20), ...(flat ? { flat_number: flat.slice(0, 20) } : {}) }
}

/** "Anna Nowak", "Salon Uroda" or both, for the plan the person reads. */
export function displayName(a: { first_name?: unknown; last_name?: unknown; company?: unknown } | null | undefined): string {
  if (!a) return ""
  const person = [a.first_name, a.last_name].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ")
  const company = String(a.company ?? "").trim()
  return [company, person].filter(Boolean).join(", ")
}
