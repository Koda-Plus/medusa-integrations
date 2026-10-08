import { DEMO_NIPS, DEMO_VAT, cleanNip, countryOf, kindOf, sourceOf, stateFromMfStatus, stateFromVies } from "./whitelist"
import type { ResolvedWhitelistOptions } from "./options"
import type { CheckSource, CheckState } from "./constants"

/**
 * The checks against the registries. Real mode asks the Ministry of Finance
 * whitelist (Polish NIP) and VIES (EU VAT numbers); demo mode answers from
 * the simulated tables in `whitelist.ts` and nothing leaves the server.
 */

export interface CheckAnswer {
  source: CheckSource
  country_code: string
  state: CheckState
  status_vat: string | null
  name: string
  address: string
  bank_accounts: string[]
}

const today = () => new Date().toISOString().slice(0, 10)

async function checkWhitelist(baseUrl: string, nip: string): Promise<CheckAnswer> {
  try {
    const r = await fetch(`${baseUrl}/api/search/nip/${nip}?date=${today()}`)
    if (r.status === 404) return { source: "whitelist", country_code: "PL", state: "not_found", status_vat: null, name: "", address: "", bank_accounts: [] }
    if (!r.ok) return { source: "whitelist", country_code: "PL", state: "unavailable", status_vat: null, name: "", address: "", bank_accounts: [] }
    const json = (await r.json()) as { result?: { subject?: Record<string, unknown> } }
    const sub = json?.result?.subject
    if (!sub) return { source: "whitelist", country_code: "PL", state: "not_found", status_vat: null, name: "", address: "", bank_accounts: [] }
    return {
      source: "whitelist",
      country_code: "PL",
      state: stateFromMfStatus(sub.statusVat),
      status_vat: typeof sub.statusVat === "string" ? sub.statusVat : null,
      name: typeof sub.name === "string" ? sub.name : "",
      address: typeof sub.workingAddress === "string" ? sub.workingAddress : typeof sub.residenceAddress === "string" ? sub.residenceAddress : "",
      bank_accounts: Array.isArray(sub.accountNumbers) ? sub.accountNumbers.filter((a): a is string => typeof a === "string").slice(0, 5) : [],
    }
  } catch {
    return { source: "whitelist", country_code: "PL", state: "unavailable", status_vat: null, name: "", address: "", bank_accounts: [] }
  }
}

async function checkVies(vat: string): Promise<CheckAnswer> {
  const country = vat.slice(0, 2)
  const number = vat.slice(2)
  try {
    const r = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${number}`, {
      headers: { Accept: "application/json" },
    })
    if (!r.ok) return { source: "vies", country_code: country, state: "unavailable", status_vat: null, name: "", address: "", bank_accounts: [] }
    const json = (await r.json()) as { isValid?: boolean; name?: string; address?: string }
    return {
      source: "vies",
      country_code: country,
      state: stateFromVies(json.isValid === true),
      status_vat: json.isValid === true ? "Czynny" : null,
      name: typeof json.name === "string" ? json.name : "",
      address: typeof json.address === "string" ? json.address : "",
      bank_accounts: [],
    }
  } catch {
    return { source: "vies", country_code: country, state: "unavailable", status_vat: null, name: "", address: "", bank_accounts: [] }
  }
}

/** The simulated answer of demo mode, from the tables in whitelist.ts. */
export function demoAnswer(value: string): CheckAnswer {
  const kind = kindOf(value)
  if (kind === "nip") {
    const nip = cleanNip(value) ?? value.replace(/\D/g, "")
    const hit = DEMO_NIPS[nip]
    if (hit) return { source: "whitelist", country_code: "PL", state: hit.state, status_vat: hit.statusVat, name: hit.name, address: hit.address, bank_accounts: hit.accounts }
    /* A valid NIP outside the sample tables reads as an active payer, so the demo feels alive. */
    if (cleanNip(value)) {
      return {
        source: "whitelist",
        country_code: "PL",
        state: "active",
        status_vat: "Czynny",
        name: "Podmiot demo",
        address: "ul. Przykładowa 1, 00-001 Warszawa",
        bank_accounts: ["61109010140000071219812874"],
      }
    }
    return { source: "whitelist", country_code: "PL", state: "not_found", status_vat: null, name: "", address: "", bank_accounts: [] }
  }
  const vat = value.replace(/[\s-]/g, "").toUpperCase()
  const hit = DEMO_VAT.get(vat)
  if (hit) return { source: "vies", country_code: vat.slice(0, 2), state: hit.valid ? "active" : "not_found", status_vat: hit.valid ? "Czynny" : null, name: hit.name, address: hit.address, bank_accounts: [] }
  return { source: "vies", country_code: vat.slice(0, 2) || "XX", state: "not_found", status_vat: null, name: "", address: "", bank_accounts: [] }
}

/** Checks a number: the format decides the source, the options decide the mode. */
export async function checkNumber(value: string, options: ResolvedWhitelistOptions): Promise<CheckAnswer> {
  const kind = kindOf(value)
  if (kind === null) return { source: "vies", country_code: countryOf(value), state: "invalid", status_vat: null, name: "", address: "", bank_accounts: [] }
  if (kind === "nip" && !cleanNip(value)) return { source: "whitelist", country_code: "PL", state: "invalid", status_vat: null, name: "", address: "", bank_accounts: [] }
  if (options.demo) return demoAnswer(value)
  const vat = value.replace(/[\s-]/g, "").toUpperCase()
  return kind === "nip" ? checkWhitelist(options.baseUrl, vat) : checkVies(vat)
}

export { sourceOf }
