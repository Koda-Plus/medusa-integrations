import { test } from "node:test"
import assert from "node:assert/strict"
import { planRetry, retryDelaySeconds } from "../src/modules/fakturownia/lib/backoff.ts"
import { BACKOFF_SECONDS, MAX_ATTEMPTS } from "../src/modules/fakturownia/lib/constants.ts"
import { addDays, isIsoDate, monthYear, warsawDate } from "../src/modules/fakturownia/lib/dates.ts"
import {
  accountUrl,
  canIssue,
  isValidAccount,
  missingOptions,
  normalizeAccount,
  parseTaxValue,
  resolveOptions,
} from "../src/modules/fakturownia/lib/options.ts"
import { normalizeReview, resolveReferences } from "../src/modules/fakturownia/lib/references.ts"

test("defaults: the final document at payment capture, VAT 23, Polish, 7 days, marked paid, no e-mail", () => {
  const o = resolveOptions({ apiToken: "t0ken-long-enough", account: "mojafirma" })
  assert.equal(o.demo, false)
  assert.equal(o.documentFlow, "vat")
  assert.equal(o.trigger, "payment_captured")
  assert.equal(o.receiptForConsumers, false)
  assert.equal(o.receiptKind, "receipt")
  assert.equal(o.defaultVatRate, 23)
  assert.equal(o.lang, "pl")
  assert.equal(o.shippingPositionName, "Dostawa")
  assert.equal(o.quantityUnit, "szt.")
  assert.equal(o.paymentTermDays, 7)
  assert.equal(o.markPaidOnCapture, true)
  assert.equal(o.sendByEmail, false)
  assert.equal(o.cancelOnOrderCanceled, true)
  assert.deepEqual(o.taxIdMetadataKeys, ["nip", "tax_id", "invoice_nip"])
  assert.deepEqual(o.codProviders, ["pp_cod", "pp_cash"])
  assert.deepEqual(o.paymentTypes, [])
  assert.equal(o.departmentId, null)
  assert.equal(o.categoryId, null)
  assert.equal(o.oidPrefix, "")
  assert.equal(o.requestsPerMinute, 60)
  assert.equal(o.timeoutMs, 30_000)
})

test("demo mode: on without a token, on by option, off only when asked with demo: false", () => {
  assert.equal(resolveOptions(undefined).demo, true)
  assert.equal(resolveOptions({}).demoReason, "no_token")
  assert.equal(resolveOptions({ apiToken: "t0ken-long-enough", demo: true }).demoReason, "option")
  const off = resolveOptions({ demo: "false" })
  assert.equal(off.demo, false)
  assert.equal(off.demoReason, null)
  assert.deepEqual(missingOptions(off), ["apiToken", "account"])
  assert.equal(canIssue(off), false)
  assert.deepEqual(missingOptions(resolveOptions({})), [], "nothing is missing in demo mode")
  assert.equal(canIssue(resolveOptions({})), true)
})

test("values from environment strings: numbers, lists, booleans, flows", () => {
  const o = resolveOptions({
    apiToken: " t0ken-long-enough ",
    account: "MojaFirma",
    documentFlow: "proforma_then_vat",
    trigger: "order_placed",
    receiptForConsumers: "true",
    defaultVatRate: "8",
    departmentId: "123",
    categoryId: "x",
    paymentTermDays: "999",
    markPaidOnCapture: "0",
    sendByEmail: "yes",
    cancelOnOrderCanceled: "off",
    taxIdMetadataKeys: "vat_id, nip",
    codProviders: "PP_COD",
    requestsPerMinute: "5000",
    timeoutMs: "10",
  })
  assert.equal(o.apiToken, "t0ken-long-enough")
  assert.equal(o.account, "mojafirma")
  assert.equal(o.documentFlow, "proforma_then_vat")
  assert.equal(o.trigger, "order_placed")
  assert.equal(o.receiptForConsumers, true)
  assert.equal(o.defaultVatRate, 8)
  assert.equal(o.departmentId, 123)
  assert.equal(o.categoryId, null)
  assert.equal(o.paymentTermDays, 365)
  assert.equal(o.markPaidOnCapture, false)
  assert.equal(o.sendByEmail, true)
  assert.equal(o.cancelOnOrderCanceled, false)
  assert.deepEqual(o.taxIdMetadataKeys, ["vat_id", "nip"])
  assert.deepEqual(o.codProviders, ["pp_cod"])
  assert.equal(o.requestsPerMinute, 600)
  assert.equal(o.timeoutMs, 5000)
})

test("unknown values fall back instead of breaking: flow, trigger, receipt kind, language", () => {
  const o = resolveOptions({ documentFlow: "nope", trigger: "nope", receiptKind: "Paragon fiskalny!", lang: "polski" })
  assert.equal(o.documentFlow, "vat")
  assert.equal(o.trigger, "payment_captured")
  assert.equal(o.receiptKind, "receipt")
  assert.equal(o.lang, "pl")
  assert.equal(resolveOptions({ lang: "pl/en" }).lang, "pl/en")
  assert.equal(resolveOptions({ lang: "en-GB" }).lang, "en-GB")
  assert.equal(resolveOptions({ receiptKind: "fiscal_receipt" }).receiptKind, "fiscal_receipt")
})

test("payment types: lowercased prefixes, the longest first, long values clipped", () => {
  const o = resolveOptions({ paymentTypes: { pp_stripe: "card", "PP_STRIPE-BLIK": "blik", pp_payu: "x".repeat(60), "": "nothing" } })
  assert.deepEqual(o.paymentTypes[0], ["pp_stripe-blik", "blik"])
  assert.deepEqual(o.paymentTypes[1], ["pp_stripe", "card"])
  assert.equal(o.paymentTypes[2][1].length, 40)
  assert.equal(o.paymentTypes.length, 3)
})

test("tax values: rates, percent signs and the Polish codes", () => {
  assert.equal(parseTaxValue("23%", 0), 23)
  assert.equal(parseTaxValue("5,5", 0), 5.5)
  assert.equal(parseTaxValue("ZW", 23), "zw")
  assert.equal(parseTaxValue("np", 23), "np")
  assert.equal(parseTaxValue("150", 23), 23)
  assert.equal(parseTaxValue(undefined, 23), 23)
})

test("account: the full address works, anything that is not a subdomain is refused", () => {
  assert.equal(normalizeAccount("https://MojaFirma.fakturownia.pl/invoices"), "mojafirma")
  assert.equal(normalizeAccount("mojafirma.fakturownia.pl"), "mojafirma")
  assert.equal(normalizeAccount("moja-firma"), "moja-firma")
  assert.equal(isValidAccount("moja-firma"), true)
  for (const bad of ["evil.com#", "evil.com", "a b", "-x", "x_y", "", "attacker@host"]) {
    assert.equal(isValidAccount(normalizeAccount(bad)), false, bad)
  }
  const o = resolveOptions({ apiToken: "t0ken-long-enough", account: "evil.com#" })
  assert.deepEqual(missingOptions(o), ["account (the subdomain, like mojafirma)"])
  assert.equal(accountUrl(o), null)
  assert.equal(accountUrl(resolveOptions({ apiToken: "t0ken-long-enough", account: "mojafirma" })), "https://mojafirma.fakturownia.pl")
  assert.equal(accountUrl(resolveOptions({ account: "mojafirma" })), null, "no panel link in demo mode")
})

test("oid prefix: whitespace removed, at most 20 characters", () => {
  assert.equal(resolveOptions({ oidPrefix: " M 2026- " }).oidPrefix, "M2026-")
  assert.equal(resolveOptions({ oidPrefix: "x".repeat(30) }).oidPrefix.length, 20)
})

test("references: a review needs a positive rating and a source, never exceeds its scale, links only over https", () => {
  const review = normalizeReview({ rating: "4,8", source: "Clutch", url: "https://clutch.co/review/1", icon: "javascript:alert(1)", quote: { pl: "Polecam" } })
  assert.deepEqual(review, { rating: 4.8, scale: 5, source: "Clutch", url: "https://clutch.co/review/1", icon: null, quote: { en: null, pl: "Polecam" }, author: null })
  assert.equal(normalizeReview({ rating: 9, source: "Clutch" })?.rating, 5)
  assert.equal(normalizeReview({ rating: 9, scale: 10, source: "Google" })?.scale, 10)
  assert.equal(normalizeReview({ rating: 5, source: "Clutch", url: "http://clutch.co" })?.url, null)
  assert.equal(normalizeReview({ rating: 0, source: "Clutch" }), null)
  assert.equal(normalizeReview({ rating: 5 }), null)
  assert.equal(normalizeReview("5 stars"), null)
  const [withReview, without] = resolveReferences([
    { name: "A", url: "https://a.pl", review: { rating: 5, source: "Clutch" } },
    { name: "B", url: "https://b.pl", review: { rating: "great" } },
  ])
  assert.equal(withReview.review?.rating, 5)
  assert.equal(without.review, null)
  const fromOptions = resolveOptions({ references: [{ name: "A", url: "https://a.pl", review: { rating: 5, source: "Clutch", author: "Jan" } }] }).references
  assert.equal(fromOptions[0].review?.source, "Clutch")
  assert.equal(fromOptions[0].review?.author, "Jan")
})

test("dates: the Polish calendar day, also when UTC still says yesterday", () => {
  assert.equal(warsawDate(new Date("2026-10-04T22:30:00Z")), "2026-10-05", "00:30 in Warsaw (CEST)")
  assert.equal(warsawDate(new Date("2026-10-05T21:59:00Z")), "2026-10-05")
  assert.equal(warsawDate(new Date("2026-12-31T23:30:00Z")), "2027-01-01", "00:30 in Warsaw (CET)")
  assert.equal(addDays("2026-10-30", 7), "2026-11-06")
  assert.equal(addDays("2026-12-28", 7), "2027-01-04")
  assert.equal(addDays("2026-10-05", -7), "2026-09-28")
  assert.equal(isIsoDate("2026-02-29"), false)
  assert.equal(isIsoDate("2026-10-05"), true)
  assert.equal(monthYear("2026-10-05"), "10/2026")
})

test("backoff: the table, at most 10 % jitter, and a weekend of retries before a person is asked", () => {
  const none = () => 0
  assert.equal(retryDelaySeconds(1, BACKOFF_SECONDS, none), 60)
  assert.equal(retryDelaySeconds(50, BACKOFF_SECONDS, none), 43_200)
  assert.equal(retryDelaySeconds(1, BACKOFF_SECONDS, () => 0.999), 66)
  let total = 0
  for (let a = 1; a < MAX_ATTEMPTS; a += 1) total += retryDelaySeconds(a, BACKOFF_SECONDS, none)
  assert.ok(total > 2 * 24 * 3600)
  const now = new Date("2026-10-05T10:00:00Z")
  assert.deepEqual(planRetry({ attempts: 1, retryable: true, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now, random: none }), {
    status: "pending",
    nextAttemptAt: new Date("2026-10-05T10:01:00Z"),
  })
  assert.deepEqual(planRetry({ attempts: 1, retryable: false, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now }), { status: "failed", nextAttemptAt: null })
  assert.deepEqual(planRetry({ attempts: MAX_ATTEMPTS, retryable: true, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now }), { status: "failed", nextAttemptAt: null })
})
