/**
 * The sender and the orderer against the strictest DPD limits (the
 * DPDServices OpenAPI 5.27.0: Sender and Orderer of the courier order,
 * GenerateReturnLabelSenderOrReceiver of the return label), with problem
 * codes instead of errors.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/dpd/lib/options.ts"
import {
  ORDERER_LIMITS,
  SENDER_LIMITS,
  isEmail,
  normalizePhone,
  normalizePostalCode,
  resolveOrderer,
  resolveSender,
  senderFor,
  senderProblems,
  validateOrderer,
  validateSender,
} from "../src/modules/dpd/lib/sender.ts"
import { SANDBOX } from "./helpers.ts"

const GOOD = { company: "Koda Supply", name: "Anna Nowak", phone: "000000001", email: "shop@example.com", street: "ul. Przykładowa 5", city: "Warszawa", postalCode: "00-950" }

const codes = (s: ReturnType<typeof validateSender>) => s.map((p) => `${p.path} ${p.code}${p.max ? ` ${p.max}` : ""}`)

/*
 * maxLength in the DPDServices OpenAPI 5.27.0 (components.schemas):
 *   GenerateReturnLabelSenderOrReceiver  company 50, name 30, address 30, city 35, phone 30, email 100
 *   SenderOrReceiver                     company 100, name 100, address 100, city 50, phone 100, email 100
 *   Sender (courier order)               name 100, fullName 100, address 100, city 50, postalCode 4 to 5, phone 20
 *   Orderer (courier order)              name 100, fullName 100, phone 20
 */
const SPEC_MAX = {
  company: [50, 100, 100],
  name: [30, 100, 100],
  street: [30, 100, 100],
  city: [35, 50, 50],
  phone: [30, 100, 20],
  email: [100, 100],
} as const

test("the limits are the strictest of the DPD schemas", () => {
  for (const [field, limits] of Object.entries(SPEC_MAX)) assert.equal(SENDER_LIMITS[field as keyof typeof SENDER_LIMITS], Math.min(...limits), field)
  assert.deepEqual(ORDERER_LIMITS, { name: 100, fullName: 100, phone: 20 })
})

test("phone, postal code and e-mail are normalized the way DPD takes them", () => {
  assert.equal(normalizePhone("+48 000 000 001"), "000000001")
  assert.equal(normalizePhone("0048 000-000-001"), "000000001")
  assert.equal(normalizePhone("(00) 000 00 01"), "000000001")
  assert.equal(normalizePhone("+49 30 1234567"), "+49301234567")
  assert.equal(normalizePhone("12345"), null)
  assert.equal(normalizePhone("0000000012"), null, "ten digits without a country code is not a Polish number")
  assert.equal(normalizePhone("301234567", "DE"), "301234567")
  assert.equal(normalizePhone(""), null)
  assert.equal(normalizePostalCode("00-950"), "00950")
  assert.equal(normalizePostalCode(" 00950 "), "00950")
  assert.equal(normalizePostalCode("123"), "123", "kept as typed, reported as invalid")
  assert.equal(normalizePostalCode("1234 ab", "NL"), "1234AB")
  assert.equal(isEmail("shop@example.com"), true)
  assert.equal(isEmail("shop@example"), false)
})

test("a sender that fits has no problems; each limit has its own code", () => {
  assert.deepEqual(validateSender(resolveSender(GOOD)), [])
  assert.deepEqual(validateSender(resolveSender({ ...GOOD, name: "", email: "" })), [], "a company alone is enough, the e-mail is optional")
  const long = resolveSender({ ...GOOD, company: "C".repeat(51), name: "N".repeat(31), street: "S".repeat(31), city: "M".repeat(36), email: `${"e".repeat(95)}@example.com` })
  assert.deepEqual(codes(validateSender(long)), [
    "sender.company too_long 50",
    "sender.name too_long 30",
    "sender.street too_long 30",
    "sender.city too_long 35",
    "sender.email too_long 100",
  ])
  assert.equal(long.street, "S".repeat(31), "never cut: a person fixes it")
  assert.deepEqual(codes(validateSender(resolveSender({ city: "Warszawa" }))), [
    "sender.company required",
    "sender.street required",
    "sender.postalCode required",
    "sender.phone required",
  ])
  assert.deepEqual(codes(validateSender(resolveSender({ ...GOOD, postalCode: "1234", phone: "12", email: "nope" }))), [
    "sender.postalCode invalid",
    "sender.phone invalid",
    "sender.email invalid",
  ])
  assert.deepEqual(codes(validateSender(resolveSender({ ...GOOD, countryCode: "de", postalCode: "10115", phone: "+49 30 1234567" }))), ["sender.countryCode not_polish"], "a courier order needs a sender in Poland")
  assert.deepEqual(codes(validateSender(resolveSender({ ...GOOD, countryCode: "Poland" }))), ["sender.countryCode invalid"])
})

test("the orderer falls back to the sender, field by field", () => {
  const sender = resolveSender(GOOD)
  assert.deepEqual(resolveOrderer({}, sender), { name: "Koda Supply", fullName: "Anna Nowak", phone: "000000001" })
  assert.deepEqual(resolveOrderer({ fullName: "Jan Kowalski", phone: "+48 000 000 009" }, sender), { name: "Koda Supply", fullName: "Jan Kowalski", phone: "000000009" })
  assert.deepEqual(validateOrderer(resolveOrderer({}, sender)), [])
  assert.deepEqual(codes(validateOrderer(resolveOrderer({ name: "N".repeat(101) }, resolveSender({})))), ["orderer.name too_long 100", "orderer.fullName required", "orderer.phone required"])
})

test("sender problems of the options: missing outside demo, the senders per location, the sender of a location", () => {
  assert.deepEqual(senderProblems(resolveOptions(SANDBOX)), [])
  assert.deepEqual(senderProblems(resolveOptions({})), [{ code: "missing", path: "sender" }])
  assert.deepEqual(senderProblems(resolveOptions({ demo: true })), [], "demo mode uses a sample sender")
  const o = resolveOptions({ ...SANDBOX, senders: { sloc_01: { ...GOOD, city: "" }, sloc_02: { ...GOOD, company: "Magazyn 2" } } })
  assert.deepEqual(codes(senderProblems(o)), ["senders.sloc_01.city required"])
  assert.equal(senderFor(o, "sloc_02").company, "Magazyn 2")
  assert.equal(senderFor(o, "sloc_99").company, "Koda Supply")
  assert.equal(senderFor(o, null).company, "Koda Supply")
})
