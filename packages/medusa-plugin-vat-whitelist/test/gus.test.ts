import { test } from "node:test"
import assert from "node:assert/strict"
import { GusClient, activityOf, companyFromRecords, formatAddress, legalFormLabel, parseBirResult, pickRecord, reportsFor, soapResult } from "../src/modules/whitelist/lib/gus.ts"

/*
 * Answers recorded from the BIR 1.1 production service (02.11.2026), for
 * the public registry entry of Koda Plus sp. z o.o.: MTOM multipart, the
 * data escaped inside the SOAP result, CR entities between the lines.
 */
const esc = (xml: string) => xml.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#xD;\n")
const mtom = (action: string, inner: string) =>
  `\r\n--uuid:1+id=1\r\nContent-ID: <http://tempuri.org/0>\r\nContent-Transfer-Encoding: 8bit\r\nContent-Type: application/xop+xml;charset=utf-8;type="application/soap+xml"\r\n\r\n` +
  `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><${action}Response xmlns="http://CIS/BIR/PUBL/2014/07"><${action}Result>${inner}</${action}Result></${action}Response></s:Body></s:Envelope>\r\n--uuid:1+id=1--\r\n`

const SEARCH = `<root>
  <dane>
    <Regon>544999057</Regon>
    <Nip>8952305260</Nip>
    <StatusNip />
    <Nazwa>KODA PLUS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ</Nazwa>
    <Wojewodztwo>DOLNOŚLĄSKIE</Wojewodztwo>
    <Powiat>Wrocław</Powiat>
    <Gmina>Wrocław-Psie Pole</Gmina>
    <Miejscowosc>Wrocław</Miejscowosc>
    <KodPocztowy>51-503</KodPocztowy>
    <Ulica>ul. Działoszyńska</Ulica>
    <NrNieruchomosci>20</NrNieruchomosci>
    <NrLokalu>23</NrLokalu>
    <Typ>P</Typ>
    <SilosID>6</SilosID>
    <DataZakonczeniaDzialalnosci />
    <MiejscowoscPoczty />
  </dane>
</root>`

const REPORT = `<root>
  <dane>
    <praw_regon9>544999057</praw_regon9>
    <praw_nip>8952305260</praw_nip>
    <praw_nazwa>KODA PLUS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ</praw_nazwa>
    <praw_numerWRejestrzeEwidencji>0001247407</praw_numerWRejestrzeEwidencji>
    <praw_dataPowstania>2026-06-11</praw_dataPowstania>
    <praw_dataRozpoczeciaDzialalnosci>2026-06-11</praw_dataRozpoczeciaDzialalnosci>
    <praw_dataZawieszeniaDzialalnosci />
    <praw_dataWznowieniaDzialalnosci />
    <praw_dataZakonczeniaDzialalnosci />
    <praw_dataSkresleniaZRegon />
    <praw_podstawowaFormaPrawna_Nazwa>OSOBA PRAWNA</praw_podstawowaFormaPrawna_Nazwa>
    <praw_szczegolnaFormaPrawna_Nazwa>SPÓŁKI Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ</praw_szczegolnaFormaPrawna_Nazwa>
    <praw_organRejestrowy_Nazwa>SĄD REJONOWY DLA WROCŁAWIA FABRYCZNEJ WE WROCŁAWIU, VI WYDZIAŁ GOSPODARCZY KRAJOWEGO REJESTRU SĄDOWEGO</praw_organRejestrowy_Nazwa>
    <praw_rodzajRejestruEwidencji_Nazwa>REJESTR PRZEDSIĘBIORCÓW</praw_rodzajRejestruEwidencji_Nazwa>
  </dane>
</root>`

const NOT_FOUND = `<root>
  <dane>
    <ErrorCode>4</ErrorCode>
    <ErrorMessagePl>Nie znaleziono podmiotu dla podanych kryteriów wyszukiwania.</ErrorMessagePl>
    <ErrorMessageEn>No data found for the specified search criteria.</ErrorMessageEn>
    <Nip>1111111111</Nip>
  </dane>
</root>`

test("gus: the SOAP result is found inside the MTOM parts and decoded once", () => {
  const body = mtom("DaneSzukajPodmioty", esc(SEARCH))
  const xml = soapResult(body, "DaneSzukajPodmioty")
  assert.ok(xml && xml.includes("<Regon>544999057</Regon>"))
  assert.equal(soapResult(mtom("Zaloguj", "abc123"), "Zaloguj"), "abc123")
  assert.equal(soapResult("<x><ZalogujResult/></x>", "Zaloguj"), "")
  assert.equal(soapResult("<x/>", "Zaloguj"), null)
})

test("gus: the records read tag by tag, empty tags as empty strings", () => {
  const [rec] = parseBirResult(SEARCH)
  assert.equal(rec.Regon, "544999057")
  assert.equal(rec.Nazwa, "KODA PLUS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ")
  assert.equal(rec.StatusNip, "")
  assert.equal(rec.Typ, "P")
  assert.deepEqual(parseBirResult(""), [])
  assert.equal(parseBirResult(NOT_FOUND)[0].ErrorCode, "4")
})

test("gus: the company card from the search record and the legal person report", () => {
  const c = companyFromRecords(parseBirResult(SEARCH)[0], parseBirResult(REPORT)[0])
  assert.equal(c.name, "KODA PLUS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ")
  assert.equal(c.address, "ul. Działoszyńska 20/23, 51-503 Wrocław")
  assert.equal(c.regon, "544999057")
  assert.equal(c.krs, "0001247407")
  assert.equal(c.legal_form, "Spółka z ograniczoną odpowiedzialnością")
  assert.equal(c.activity, "active")
  assert.equal(c.started_at, "2026-06-11")
  assert.equal(c.ended_at, null)
})

test("gus: the legal forms read as one company, unknown ones in sentence case", () => {
  assert.equal(legalFormLabel("SPÓŁKI AKCYJNE"), "Spółka akcyjna")
  assert.equal(legalFormLabel("OSOBY FIZYCZNE PROWADZĄCE DZIAŁALNOŚĆ GOSPODARCZĄ"), "Jednoosobowa działalność gospodarcza")
  assert.equal(legalFormLabel("ZWIĄZKI ZAWODOWE"), "Związki zawodowe")
  assert.equal(legalFormLabel(""), null)
  assert.equal(legalFormLabel(null), null)
})

test("gus: the address reads like a Polish envelope, with or without a street", () => {
  assert.equal(formatAddress({ street: "ul. Spiżowa", building: "3", unit: "1", postcode: "53442", city: "Wrocław" }), "ul. Spiżowa 3/1, 53-442 Wrocław")
  assert.equal(formatAddress({ building: "41", postcode: "98-310", city: "Czarnożyły" }), "Czarnożyły 41, 98-310 Czarnożyły")
  assert.equal(formatAddress({ building: "7", postcode: "00-001", city: "Wieś", postCity: "Miasto" }), "Wieś 7, 00-001 Miasto")
})

test("gus: the business state from the dates", () => {
  assert.equal(activityOf({}), "active")
  assert.equal(activityOf({ ended: "2008-04-30" }), "closed")
  assert.equal(activityOf({ struckOff: "2010-01-01" }), "closed")
  assert.equal(activityOf({ suspended: "2009-06-22" }), "suspended")
  assert.equal(activityOf({ suspended: "2009-06-22", resumed: "2011-06-22" }), "active")
  assert.equal(activityOf({ suspended: "2012-01-01", resumed: "2011-06-22" }), "suspended")
})

test("gus: the running main unit wins, and each type asks its own report", () => {
  const closed = { Regon: "1", Typ: "F", DataZakonczeniaDzialalnosci: "2001-01-01" }
  const running = { Regon: "2", Typ: "F", DataZakonczeniaDzialalnosci: "" }
  const local = { Regon: "3", Typ: "LF", DataZakonczeniaDzialalnosci: "" }
  assert.equal(pickRecord([closed, local, running])?.Regon, "2")
  assert.equal(pickRecord([closed])?.Regon, "1")
  assert.equal(pickRecord([{ ErrorCode: "4" }]), null)
  assert.deepEqual(reportsFor({ Typ: "P" }), ["BIR11OsPrawna"])
  assert.deepEqual(reportsFor({ Typ: "F", SilosID: "1" }), ["BIR11OsFizycznaDaneOgolne", "BIR11OsFizycznaDzialalnoscCeidg"])
  assert.deepEqual(reportsFor({ Typ: "F", SilosID: "9" }), ["BIR11OsFizycznaDaneOgolne"])
})

/** A fake BIR service: answers by the SOAP action in the WS-Addressing header. */
function fakeBir(opts: { sid?: string; expireFirst?: boolean; search?: string; slow?: boolean } = {}) {
  const calls: string[] = []
  let expired = Boolean(opts.expireFirst)
  const f = (async (_url: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? "")
    const action = /<wsa:Action>[^<]*\/(\w+)<\/wsa:Action>/.exec(body)?.[1] ?? "?"
    calls.push(action)
    if (opts.slow) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 2000)
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t)
          const e = new Error("aborted")
          e.name = "AbortError"
          reject(e)
        })
      })
    }
    const ok = (inner: string) => new Response(mtom(action, inner), { status: 200 })
    if (action === "Zaloguj") return ok(opts.sid ?? "sid1")
    if (action === "DaneSzukajPodmioty") {
      if (expired) {
        expired = false
        return ok("")
      }
      return ok(esc(opts.search ?? SEARCH))
    }
    if (action === "DanePobierzPelnyRaport") return ok(esc(REPORT))
    if (action === "GetValue") return ok("1")
    if (action === "Wyloguj") return ok("true")
    return new Response("", { status: 500 })
  }) as typeof fetch
  return { f, calls }
}

test("gus: a lookup logs in once, searches, reads the report and reuses the session", async () => {
  const bir = fakeBir()
  const client = new GusClient({ key: "k-reuse", environment: "test", timeoutMs: 1000, fetch: bir.f })
  const r = await client.lookup("8952305260")
  assert.equal(r.state, "found")
  if (r.state === "found") assert.equal(r.company.krs, "0001247407")
  await client.lookup("8952305260")
  assert.deepEqual(bir.calls, ["Zaloguj", "DaneSzukajPodmioty", "DanePobierzPelnyRaport", "DaneSzukajPodmioty", "DanePobierzPelnyRaport"])
})

test("gus: an expired session answers empty and the lookup logs in again once", async () => {
  const bir = fakeBir({ expireFirst: true })
  const client = new GusClient({ key: "k-expired", environment: "test", timeoutMs: 1000, fetch: bir.f })
  const r = await client.lookup("8952305260")
  assert.equal(r.state, "found")
  assert.deepEqual(bir.calls.slice(0, 4), ["Zaloguj", "DaneSzukajPodmioty", "Zaloguj", "DaneSzukajPodmioty"])
})

test("gus: error code 4 reads not found, a slow service unavailable", async () => {
  const missing = await new GusClient({ key: "k-missing", environment: "test", timeoutMs: 1000, fetch: fakeBir({ search: NOT_FOUND }).f }).lookup("1111111111")
  assert.equal(missing.state, "not_found")
  const slow = await new GusClient({ key: "k-slow", environment: "test", timeoutMs: 50, fetch: fakeBir({ slow: true }).f }).lookup("8952305260")
  assert.equal(slow.state, "unavailable")
  if (slow.state === "unavailable") assert.equal(slow.reason, "timeout")
})

test("gus: the connection test logs in, reads the session status and logs out", async () => {
  const bir = fakeBir()
  const r = await new GusClient({ key: "k-test", environment: "test", timeoutMs: 1000, fetch: bir.f }).test()
  assert.deepEqual(r, { ok: true, message: "session_ok" })
  assert.deepEqual(bir.calls, ["Zaloguj", "GetValue", "Wyloguj"])
  const refused = await new GusClient({ key: "k-bad", environment: "test", timeoutMs: 1000, fetch: fakeBir({ sid: "" }).f }).test()
  assert.equal(refused.ok, false)
})
