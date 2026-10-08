import { MF_STATUS_TO_STATE, NIP_DIGITS, NIP_PATTERN, VAT_PATTERN, type CheckSource, type CheckState } from "./constants"

/**
 * The pure parts of a check: cleaning and validating a Polish NIP, telling a
 * Polish NIP from an EU VAT number, and mapping the raw registry answers to
 * the module's states. Testable without a database or a network.
 */

/** The digits of a NIP, or null when it is not 10 digits with a valid checksum. */
export function cleanNip(value: string): string | null {
  const c = value.replace(/\D/g, "")
  if (!NIP_PATTERN.test(c) || !validNipChecksum(c)) return null
  return c
}

export function validNipChecksum(nip: string): boolean {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const sum = weights.reduce((acc, w, i) => acc + w * Number(nip[i]), 0)
  const check = sum % 11
  return check !== 10 && check === Number(nip[9])
}

/** A Polish NIP (10 digits) or an EU VAT number (country code and 2 to 12 characters). */
export function kindOf(value: string): "nip" | "vat" | null {
  const c = value.replace(/[\s-]/g, "").toUpperCase()
  if (/^\d{10}$/.test(c)) return "nip"
  if (VAT_PATTERN.test(c)) return "vat"
  return null
}

/** The country of a Polish NIP or the two-letter prefix of an EU VAT number. */
export function countryOf(value: string): string {
  const c = value.replace(/[\s-]/g, "").toUpperCase()
  return /^\d{10}$/.test(c) ? "PL" : c.slice(0, 2)
}

export function sourceOf(value: string): CheckSource {
  return kindOf(value) === "nip" ? "whitelist" : "vies"
}

/** The module's state from the raw MF statusVat value. */
export function stateFromMfStatus(statusVat: unknown): CheckState {
  return typeof statusVat === "string" ? (MF_STATUS_TO_STATE[statusVat] ?? "unavailable") : "unavailable"
}

/** The module's state from the VIES answer. */
export function stateFromVies(isValid: boolean): CheckState {
  return isValid ? "active" : "not_found"
}

/* ------------------------------------------------------------------ */
/* Demo data (simulated answers, flagged demo)                         */
/* ------------------------------------------------------------------ */

/** The simulated whitelist: a NIP answers from this table, deterministically. */
export const DEMO_NIPS: Record<string, { state: CheckState; statusVat: string | null; name: string; address: string; accounts: string[] }> = {
  "1234563218": {
    state: "active",
    statusVat: "Czynny",
    name: "Hurtownia Demo Sp. z o.o.",
    address: "ul. Przykładowa 15, 00-001 Warszawa",
    accounts: ["61109010140000071219812874"],
  },
  "0123456789": {
    state: "exempt",
    statusVat: "Zwolniony",
    name: "Warsztat Demo Jan Kowalski",
    address: "ul. Warsztatowa 2, 30-001 Kraków",
    accounts: ["61109010140000071219812874"],
  },
  "1111111111": { state: "not_found", statusVat: null, name: "", address: "", accounts: [] },
}

/** The simulated VIES answers for EU VAT numbers. */
export const DEMO_VAT = new Map<string, { valid: boolean; name: string; address: string }>([
  ["DE123456789", { valid: true, name: "Demo Werkzeuge GmbH", address: "Werkstraße 12, 60487 Frankfurt am Main" }],
  ["FR12345678901", { valid: true, name: "Demo Outils SARL", address: "12 Rue Exemple, 75001 Paris" }],
  ["DE999999999", { valid: false, name: "", address: "" }],
])

export { NIP_DIGITS }
