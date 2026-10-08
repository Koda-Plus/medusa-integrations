import { DEMO_COMPANIES, DEMO_NIPS, DEMO_VAT, cleanNip, countryOf, demoCompany, demoGus, kindOf, sourceOf, stateFromMfStatus, stateFromVies } from "./whitelist"
import type { ResolvedWhitelistOptions } from "./options"
import type { CheckSource, CheckState } from "./constants"

/**
 * The checks against the registries. Real mode asks the Ministry of Finance
 * whitelist (Polish NIP), VIES (EU VAT numbers) and the GUS Business
 * Registry (REGON and legal form, with an API key); demo mode answers from
 * the simulated registry in `whitelist.ts` and nothing leaves the server.
 */

export interface CheckAnswer {
  source: CheckSource
  country_code: string
  state: CheckState
  status_vat: string | null
  name: string
  address: string
  bank_accounts: string[]
  regon: string | null
  krs: string | null
  legal_form: string | null
}

const EMPTY: CheckAnswer = { source: "whitelist", country_code: "PL", state: "unavailable", status_vat: null, name: "", address: "", bank_accounts: [], regon: null, krs: null, legal_form: null }

const today = () => new Date().toISOString().slice(0, 10)

async function checkWhitelist(baseUrl: string, nip: string): Promise<CheckAnswer> {
  try {
    const r = await fetch(`${baseUrl}/api/search/nip/${nip}?date=${today()}`)
    if (r.status === 404) return { ...EMPTY, source: "whitelist", country_code: "PL", state: "not_found" }
    if (!r.ok) return { ...EMPTY, source: "whitelist", country_code: "PL", state: "unavailable" }
    const json = (await r.json()) as { result?: { subject?: Record<string, unknown> } }
    const sub = json?.result?.subject
    if (!sub) return { ...EMPTY, source: "whitelist", country_code: "PL", state: "not_found" }
    return {
      source: "whitelist",
      country_code: "PL",
      state: stateFromMfStatus(sub.statusVat),
      status_vat: typeof sub.statusVat === "string" ? sub.statusVat : null,
      name: typeof sub.name === "string" ? sub.name : "",
      address: typeof sub.workingAddress === "string" ? sub.workingAddress : typeof sub.residenceAddress === "string" ? sub.residenceAddress : "",
      bank_accounts: Array.isArray(sub.accountNumbers) ? sub.accountNumbers.filter((a): a is string => typeof a === "string").slice(0, 5) : [],
      regon: typeof sub.regon === "string" ? sub.regon : null,
      krs: typeof sub.krs === "string" ? sub.krs : null,
      legal_form: null,
    }
  } catch {
    return { ...EMPTY, source: "whitelist", country_code: "PL", state: "unavailable" }
  }
}

async function checkVies(vat: string): Promise<CheckAnswer> {
  const country = vat.slice(0, 2)
  const number = vat.slice(2)
  try {
    const r = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${number}`, {
      headers: { Accept: "application/json" },
    })
    if (!r.ok) return { ...EMPTY, source: "vies", country_code: country, state: "unavailable" }
    const json = (await r.json()) as { isValid?: boolean; name?: string; address?: string }
    return {
      source: "vies",
      country_code: country,
      state: stateFromVies(json.isValid === true),
      status_vat: json.isValid === true ? "Czynny" : null,
      name: typeof json.name === "string" ? json.name : "",
      address: typeof json.address === "string" ? json.address : "",
      bank_accounts: [],
      regon: null,
      krs: null,
      legal_form: null,
    }
  } catch {
    return { ...EMPTY, source: "vies", country_code: country, state: "unavailable" }
  }
}

/** The simulated answer of demo mode, from the registry in whitelist.ts. */
export function demoAnswer(value: string): CheckAnswer {
  const kind = kindOf(value)
  if (kind === "nip") {
    const nip = cleanNip(value) ?? value.replace(/\D/g, "")
    const hit = DEMO_NIPS[nip]
    if (hit) return { source: "whitelist", country_code: "PL", state: hit.state, status_vat: hit.statusVat, name: hit.name, address: hit.address, bank_accounts: hit.accounts, regon: hit.regon ?? null, krs: hit.krs ?? null, legal_form: demoGus(nip).legal_form }
    /* A known company answers with its real public registry data. */
    const company = DEMO_COMPANIES[nip]
    if (company) {
      return { source: "whitelist", country_code: "PL", state: "active", status_vat: company.statusVat, name: company.name, address: company.address, bank_accounts: company.accounts, regon: company.regon, krs: company.krs, legal_form: company.legal_form }
    }
    /* Any other valid NIP gets a full simulated company card, so the demo reads like a real registry. */
    if (cleanNip(value)) {
      const c = demoCompany(nip)
      return { source: "whitelist", country_code: "PL", state: "active", status_vat: c.statusVat, name: c.name, address: c.address, bank_accounts: c.accounts, regon: c.regon, krs: c.krs, legal_form: demoGus(nip).legal_form }
    }
    return { ...EMPTY, source: "whitelist", country_code: "PL", state: "not_found" }
  }
  const vat = value.replace(/[\s-]/g, "").toUpperCase()
  const hit = DEMO_VAT.get(vat)
  if (hit) return { source: "vies", country_code: vat.slice(0, 2), state: hit.valid ? "active" : "not_found", status_vat: hit.valid ? "Czynny" : null, name: hit.name, address: hit.address, bank_accounts: [], regon: null, krs: null, legal_form: null }
  return { ...EMPTY, source: "vies", country_code: vat.slice(0, 2) || "XX", state: "not_found" }
}

/** Checks a number: the format decides the source, the options decide the mode. */
export async function checkNumber(value: string, options: ResolvedWhitelistOptions): Promise<CheckAnswer> {
  const kind = kindOf(value)
  if (kind === null) return { ...EMPTY, source: "vies", country_code: countryOf(value), state: "invalid" }
  if (kind === "nip" && !cleanNip(value)) return { ...EMPTY, source: "whitelist", country_code: "PL", state: "invalid" }
  if (options.demo) return demoAnswer(value)
  const vat = value.replace(/[\s-]/g, "").toUpperCase()
  return kind === "nip" ? checkWhitelist(options.baseUrl, vat) : checkVies(vat)
}

/* ------------------------------------------------------------------ */
/* GUS: the Business Registry (REGON and legal form)                   */
/* ------------------------------------------------------------------ */

/** The simulated GUS answer of demo mode, next to the whitelist answer. */
export function demoGusAnswer(value: string): CheckAnswer {
  const nip = cleanNip(value) ?? value.replace(/\D/g, "")
  const gus = demoGus(nip)
  if (gus.state === "not_found") return { ...EMPTY, source: "gus", country_code: "PL", state: "not_found" }
  const company = DEMO_COMPANIES[nip] ?? (DEMO_NIPS[nip] ? { name: DEMO_NIPS[nip].name, address: DEMO_NIPS[nip].address } : null) ?? null
  const card = company ?? demoCompany(nip)
  return {
    source: "gus",
    country_code: "PL",
    state: gus.state,
    status_vat: null,
    name: card.name,
    address: card.address,
    bank_accounts: [],
    regon: gus.regon,
    krs: null,
    legal_form: gus.legal_form,
  }
}

/**
 * The GUS Business Registry check (BIR 1.1 SOAP). Runs only with a
 * `gusApiKey`; demo mode answers with simulated data and never calls GUS.
 * Any failure reads as unavailable, never as an error that stops the flow.
 */
export async function checkGus(nip: string, options: ResolvedWhitelistOptions): Promise<CheckAnswer | null> {
  if (options.demo) return demoGusAnswer(nip)
  if (!options.gusApiKey) return null

  const BODY = (action: string, inner: string) =>
    `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07"><soap12:Body><ns:${action}>${inner}</ns:${action}></soap12:Body></soap12:Envelope>`
  const headers = {
    "Content-Type": "application/soap+xml; charset=utf-8",
    "Accept": "application/soap+xml",
    "Action": "",
  }
  const endpoint = "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc"

  try {
    /* 1. Log in with the API key, get the session id. */
    headers.Action = "http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj"
    const login = await fetch(endpoint, { method: "POST", headers, body: BODY("Zaloguj", `<ns:pKluczUzytkownika>${options.gusApiKey}</ns:pKluczUzytkownika>`) })
    if (!login.ok) return { ...EMPTY, source: "gus", country_code: "PL", state: "unavailable" }
    const loginXml = await login.text()
    const sid = /<ZalogujResult>([^<]+)<\/ZalogujResult>/.exec(loginXml)?.[1] ?? ""

    /* 2. Search by NIP. */
    headers.Action = "http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty"
    const search = await fetch(endpoint, {
      method: "POST",
      headers: { ...headers, sid },
      body: BODY("DaneSzukajPodmioty", "<ns:pParametryWyszukiwania><Nip>" + nip + "</Nip></ns:pParametryWyszukiwania>"),
    })
    if (!search.ok) return { ...EMPTY, source: "gus", country_code: "PL", state: "unavailable" }
    const xml = await search.text()

    /* The fobject carries the company: its legal form, REGON, name and address. */
    const fobject = /<dane>([\s\S]*?)<\/dane>/.exec(xml)?.[1] ?? ""
    const pick = (re: RegExp) => (re.exec(fobject)?.[1] ?? "").trim() || null
    const legalForm = pick(/<prawnaForma_Nazwa[^>]*>([^<]*)/) ?? pick(/<formaPrawna_Nazwa[^>]*>([^<]*)/)
    const regon = pick(/<regon9>([^<]*)/)
    const name = pick(/<praw_nazwa>([^<]*)/) ?? pick(/<nazwa>([^<]*)/)
    if (!legalForm && !regon && !name) return { ...EMPTY, source: "gus", country_code: "PL", state: "not_found" }
    return {
      source: "gus",
      country_code: "PL",
      state: "active",
      status_vat: null,
      name: name ?? "",
      address: "",
      bank_accounts: [],
      regon,
      krs: null,
      legal_form: legalForm,
    }
  } catch {
    return { ...EMPTY, source: "gus", country_code: "PL", state: "unavailable" }
  }
}

export { sourceOf }
