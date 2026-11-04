import { test } from "node:test"
import assert from "node:assert/strict"
import { checkRegistries, isDemoSample, mergeAnswers, parseNumber, withCountry, type CheckAnswer } from "../src/modules/whitelist/lib/check.ts"
import { gusKey, registryMode, resolveOptions } from "../src/modules/whitelist/lib/options.ts"

const a = (p: Partial<CheckAnswer> & Pick<CheckAnswer, "source" | "state">): CheckAnswer => ({
  country_code: "PL",
  status_vat: null,
  name: "",
  address: "",
  bank_accounts: [],
  regon: null,
  krs: null,
  legal_form: null,
  activity: null,
  details: null,
  demo: false,
  ...p,
})

test("registries: a number reads as a NIP (with or without PL), an EU VAT number or nothing", () => {
  assert.deepEqual(parseNumber("895-230-52-60"), { kind: "nip", nip: "8952305260", prefixed: false })
  assert.deepEqual(parseNumber("PL 895 230 52 60"), { kind: "nip", nip: "8952305260", prefixed: true })
  assert.deepEqual(parseNumber("de260543043"), { kind: "vat", vat: "DE260543043", country: "DE" })
  assert.deepEqual(parseNumber("GR123456789"), { kind: "vat", vat: "EL123456789", country: "GR" })
  assert.equal(parseNumber("1234567890").kind, "invalid")
  assert.equal(parseNumber("PL1234567890").kind, "invalid")
  assert.equal(parseNumber("hello").kind, "invalid")
})

test("registries: a store form per country adds the prefix a number came without", () => {
  assert.equal(withCountry("260543043", "DE"), "DE260543043")
  assert.equal(withCountry("DE260543043", "DE"), "DE260543043")
  assert.equal(withCountry("8952305260", "PL"), "8952305260")
  assert.equal(withCountry("123456789", "gr"), "EL123456789")
  assert.equal(withCountry("8952305260", null), "8952305260")
  assert.equal(withCountry("8952305260", "nonsense"), "8952305260")
})

test("registries: the card takes the company from GUS and the VAT status from the whitelist", () => {
  const card = mergeAnswers([
    a({ source: "gus", state: "active", name: "KODA PLUS SP. Z O.O.", address: "ul. Działoszyńska 20/23, 51-503 Wrocław", regon: "544999057", krs: "0001247407", legal_form: "Spółka z ograniczoną odpowiedzialnością", activity: "active" }),
    a({ source: "whitelist", state: "active", status_vat: "Czynny", name: "KODA PLUS", bank_accounts: ["64109025900000000167236157"] }),
  ])
  assert.equal(card.source, "gus")
  assert.equal(card.state, "active")
  assert.equal(card.name, "KODA PLUS SP. Z O.O.")
  assert.equal(card.status_vat, "Czynny")
  assert.deepEqual(card.bank_accounts, ["64109025900000000167236157"])
  assert.equal(card.legal_form, "Spółka z ograniczoną odpowiedzialnością")
  assert.equal(card.activity, "active")
})

test("registries: a closed business is inactive whatever the whitelist says", () => {
  const card = mergeAnswers([a({ source: "gus", state: "inactive", name: "PAWLIK ZBIGNIEW", activity: "closed" }), a({ source: "whitelist", state: "not_found" })])
  assert.equal(card.state, "inactive")
  assert.equal(card.name, "PAWLIK ZBIGNIEW")
})

test("registries: a company GUS knows but the whitelist does not is not a VAT payer", () => {
  const card = mergeAnswers([a({ source: "gus", state: "active", name: "Fundacja", activity: "active" }), a({ source: "whitelist", state: "not_found" })])
  assert.equal(card.state, "not_found")
  assert.equal(card.name, "Fundacja")
})

test("registries: the whitelist down keeps the GUS card and reads unavailable", () => {
  const card = mergeAnswers([a({ source: "gus", state: "active", name: "Firma", activity: "active" }), a({ source: "whitelist", state: "unavailable" })])
  assert.equal(card.state, "unavailable")
  assert.equal(card.name, "Firma")
})

test("registries: GUS alone speaks for the state, VIES for an EU number", () => {
  assert.equal(mergeAnswers([a({ source: "gus", state: "active", activity: "active" })]).state, "active")
  assert.equal(mergeAnswers([a({ source: "gus", state: "not_found" }), a({ source: "whitelist", state: "unavailable" })]).state, "not_found")
  assert.equal(mergeAnswers([a({ source: "vies", country_code: "DE", state: "active", status_vat: "VAT-UE" })]).country_code, "DE")
  assert.equal(mergeAnswers([a({ source: "whitelist", state: "invalid" })]).state, "invalid")
  assert.equal(mergeAnswers([]).state, "unavailable")
})

test("options: registries, live list, GUS environment and timeout resolve safely", () => {
  const d = resolveOptions({})
  assert.deepEqual(d.plRegistries, ["gus", "whitelist"])
  assert.deepEqual(d.live, [])
  assert.equal(d.gusEnvironment, "production")
  assert.equal(d.timeoutMs, 8000)
  assert.deepEqual(resolveOptions({ plRegistries: "whitelist, vies, nonsense, vies" }).plRegistries, ["whitelist", "vies"])
  assert.deepEqual(resolveOptions({ plRegistries: [] }).plRegistries, ["gus", "whitelist"])
  assert.deepEqual(resolveOptions({ live: "gus,whitelist" }).live, ["gus", "whitelist"])
  assert.equal(resolveOptions({ gusEnvironment: "test" }).gusEnvironment, "test")
  assert.equal(resolveOptions({ gusEnvironment: "staging" }).gusEnvironment, "production")
  assert.equal(resolveOptions({ timeoutMs: "50" }).timeoutMs, 1000)
  assert.equal(resolveOptions({ timeoutMs: "nonsense" }).timeoutMs, 8000)
})

test("options: how each registry answers", () => {
  assert.equal(registryMode(resolveOptions({}), "gus"), "missing_key")
  assert.equal(registryMode(resolveOptions({ gusApiKey: "k" }), "gus"), "live")
  assert.equal(registryMode(resolveOptions({ gusEnvironment: "test" }), "gus"), "live")
  assert.equal(gusKey(resolveOptions({ gusEnvironment: "test" })), "abcde12345abcde12345")
  assert.equal(registryMode(resolveOptions({ demo: true, gusApiKey: "k" }), "gus"), "demo")
  assert.equal(registryMode(resolveOptions({ demo: true, live: "gus", gusApiKey: "k" }), "gus"), "live")
  assert.equal(registryMode(resolveOptions({ plRegistries: "whitelist" }), "gus"), "off")
  assert.equal(registryMode(resolveOptions({}), "whitelist"), "live")
  assert.equal(registryMode(resolveOptions({}), "vies"), "live")
})

test("registries: demo mode answers from the simulation, without the network", async () => {
  const o = resolveOptions({ demo: true })
  const r = await checkRegistries("1234563218", o)
  assert.deepEqual(r.answers.map((x) => x.source), ["gus", "whitelist"])
  assert.equal(r.card.state, "active")
  assert.equal(r.card.name, "Hurtownia Demo Sp. z o.o.")
  assert.equal(r.card.demo, true)
  const eu = await checkRegistries("DE123456789", o)
  assert.equal(eu.card.state, "active")
  assert.equal(eu.card.source, "vies")
  const pl = await checkRegistries("PL1234563218", o)
  assert.deepEqual(pl.answers.map((x) => x.source), ["gus", "whitelist", "vies"])
})

test("registries: the demo samples stay simulated with live registries", async () => {
  assert.equal(isDemoSample("1234563218"), true)
  assert.equal(isDemoSample("PL1234563218"), true)
  assert.equal(isDemoSample("DE123456789"), true)
  assert.equal(isDemoSample("8952305260"), false)
  const o = resolveOptions({ demo: true, live: "gus,whitelist,vies", gusApiKey: "k" })
  const r = await checkRegistries("1234563218", o)
  assert.ok(r.answers.every((x) => x.demo))
  /* A demo counterparty (seeded data) is simulated too, whatever the number. */
  const seeded = await checkRegistries("8952305260", o, { simulate: true })
  assert.ok(seeded.answers.every((x) => x.demo))
})

test("registries: without a GUS key real mode skips GUS, an invalid number asks nobody", async () => {
  const invalid = await checkRegistries("1234567890", resolveOptions({}))
  assert.equal(invalid.card.state, "invalid")
  assert.equal(invalid.answers.length, 1)
})
