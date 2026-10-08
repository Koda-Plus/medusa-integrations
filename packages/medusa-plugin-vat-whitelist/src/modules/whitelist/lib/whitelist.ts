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
export const DEMO_NIPS: Record<string, { state: CheckState; statusVat: string | null; name: string; address: string; accounts: string[]; regon?: string; krs?: string }> = {
  "1234563218": {
    state: "active",
    statusVat: "Czynny",
    name: "Hurtownia Demo Sp. z o.o.",
    address: "ul. Przykładowa 15, 00-001 Warszawa",
    accounts: ["61109010140000071219812874"],
    regon: "016298263",
    krs: "0000026438",
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

/**
 * A known company, verified against the Ministry of Finance whitelist, so
 * the demo answers with real public registry data for it.
 */
export const DEMO_COMPANIES: Record<string, { name: string; address: string; statusVat: string; accounts: string[]; regon: string; krs: string; legal_form: string; registered: string }> = {
  "5250007738": {
    name: "Powszechna Kasa Oszczędności Bank Polski S.A.",
    address: "ul. Świętokrzyska 36, 00-116 Warszawa",
    statusVat: "Czynny",
    accounts: ["92105000861000009030362637", "84105000861000009030362587", "17105000861000009030362629"],
    regon: "016298263",
    krs: "0000026438",
    legal_form: "Spółka akcyjna",
    registered: "1998-10-01",
  },
}

const DEMO_NAMES = [
  "Bud-Mat Sp. z o.o.",
  "Narzędzia Techniczne Sp. z o.o.",
  "Stal-Serwis Sp. z o.o.",
  "Elektro-Hurt Sp. z o.o.",
  "Hurtownia Przemysłowa Sp. z o.o.",
  "Instal-Bud Sp. z o.o.",
  "Mechanika Precyzyjna Sp. z o.o.",
  "Odlewnia Metali Sp. z o.o.",
  "Transport Kraj-Trans Sp. z o.o.",
  "Przedsiębiorstwo Wielobranżowe Sp. z o.o.",
]

const DEMO_CITIES: Array<[string, string]> = [
  ["Warszawa", "00-001"],
  ["Kraków", "30-001"],
  ["Wrocław", "50-001"],
  ["Poznań", "60-001"],
  ["Gdańsk", "80-001"],
  ["Katowice", "40-001"],
  ["Łódź", "90-001"],
  ["Lublin", "20-001"],
  ["Bydgoszcz", "85-001"],
  ["Rzeszów", "35-001"],
]

const DEMO_STREETS = ["Przemysłowa", "Handlowa", "Magazynowa", "Towarowa", "Hutnicza", "Ślusarska", "Elektronowa", "Budowlana"]

/** The legal forms of the GUS REGON registry, for the simulated answers. */
export const DEMO_LEGAL_FORMS = ["Spółka z ograniczoną odpowiedzialnością", "Spółka akcyjna", "Spółka jawna", "Spółka komandytowa", "Jednoosobowa działalność gospodarcza"] as const

/** A small deterministic hash of a string, for the simulated registry. */
export function demoHash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** The simulated GUS answer for a NIP: the legal form and the REGON number. */
export function demoGus(nip: string): { state: CheckState; legal_form: string | null; regon: string | null } {
  if (nip === "1111111111") return { state: "not_found", legal_form: null, regon: null }
  const company = DEMO_COMPANIES[nip]
  if (company) return { state: "active", legal_form: company.legal_form, regon: company.regon }
  const special = DEMO_NIPS[nip]
  if (special) {
    return {
      state: special.state === "active" || special.state === "exempt" ? special.state : "not_found",
      legal_form: special.state === "exempt" ? "Jednoosobowa działalność gospodarcza" : "Spółka z ograniczoną odpowiedzialnością",
      regon: special.regon ?? null,
    }
  }
  const h = demoHash(nip)
  return { state: "active", legal_form: DEMO_LEGAL_FORMS[(h >> 2) % DEMO_LEGAL_FORMS.length], regon: String(100000000 + (h % 900000000)) }
}

/** A full simulated company card for any valid NIP: name, address, registries. */
export function demoCompany(nip: string): { name: string; address: string; statusVat: string; accounts: string[]; regon: string; krs: string; registered: string } {
  const h = demoHash(nip)
  const name = DEMO_NAMES[h % DEMO_NAMES.length]
  const [city, code] = DEMO_CITIES[(h >> 3) % DEMO_CITIES.length]
  const street = DEMO_STREETS[(h >> 6) % DEMO_STREETS.length]
  const number = 1 + ((h >> 9) % 120)
  const regon = String(100000000 + (h % 900000000))
  const krs = String(1000000000 + ((h >> 4) % 9000000000))
  const year = 1995 + ((h >> 11) % 30)
  return {
    name,
    address: `ul. ${street} ${number}, ${code} ${city}`,
    statusVat: "Czynny",
    accounts: ["61109010140000071219812874"],
    regon,
    krs,
    registered: `${year}-01-01`,
  }
}

/** The simulated VIES answers for EU VAT numbers. */
export const DEMO_VAT = new Map<string, { valid: boolean; name: string; address: string }>([
  ["DE123456789", { valid: true, name: "Demo Werkzeuge GmbH", address: "Werkstraße 12, 60487 Frankfurt am Main" }],
  ["FR12345678901", { valid: true, name: "Demo Outils SARL", address: "12 Rue Exemple, 75001 Paris" }],
  ["DE999999999", { valid: false, name: "", address: "" }],
])

export { NIP_DIGITS }
