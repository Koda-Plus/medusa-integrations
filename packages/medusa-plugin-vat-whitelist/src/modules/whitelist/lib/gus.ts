/**
 * The GUS Business Registry (REGON), through BIR 1.1: a SOAP 1.2 service
 * with WS-Addressing headers whose answers come back as MTOM multipart and
 * carry the data as an XML string escaped inside the SOAP result.
 *
 * The flow of one lookup:
 *   1. Zaloguj (the user key) gives a session id, sent as the `sid` header.
 *   2. DaneSzukajPodmioty by NIP gives the base record: REGON, name, address,
 *      the type (P legal person, F natural person, LP and LF local units)
 *      and the silo of a natural person's activity.
 *   3. DanePobierzPelnyRaport by REGON gives the legal form, the KRS number
 *      and the dates (start, suspension, resumption, end).
 *
 * The session is kept and reused (GUS ends it after an hour without use);
 * an empty answer re-logs once. Every failure reads as unavailable.
 *
 * The parsing is pure (`parseBirResult`, `companyFromRecords`) so the tests
 * run on recorded answers without the network.
 */

export type GusEnvironment = "production" | "test"

export const GUS_ENDPOINTS: Record<GusEnvironment, string> = {
  production: "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc",
  test: "https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc",
}

/** The public key of the GUS test environment, from the GUS documentation. */
export const GUS_TEST_KEY = "abcde12345abcde12345"

/** The business state in the registry: running, suspended, or ended (or struck off). */
export type GusActivity = "active" | "suspended" | "closed"

export interface GusCompany {
  regon: string
  nip: string
  name: string
  address: string
  /** P, F, LP or LF. */
  type: string
  legal_form: string | null
  /** The legal form as GUS writes it (plural, upper case), kept for the record. */
  legal_form_raw: string | null
  krs: string | null
  activity: GusActivity
  started_at: string | null
  suspended_at: string | null
  ended_at: string | null
  register: string | null
}

export type GusLookup =
  | { state: "found"; company: GusCompany }
  | { state: "not_found" }
  | { state: "unavailable"; reason: string }

/* ------------------------------------------------------------------ */
/* Parsing (pure)                                                      */
/* ------------------------------------------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** The text of `<{action}Result>` in a SOAP answer, MTOM wrapping and all, decoded once. */
export function soapResult(body: string, action: string): string | null {
  const m = new RegExp(`<${action}Result>([\\s\\S]*?)</${action}Result>`).exec(body)
  if (m) return decodeEntities(m[1])
  if (new RegExp(`<${action}Result\\s*/>`).test(body)) return ""
  return null
}

/** The `<dane>` records of a decoded BIR result, as tag to text. Empty tags read as "". */
export function parseBirResult(xml: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const block of xml.matchAll(/<dane>([\s\S]*?)<\/dane>/g)) {
    const rec: Record<string, string> = {}
    for (const m of block[1].matchAll(/<([A-Za-z_][\w]*)>([\s\S]*?)<\/\1>|<([A-Za-z_][\w]*)\s*\/>/g)) {
      if (m[1]) rec[m[1]] = decodeEntities(m[2]).trim()
      else if (m[3]) rec[m[3]] = ""
    }
    out.push(rec)
  }
  return out
}

/*
 * GUS writes the legal form as the plural name of the class, in capitals
 * ("SPÓŁKI Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"). The common ones read as one
 * company; anything else keeps the GUS words in sentence case.
 */
const LEGAL_FORMS: Record<string, string> = {
  "SPÓŁKI Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ": "Spółka z ograniczoną odpowiedzialnością",
  "SPÓŁKI AKCYJNE": "Spółka akcyjna",
  "PROSTE SPÓŁKI AKCYJNE": "Prosta spółka akcyjna",
  "SPÓŁKI JAWNE": "Spółka jawna",
  "SPÓŁKI KOMANDYTOWE": "Spółka komandytowa",
  "SPÓŁKI KOMANDYTOWO-AKCYJNE": "Spółka komandytowo-akcyjna",
  "SPÓŁKI PARTNERSKIE": "Spółka partnerska",
  "SPÓŁKI CYWILNE PROWADZĄCE DZIAŁALNOŚĆ NA PODSTAWIE UMOWY ZAWARTEJ NA MOCY KODEKSU CYWILNEGO": "Spółka cywilna",
  "OSOBY FIZYCZNE PROWADZĄCE DZIAŁALNOŚĆ GOSPODARCZĄ": "Jednoosobowa działalność gospodarcza",
  "OSOBA FIZYCZNA PROWADZĄCA DZIAŁALNOŚĆ GOSPODARCZĄ": "Jednoosobowa działalność gospodarcza",
  "SPÓŁDZIELNIE": "Spółdzielnia",
  "FUNDACJE": "Fundacja",
  "STOWARZYSZENIA": "Stowarzyszenie",
  "PRZEDSIĘBIORSTWA PAŃSTWOWE": "Przedsiębiorstwo państwowe",
  "ODDZIAŁY ZAGRANICZNYCH PRZEDSIĘBIORCÓW": "Oddział zagranicznego przedsiębiorcy",
}

export function legalFormLabel(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim()
  if (!v) return null
  if (LEGAL_FORMS[v]) return LEGAL_FORMS[v]
  const lower = v.toLocaleLowerCase("pl-PL")
  return lower.charAt(0).toLocaleUpperCase("pl-PL") + lower.slice(1)
}

function postal(code: string): string {
  const d = code.replace(/\D/g, "")
  return d.length === 5 ? `${d.slice(0, 2)}-${d.slice(2)}` : code
}

/** "ul. Działoszyńska 20/23, 51-503 Wrocław", from the parts of a BIR record. */
export function formatAddress(p: { street?: string; building?: string; unit?: string; postcode?: string; city?: string; postCity?: string }): string {
  const number = [p.building, p.unit].filter(Boolean).join("/")
  const city = p.city || p.postCity || ""
  const street = p.street ? `${p.street} ${number}`.trim() : city && number ? `${city} ${number}` : number
  const town = [p.postcode ? postal(p.postcode) : "", p.postCity && p.postCity !== city ? p.postCity : city].filter(Boolean).join(" ")
  return [street, town].filter(Boolean).join(", ")
}

/** The business state from the report dates: ended or struck off, suspended and not resumed, or running. */
export function activityOf(d: { ended?: string; struckOff?: string; suspended?: string; resumed?: string }): GusActivity {
  if (d.ended || d.struckOff) return "closed"
  if (d.suspended && (!d.resumed || d.resumed < d.suspended)) return "suspended"
  return "active"
}

/** The report a REGON record needs for its legal form and dates. */
export function reportsFor(rec: Record<string, string>): string[] {
  const type = rec.Typ ?? ""
  if (type === "P") return ["BIR11OsPrawna"]
  if (type === "LP") return ["BIR11JednLokalnaOsPrawnej"]
  if (type === "LF") return ["BIR11JednLokalnaOsFizycznej"]
  if (type === "F") {
    const silo: Record<string, string> = {
      "1": "BIR11OsFizycznaDzialalnoscCeidg",
      "2": "BIR11OsFizycznaDzialalnoscRolnicza",
      "3": "BIR11OsFizycznaDzialalnoscPozostala",
      "4": "BIR11OsFizycznaDzialalnoscSkreslonaDo20141108",
    }
    return ["BIR11OsFizycznaDaneOgolne", ...(silo[rec.SilosID ?? ""] ? [silo[rec.SilosID ?? ""]] : [])]
  }
  return []
}

/**
 * The company card from the search record and the full reports. A NIP can
 * return several records (a closed business and a new one, a company and
 * its local units): the running main unit wins.
 */
export function pickRecord(records: Record<string, string>[]): Record<string, string> | null {
  const rows = records.filter((r) => r.Regon)
  if (rows.length === 0) return null
  const main = (r: Record<string, string>) => r.Typ === "P" || r.Typ === "F"
  return rows.find((r) => main(r) && !r.DataZakonczeniaDzialalnosci) ?? rows.find((r) => !r.DataZakonczeniaDzialalnosci) ?? rows[0]
}

export function companyFromRecords(search: Record<string, string>, report: Record<string, string>): GusCompany {
  /* P reports use the praw_ prefix, F the fiz_ prefix (fizC_ for the CEIDG register), local units lokpraw_ and lokfiz_. */
  const get = (...keys: string[]) => {
    for (const k of keys) {
      for (const prefix of ["praw_", "fiz_", "lokpraw_", "lokfiz_", "fizC_", "fizR_", "fizP_"]) {
        const v = report[prefix + k]
        if (v) return v
      }
    }
    return ""
  }
  const legalRaw = get("szczegolnaFormaPrawna_Nazwa") || get("podstawowaFormaPrawna_Nazwa") || null
  const registerName = get("rodzajRejestruEwidencji_Nazwa", "RodzajRejestru_Nazwa") || null
  const registerNumber = get("numerWRejestrzeEwidencji", "NumerWRejestrzeEwidencji")
  const organ = get("organRejestrowy_Nazwa", "OrganRejestrowy_Nazwa")
  /* The KRS number: a 10-digit entry number in a register kept by a KRS court. */
  const krs = /^\d{10}$/.test(registerNumber) && /KRAJOWEGO REJESTRU SĄDOWEGO|REJESTR PRZEDSIĘBIORCÓW|REJESTR STOWARZYSZEŃ/i.test(`${organ} ${registerName ?? ""}`) ? registerNumber : null
  const dates = {
    started: get("dataRozpoczeciaDzialalnosci") || get("dataPowstania"),
    suspended: get("dataZawieszeniaDzialalnosci"),
    resumed: get("dataWznowieniaDzialalnosci"),
    ended: get("dataZakonczeniaDzialalnosci") || search.DataZakonczeniaDzialalnosci || "",
    struckOff: get("dataSkresleniaZRegon", "dataSkresleniaDzialalnosciZRegon"),
  }
  return {
    regon: search.Regon,
    nip: search.Nip ?? "",
    name: get("nazwa") || search.Nazwa || "",
    address: formatAddress({
      street: search.Ulica,
      building: search.NrNieruchomosci,
      unit: search.NrLokalu,
      postcode: search.KodPocztowy,
      city: search.Miejscowosc,
      postCity: search.MiejscowoscPoczty,
    }),
    type: search.Typ ?? "",
    legal_form: legalFormLabel(legalRaw),
    legal_form_raw: legalRaw,
    krs,
    activity: activityOf(dates),
    started_at: dates.started || null,
    suspended_at: dates.suspended && (!dates.resumed || dates.resumed < dates.suspended) ? dates.suspended : null,
    ended_at: dates.ended || dates.struckOff || null,
    register: registerName,
  }
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

const NS = "http://CIS/BIR/PUBL/2014/07"
const ACTION = `${NS}/IUslugaBIRzewnPubl/`

function envelope(endpoint: string, action: string, body: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${NS}" xmlns:dat="${NS}/DataContract">` +
    `<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:To>${endpoint}</wsa:To><wsa:Action>${action}</wsa:Action></soap:Header>` +
    `<soap:Body>${body}</soap:Body></soap:Envelope>`
  )
}

const xmlText = (v: string) => v.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface GusClientOptions {
  key: string
  environment: GusEnvironment
  timeoutMs: number
  /** For the tests: the transport. Default: global fetch. */
  fetch?: typeof fetch
}

interface Session {
  sid: string
  at: number
}

/* One session per key and environment, shared by every lookup of the process. */
const sessions = new Map<string, Session>()
const SESSION_MS = 45 * 60 * 1000

export class GusClient {
  private readonly o: GusClientOptions
  private readonly endpoint: string
  private readonly f: typeof fetch

  /* No parameter properties: the tests run this file in Node's strip-only TypeScript mode. */
  constructor(o: GusClientOptions) {
    this.o = o
    this.endpoint = GUS_ENDPOINTS[o.environment]
    this.f = o.fetch ?? fetch
  }

  private async call(action: string, body: string, sid?: string): Promise<string> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs)
    try {
      const r = await this.f(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/soap+xml; charset=utf-8", ...(sid ? { sid } : {}) },
        body: envelope(this.endpoint, action, body),
        signal: ctrl.signal,
      })
      const text = await r.text()
      if (!r.ok) throw new Error(`GUS HTTP ${r.status}`)
      return text
    } finally {
      clearTimeout(timer)
    }
  }

  private get cacheKey(): string {
    return `${this.o.environment}:${this.o.key}`
  }

  /** Logs in and returns the session id. Throws when the key is refused (an empty id). */
  async login(): Promise<string> {
    const text = await this.call(ACTION + "Zaloguj", `<ns:Zaloguj><ns:pKluczUzytkownika>${xmlText(this.o.key)}</ns:pKluczUzytkownika></ns:Zaloguj>`)
    const sid = (soapResult(text, "Zaloguj") ?? "").trim()
    if (!sid) throw new Error("GUS refused the key")
    sessions.set(this.cacheKey, { sid, at: Date.now() })
    return sid
  }

  private async session(fresh = false): Promise<string> {
    const s = sessions.get(this.cacheKey)
    if (!fresh && s && Date.now() - s.at < SESSION_MS) {
      s.at = Date.now()
      return s.sid
    }
    return this.login()
  }

  async logout(sid: string): Promise<void> {
    await this.call(ACTION + "Wyloguj", `<ns:Wyloguj><ns:pIdentyfikatorSesji>${xmlText(sid)}</ns:pIdentyfikatorSesji></ns:Wyloguj>`, sid).catch(() => undefined)
    if (sessions.get(this.cacheKey)?.sid === sid) sessions.delete(this.cacheKey)
  }

  /** A raw value of the service (StatusSesji, KomunikatKod, StatusUslugi). */
  async getValue(name: string, sid?: string): Promise<string | null> {
    const text = await this.call("http://CIS/BIR/2014/07/IUslugaBIR/GetValue", `<GetValue xmlns="http://CIS/BIR/2014/07"><pNazwaParametru>${xmlText(name)}</pNazwaParametru></GetValue>`, sid)
    return soapResult(text, "GetValue")
  }

  private async search(nip: string, sid: string): Promise<string | null> {
    const text = await this.call(
      ACTION + "DaneSzukajPodmioty",
      `<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>${xmlText(nip)}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`,
      sid,
    )
    return soapResult(text, "DaneSzukajPodmioty")
  }

  private async report(regon: string, name: string, sid: string): Promise<Record<string, string>> {
    const text = await this.call(
      ACTION + "DanePobierzPelnyRaport",
      `<ns:DanePobierzPelnyRaport><ns:pRegon>${xmlText(regon)}</ns:pRegon><ns:pNazwaRaportu>${xmlText(name)}</ns:pNazwaRaportu></ns:DanePobierzPelnyRaport>`,
      sid,
    )
    return parseBirResult(soapResult(text, "DanePobierzPelnyRaport") ?? "")[0] ?? {}
  }

  /** One lookup by NIP: the search, then the reports of the chosen record. */
  async lookup(nip: string): Promise<GusLookup> {
    try {
      let sid = await this.session()
      let xml = await this.search(nip, sid)
      /* An expired session answers with an empty result and no error code: log in again once. */
      if (!xml) {
        sid = await this.session(true)
        xml = await this.search(nip, sid)
      }
      const records = parseBirResult(xml ?? "")
      if (records.some((r) => r.ErrorCode === "4")) return { state: "not_found" }
      const err = records.find((r) => r.ErrorCode)
      if (err) return { state: "unavailable", reason: err.ErrorMessageEn || `GUS error ${err.ErrorCode}` }
      const rec = pickRecord(records)
      if (!rec) return { state: "unavailable", reason: "empty answer" }
      const report: Record<string, string> = {}
      for (const name of reportsFor(rec)) Object.assign(report, await this.report(rec.Regon, name, sid))
      return { state: "found", company: companyFromRecords(rec, report) }
    } catch (e) {
      return { state: "unavailable", reason: e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e) }
    }
  }

  /** The connection test of the settings: log in, read the session status, log out. Spends no lookup. */
  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const sid = await this.login()
      const status = await this.getValue("StatusSesji", sid)
      await this.logout(sid)
      return status === "1" ? { ok: true, message: "session_ok" } : { ok: false, message: `session_status_${status ?? "none"}` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e) }
    }
  }
}
