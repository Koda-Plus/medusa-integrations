import { DEMO_COMPANIES, DEMO_NIPS, DEMO_VAT, cleanNip, countryOf, demoCompany, demoGus, kindOf, sourceOf, stateFromMfStatus, stateFromVies } from "./whitelist"
import { gusKey, registryMode, type PlRegistry, type ResolvedWhitelistOptions } from "./options"
import { GusClient, type GusActivity } from "./gus"
import type { CheckSource, CheckState } from "./constants"

/**
 * The checks against the registries, and the one company card they add up
 * to. A Polish NIP asks, in the order of `plRegistries`, the GUS Business
 * Registry (the company: name, address, REGON, KRS, legal form, whether it
 * still runs), the Ministry of Finance whitelist (the VAT status and the
 * bank accounts) and, when listed, VIES (the VAT-UE registration). An EU VAT
 * number asks VIES. Demo mode answers from the simulated registry in
 * `whitelist.ts`; `live` lets named registries answer for real in demo mode
 * for every number outside the demo samples.
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
  /** GUS only: whether the business runs, is suspended or has ended. */
  activity: GusActivity | null
  /** What else the registry said, kept in the row's metadata. */
  details: Record<string, string | null> | null
  /** True when this answer is simulated. */
  demo: boolean
}

const EMPTY: CheckAnswer = { source: "whitelist", country_code: "PL", state: "unavailable", status_vat: null, name: "", address: "", bank_accounts: [], regon: null, krs: null, legal_form: null, activity: null, details: null, demo: false }

const answer = (a: Partial<CheckAnswer> & Pick<CheckAnswer, "source" | "country_code" | "state">): CheckAnswer => ({ ...EMPTY, ...a })

const today = () => new Date().toISOString().slice(0, 10)

async function timed(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* The registries, for real                                            */
/* ------------------------------------------------------------------ */

async function checkWhitelist(options: ResolvedWhitelistOptions, nip: string): Promise<CheckAnswer> {
  try {
    const r = await timed(`${options.baseUrl}/api/search/nip/${nip}?date=${today()}`, { headers: { Accept: "application/json" } }, options.timeoutMs)
    if (r.status === 404) return answer({ source: "whitelist", country_code: "PL", state: "not_found" })
    if (!r.ok) return answer({ source: "whitelist", country_code: "PL", state: "unavailable", details: { reason: `HTTP ${r.status}` } })
    const json = (await r.json()) as { result?: { subject?: Record<string, unknown> | null } }
    const sub = json?.result?.subject
    /* The whitelist answers a NIP it does not know with subject: null. */
    if (!sub) return answer({ source: "whitelist", country_code: "PL", state: "not_found" })
    return answer({
      source: "whitelist",
      country_code: "PL",
      state: stateFromMfStatus(sub.statusVat),
      status_vat: typeof sub.statusVat === "string" ? sub.statusVat : null,
      name: typeof sub.name === "string" ? sub.name : "",
      address: typeof sub.workingAddress === "string" ? sub.workingAddress : typeof sub.residenceAddress === "string" ? sub.residenceAddress : "",
      bank_accounts: Array.isArray(sub.accountNumbers) ? sub.accountNumbers.filter((a): a is string => typeof a === "string").slice(0, 5) : [],
      regon: typeof sub.regon === "string" && sub.regon ? sub.regon : null,
      krs: typeof sub.krs === "string" && sub.krs ? sub.krs : null,
      details: { registered_at: typeof sub.registrationLegalDate === "string" ? sub.registrationLegalDate : null },
    })
  } catch (e) {
    return answer({ source: "whitelist", country_code: "PL", state: "unavailable", details: { reason: e instanceof Error && e.name === "AbortError" ? "timeout" : "network" } })
  }
}

async function checkVies(options: ResolvedWhitelistOptions, vat: string): Promise<CheckAnswer> {
  const country = vat.slice(0, 2)
  const number = vat.slice(2)
  try {
    const r = await timed(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${country}/vat/${encodeURIComponent(number)}`, { headers: { Accept: "application/json" } }, options.timeoutMs)
    if (!r.ok) return answer({ source: "vies", country_code: country, state: "unavailable", details: { reason: `HTTP ${r.status}` } })
    const json = (await r.json()) as { isValid?: boolean; name?: string; address?: string; userError?: string }
    /* VIES answers a member state that is down with userError, not with isValid false. */
    if (json.userError && json.userError !== "VALID" && json.userError !== "INVALID") return answer({ source: "vies", country_code: country, state: "unavailable", details: { reason: json.userError } })
    const clean = (v: unknown) => (typeof v === "string" && v.trim() !== "---" ? v.replace(/\s*\n\s*/g, ", ").trim() : "")
    return answer({
      source: "vies",
      country_code: country,
      state: stateFromVies(json.isValid === true),
      status_vat: json.isValid === true ? "VAT-UE" : null,
      name: clean(json.name),
      address: clean(json.address),
    })
  } catch (e) {
    return answer({ source: "vies", country_code: country, state: "unavailable", details: { reason: e instanceof Error && e.name === "AbortError" ? "timeout" : "network" } })
  }
}

async function checkGusLive(options: ResolvedWhitelistOptions, nip: string): Promise<CheckAnswer> {
  const key = gusKey(options)
  if (!key) return answer({ source: "gus", country_code: "PL", state: "unavailable", details: { reason: "missing_key" } })
  const r = await new GusClient({ key, environment: options.gusEnvironment, timeoutMs: options.timeoutMs }).lookup(nip)
  if (r.state === "not_found") return answer({ source: "gus", country_code: "PL", state: "not_found" })
  if (r.state === "unavailable") return answer({ source: "gus", country_code: "PL", state: "unavailable", details: { reason: r.reason } })
  const c = r.company
  return answer({
    source: "gus",
    country_code: "PL",
    state: c.activity === "active" ? "active" : "inactive",
    name: c.name,
    address: c.address,
    regon: c.regon,
    krs: c.krs,
    legal_form: c.legal_form,
    activity: c.activity,
    details: { type: c.type, started_at: c.started_at, suspended_at: c.suspended_at, ended_at: c.ended_at, register: c.register, legal_form_raw: c.legal_form_raw },
  })
}

/* ------------------------------------------------------------------ */
/* The registries, simulated                                           */
/* ------------------------------------------------------------------ */

/** The simulated answer of demo mode for the whitelist (a NIP) or VIES (an EU VAT number). */
export function demoAnswer(value: string): CheckAnswer {
  const kind = kindOf(value)
  if (kind === "nip") {
    const nip = cleanNip(value) ?? value.replace(/\D/g, "")
    const hit = DEMO_NIPS[nip]
    if (hit) return answer({ source: "whitelist", country_code: "PL", state: hit.state, status_vat: hit.statusVat, name: hit.name, address: hit.address, bank_accounts: hit.accounts, regon: hit.regon ?? null, krs: hit.krs ?? null, legal_form: demoGus(nip).legal_form, demo: true })
    /* A known company answers with its real public registry data. */
    const company = DEMO_COMPANIES[nip]
    if (company) {
      return answer({ source: "whitelist", country_code: "PL", state: "active", status_vat: company.statusVat, name: company.name, address: company.address, bank_accounts: company.accounts, regon: company.regon, krs: company.krs, legal_form: company.legal_form, demo: true })
    }
    /* Any other valid NIP gets a full simulated company card, so the demo reads like a real registry. */
    if (cleanNip(value)) {
      const c = demoCompany(nip)
      return answer({ source: "whitelist", country_code: "PL", state: "active", status_vat: c.statusVat, name: c.name, address: c.address, bank_accounts: c.accounts, regon: c.regon, krs: c.krs, legal_form: demoGus(nip).legal_form, demo: true })
    }
    return answer({ source: "whitelist", country_code: "PL", state: "not_found", demo: true })
  }
  const vat = value.replace(/[\s-]/g, "").toUpperCase()
  const hit = DEMO_VAT.get(vat)
  if (hit) return answer({ source: "vies", country_code: vat.slice(0, 2), state: hit.valid ? "active" : "not_found", status_vat: hit.valid ? "VAT-UE" : null, name: hit.name, address: hit.address, demo: true })
  /* A Polish number in VIES: the simulated whitelist company, registered for VAT-UE. */
  if (vat.startsWith("PL") && cleanNip(vat.slice(2))) {
    const pl = demoAnswer(vat.slice(2))
    return answer({ source: "vies", country_code: "PL", state: pl.state === "active" ? "active" : "not_found", status_vat: pl.state === "active" ? "VAT-UE" : null, name: pl.name, address: pl.address, demo: true })
  }
  return answer({ source: "vies", country_code: vat.slice(0, 2) || "XX", state: "not_found", demo: true })
}

/** The simulated GUS answer of demo mode, next to the whitelist answer. */
export function demoGusAnswer(value: string): CheckAnswer {
  const nip = cleanNip(value) ?? value.replace(/\D/g, "")
  const gus = demoGus(nip)
  if (gus.state === "not_found") return answer({ source: "gus", country_code: "PL", state: "not_found", demo: true })
  const company = DEMO_COMPANIES[nip] ?? (DEMO_NIPS[nip] ? { name: DEMO_NIPS[nip].name, address: DEMO_NIPS[nip].address, krs: DEMO_NIPS[nip].krs ?? "" } : null) ?? null
  const card = company ?? demoCompany(nip)
  return answer({
    source: "gus",
    country_code: "PL",
    state: "active",
    name: card.name,
    address: card.address,
    regon: gus.regon,
    krs: card.krs || null,
    legal_form: gus.legal_form,
    activity: "active",
    demo: true,
  })
}

/** The fictional numbers of demo mode: they answer from the simulation even with `live`. */
export function isDemoSample(value: string): boolean {
  const v = value.replace(/[\s-]/g, "").toUpperCase()
  const nip = v.startsWith("PL") ? v.slice(2) : v
  return Boolean(DEMO_NIPS[nip]) || DEMO_VAT.has(v)
}

/* ------------------------------------------------------------------ */
/* One number, every registry, one card                                */
/* ------------------------------------------------------------------ */

export interface RegistryResult {
  /** The merged company card: what the counterparty row keeps. */
  card: CheckAnswer
  /** One answer per registry asked, in order: the audit trail. */
  answers: CheckAnswer[]
}

/** The VIES member states (EL is Greece, XI Northern Ireland). */
export const VIES_COUNTRIES = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"])

/** How a number reads: a Polish NIP (also with the PL prefix), an EU VAT number, or nothing valid. */
export function parseNumber(value: string): { kind: "nip"; nip: string; prefixed: boolean } | { kind: "vat"; vat: string; country: string } | { kind: "invalid"; country: string } {
  const v = value.replace(/[\s.-]/g, "").toUpperCase()
  const k = kindOf(v)
  if (k === "nip") {
    const nip = cleanNip(v)
    return nip ? { kind: "nip", nip, prefixed: false } : { kind: "invalid", country: "PL" }
  }
  if (k === "vat") {
    if (v.startsWith("PL")) {
      const nip = cleanNip(v.slice(2))
      return nip && /^\d{10}$/.test(v.slice(2)) ? { kind: "nip", nip, prefixed: true } : { kind: "invalid", country: "PL" }
    }
    /* Greece is EL in VIES, GR in ISO. Only the VIES member states, and a number has digits. */
    const vat = v.startsWith("GR") ? `EL${v.slice(2)}` : v
    if (!VIES_COUNTRIES.has(vat.slice(0, 2)) || !/\d/.test(vat.slice(2))) return { kind: "invalid", country: v.slice(0, 2) }
    return { kind: "vat", vat, country: v.slice(0, 2) }
  }
  return { kind: "invalid", country: countryOf(v) }
}

/** The number to check: the country's prefix added when an EU number came without it (a store form per country). */
export function withCountry(raw: string, country: string | null): string {
  const v = raw.replace(/[\s.-]/g, "").toUpperCase()
  const cc = (country ?? "").trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc) || cc === "PL" || /^[A-Z]{2}/.test(v)) return v
  return `${cc === "GR" ? "EL" : cc}${v}`
}

/**
 * The registry that speaks for the VAT status: the whitelist for a Polish
 * NIP (VIES when the whitelist is not asked), VIES for an EU number.
 */
function vatAuthority(answers: CheckAnswer[]): CheckAnswer | undefined {
  return answers.find((a) => a.source === "whitelist") ?? answers.find((a) => a.source === "vies")
}

/**
 * The card of one counterparty from the answers of its registries. The
 * company data comes from the first registry that knows the company (GUS
 * first by default), the VAT status and the bank accounts from the
 * whitelist. The state:
 *   invalid      the number does not validate
 *   inactive     GUS says the business is suspended or has ended
 *   ...          otherwise the VAT registry's state (active, exempt, not_found)
 *   not_found    GUS does not know the NIP and no VAT registry answered
 *   unavailable  nobody answered
 */
export function mergeAnswers(answers: CheckAnswer[]): CheckAnswer {
  if (answers.length === 0) return answer({ source: "whitelist", country_code: "PL", state: "unavailable" })
  const known = answers.filter((a) => a.state !== "unavailable" && a.state !== "invalid" && a.state !== "not_found")
  const first = <K extends keyof CheckAnswer>(k: K) => known.map((a) => a[k]).find((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)))
  const gus = answers.find((a) => a.source === "gus")
  const vat = vatAuthority(answers)
  const wl = answers.find((a) => a.source === "whitelist")

  let state: CheckState
  if (answers.every((a) => a.state === "invalid")) state = "invalid"
  else if (gus?.activity === "closed" || gus?.activity === "suspended") state = "inactive"
  else if (vat && vat.state !== "unavailable") state = vat.state
  else if (!vat && gus) state = gus.state
  else if (gus?.state === "not_found") state = "not_found"
  else state = "unavailable"

  const lead = known.find((a) => a.name) ?? vat ?? answers[0]
  return {
    source: lead.source,
    country_code: answers[0].country_code,
    state,
    status_vat: wl ? wl.status_vat : (vat?.status_vat ?? null),
    name: (first("name") as string | undefined) ?? "",
    address: (first("address") as string | undefined) ?? "",
    bank_accounts: wl?.bank_accounts ?? [],
    regon: (first("regon") as string | undefined) ?? null,
    krs: (first("krs") as string | undefined) ?? null,
    legal_form: (first("legal_form") as string | undefined) ?? null,
    activity: gus?.activity ?? null,
    details: gus?.details ?? null,
    demo: answers.every((a) => a.demo),
  }
}

export interface CheckRunOptions {
  /** Answer from the simulation whatever `live` says (a demo counterparty). */
  simulate?: boolean
  /** Reuse an answer of the last N milliseconds (the public preview). */
  cacheMs?: number
}

const cache = new Map<string, { at: number; result: RegistryResult }>()

/** Checks a number in every registry its kind and the options call for. */
export async function checkRegistries(value: string, options: ResolvedWhitelistOptions, run: CheckRunOptions = {}): Promise<RegistryResult> {
  const parsed = parseNumber(value)
  if (parsed.kind === "invalid") {
    const a = answer({ source: parsed.country === "PL" ? "whitelist" : "vies", country_code: parsed.country, state: "invalid" })
    return { card: a, answers: [a] }
  }

  const key = `${JSON.stringify([options.demo, options.live, options.plRegistries, options.gusEnvironment, run.simulate])}:${parsed.kind === "nip" ? parsed.nip : parsed.vat}`
  if (run.cacheMs) {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < run.cacheMs) return hit.result
  }

  /* Simulated when demo mode is on and the registry is not live, or for the demo's own sample numbers. */
  const simulated = (r: PlRegistry) => options.demo && (run.simulate === true || registryMode(options, r) === "demo" || isDemoSample(value))

  let tasks: Array<Promise<CheckAnswer>>
  if (parsed.kind === "vat") {
    tasks = [simulated("vies") ? Promise.resolve(demoAnswer(parsed.vat)) : checkVies(options, parsed.vat)]
  } else {
    const list: PlRegistry[] = [...options.plRegistries]
    /* A number typed with the PL prefix is a question about the VAT-UE registration too. */
    if (parsed.prefixed && !list.includes("vies")) list.push("vies")
    tasks = list
      .filter((r) => simulated(r) || registryMode(options, r) === "live" || (r === "vies" && parsed.prefixed))
      .map((r) => {
        if (r === "gus") return simulated(r) ? Promise.resolve(demoGusAnswer(parsed.nip)) : checkGusLive(options, parsed.nip)
        if (r === "whitelist") return simulated(r) ? Promise.resolve(demoAnswer(parsed.nip)) : checkWhitelist(options, parsed.nip)
        return simulated(r) ? Promise.resolve(demoAnswer(`PL${parsed.nip}`)) : checkVies(options, `PL${parsed.nip}`)
      })
  }

  const answers = await Promise.all(tasks)
  const result = { card: mergeAnswers(answers), answers }
  if (run.cacheMs) {
    if (cache.size > 5000) cache.clear()
    cache.set(key, { at: Date.now(), result })
  }
  return result
}

/** The connection test of a registry, for the settings. GUS logs in and out; VIES asks its status page. */
export async function testRegistry(registry: PlRegistry, options: ResolvedWhitelistOptions): Promise<{ ok: boolean; message: string; ms: number }> {
  const started = Date.now()
  const done = (ok: boolean, message: string) => ({ ok, message, ms: Date.now() - started })
  try {
    if (registry === "gus") {
      const key = gusKey(options)
      if (!key) return done(false, "missing_key")
      const r = await new GusClient({ key, environment: options.gusEnvironment, timeoutMs: options.timeoutMs }).test()
      return done(r.ok, r.message)
    }
    if (registry === "vies") {
      const r = await timed("https://ec.europa.eu/taxation_customs/vies/rest-api/check-status", { headers: { Accept: "application/json" } }, options.timeoutMs)
      if (!r.ok) return done(false, `HTTP ${r.status}`)
      const json = (await r.json()) as { vow?: { available?: boolean } }
      return done(json.vow?.available !== false, json.vow?.available === false ? "vies_down" : "vies_ok")
    }
    /* The whitelist has no status call and a daily search limit: the API root shows it answers. */
    const r = await timed(`${options.baseUrl}/`, { method: "GET" }, options.timeoutMs)
    return done(r.status < 500, r.status < 500 ? "whitelist_ok" : `HTTP ${r.status}`)
  } catch (e) {
    return done(false, e instanceof Error && e.name === "AbortError" ? "timeout" : "network")
  }
}

export { sourceOf }
