/**
 * PARCEL LOCKERS: the code format, the locker a storefront sends in the
 * shipping method data, and a map link. Zero imports.
 *
 * Locker codes are three to six letters, an optional second group after a
 * hyphen (PaczkoPunkty: "POP-KRA394"), one to five digits and up to five
 * letters: "KRA01M", "WAW198M", "GDA05APP", "POP-WAW722". Checked against a
 * sample of five thousand points of the public points API.
 */

const LOCKER_CODE = /^[A-Z]{2,6}(?:-[A-Z]{2,6})?\d{1,5}[A-Z]{0,5}$/

export interface LockerAddress {
  line1: string
  line2: string
  city: string
  post_code: string
}

export interface Locker {
  code: string
  name: string | null
  address: LockerAddress | null
}

/** Uppercased, without spaces. "kra 01m" becomes "KRA01M". */
export function normalizeLockerCode(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .slice(0, 24)
}

export function isLockerCode(code: string): boolean {
  return LOCKER_CODE.test(code)
}

const text = (v: unknown, max = 200): string => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "")

function addressOf(raw: unknown): LockerAddress | null {
  if (!raw || typeof raw !== "object") return null
  const a = raw as Record<string, unknown>
  const out: LockerAddress = {
    line1: text(a.line1),
    line2: text(a.line2),
    city: text(a.city),
    post_code: text(a.post_code ?? a.postal_code),
  }
  return out.line1 || out.line2 || out.city || out.post_code ? out : null
}

/**
 * The locker in the shipping method data, as storefronts send it. The
 * documented fields are `machine_id`, `machine_name` and `machine_address`
 * ({ line1, line2, city, post_code }); `target_point`, `locker_code` and
 * `point` are read too, so a storefront built for another InPost plugin keeps
 * working. Null when there is no code at all (the format is checked apart).
 */
export function lockerFromData(data: Record<string, unknown> | null | undefined): Locker | null {
  if (!data || typeof data !== "object") return null
  const nested = data.locker && typeof data.locker === "object" ? (data.locker as Record<string, unknown>) : null
  const raw = data.machine_id ?? data.target_point ?? data.locker_code ?? data.point ?? nested?.code ?? nested?.name
  const code = normalizeLockerCode(raw)
  if (!code) return null
  const name = text(data.machine_name ?? nested?.name) || null
  return { code, name, address: addressOf(data.machine_address ?? nested?.address) }
}

/** The address in one line: "ul. Narzędziowa 12, 00-950 Warszawa". */
export function lockerAddressLine(a: LockerAddress | null | undefined): string {
  if (!a) return ""
  const second = a.line2 || [a.post_code, a.city].filter(Boolean).join(" ")
  return [a.line1, second].filter(Boolean).join(", ")
}

/** A map search for the locker (Google Maps URL scheme), by code and address. */
export function lockerMapUrl(locker: Pick<Locker, "code" | "address"> | null | undefined): string | null {
  if (!locker?.code) return null
  const query = ["Paczkomat", locker.code, lockerAddressLine(locker.address)].filter(Boolean).join(" ")
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/** The fields a storefront stores for the locker, the same shape the earlier InPost providers used. */
export function lockerData(locker: Locker): Record<string, unknown> {
  return {
    machine_id: locker.code,
    machine_name: locker.name ?? locker.code,
    machine_address: locker.address ?? null,
  }
}
