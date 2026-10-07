import { test } from "node:test"
import assert from "node:assert/strict"
import { isAgencyEmail, isSandboxEmail, normalizeEmail, resolveOptions } from "../src/modules/tasks/lib/options.ts"
import { normalizeReferences, normalizeReview, pickText } from "../src/modules/tasks/lib/references.ts"

test("options: defaults when nothing is set, nothing ever throws", () => {
  for (const input of [undefined, null, {}, "nonsense" as unknown as object, 42 as unknown as object]) {
    const o = resolveOptions(input as never)
    assert.deepEqual(o.sandboxAccounts, [])
    assert.deepEqual(o.agencyAccounts, [])
    assert.equal(o.sandboxResetHours, 24)
    assert.deepEqual(o.references, [])
  }
})

test("options: sandbox accounts are e-mails, lower case, unique; a comma separated string works (environment variables)", () => {
  assert.deepEqual(resolveOptions({ sandboxAccounts: [" Demo@Store.example ", "demo@store.example", "not an e-mail", "", 42 as unknown as string] }).sandboxAccounts, ["demo@store.example"])
  assert.deepEqual(resolveOptions({ sandboxAccounts: "a@x.pl, b@y.pl;c@z.pl" }).sandboxAccounts, ["a@x.pl", "b@y.pl", "c@z.pl"])
  assert.deepEqual(resolveOptions({ sandboxAccounts: "" }).sandboxAccounts, [])
})

test("options: agency accounts take e-mails and domains; a bare domain counts as one", () => {
  const o = resolveOptions({ agencyAccounts: ["@Agency.example", "agency.dev", "freelancer@example.com", "@", "not a domain"] })
  assert.deepEqual(o.agencyAccounts, ["@agency.example", "@agency.dev", "freelancer@example.com"])
  assert.equal(isAgencyEmail("ola@agency.example", o), true)
  assert.equal(isAgencyEmail("Someone@AGENCY.DEV", o), true)
  assert.equal(isAgencyEmail("freelancer@example.com", o), true)
  assert.equal(isAgencyEmail("other@example.com", o), false)
  assert.equal(isAgencyEmail(null, o), false)
})

test("options: the sandbox reset hours are bounded, 0 turns the automatic reseed off", () => {
  assert.equal(resolveOptions({ sandboxResetHours: 0 }).sandboxResetHours, 0)
  assert.equal(resolveOptions({ sandboxResetHours: "6" }).sandboxResetHours, 6)
  assert.equal(resolveOptions({ sandboxResetHours: -5 }).sandboxResetHours, 0)
  assert.equal(resolveOptions({ sandboxResetHours: "soon" }).sandboxResetHours, 24)
  assert.equal(resolveOptions({ sandboxResetHours: 10 ** 9 }).sandboxResetHours, 24 * 365)
})

test("options: sandbox matching is exact on the e-mail, without case; unknown e-mails are never sandbox accounts", () => {
  const o = resolveOptions({ sandboxAccounts: ["demo@store.example"] })
  assert.equal(isSandboxEmail("DEMO@store.example", o), true)
  assert.equal(isSandboxEmail("demo@store.example.evil.com", o), false)
  assert.equal(isSandboxEmail("other@store.example", o), false)
  assert.equal(isSandboxEmail(null, o), false)
  assert.equal(isSandboxEmail(undefined, o), false)
  assert.equal(normalizeEmail(" X@Y.PL "), "x@y.pl")
  assert.equal(normalizeEmail("x@y"), null)
})

test("references: entries without a name or an https URL are dropped, parts are cleaned, nothing throws", () => {
  const refs = normalizeReferences([
    {
      name: "Store One",
      url: "https://www.store-one.example",
      description: { en: "Tyres and wheels", pl: "Opony i felgi" },
      metrics: [{ label: { en: "tasks", pl: "zadań" }, value: "120" }, { label: "broken" }],
      links: [{ label: "Board", url: "https://www.store-one.example/p/1" }, { label: "Insecure", url: "http://x.pl" }],
    },
    { name: "No URL" },
    { name: "Plain http", url: "http://shop.pl" },
    { name: "", url: "https://shop.pl" },
    { name: "Duplicate", url: "https://www.store-one.example" },
    "not an object",
    { name: "Same text", url: "https://shop.example.com", description: "Same in both" },
  ])
  assert.equal(refs.length, 2)
  assert.equal(refs[0].soon, false)
  assert.equal(refs[0].metrics.length, 1)
  assert.equal(refs[0].links.length, 1)
  assert.deepEqual(refs[1].description, { en: "Same in both", pl: "Same in both" })
  assert.deepEqual(normalizeReferences("nope"), [])
  assert.deepEqual(normalizeReferences(undefined), [])
  assert.equal(resolveOptions({ references: [{ name: "A", url: "https://a.pl" }] }).references.length, 1)
})

test("references: a review needs a positive rating and a source, never exceeds its scale, links only over https", () => {
  const review = normalizeReview({ rating: "4,8", source: "Clutch", url: "https://clutch.co/review/1", icon: "javascript:alert(1)", quote: { pl: "Polecam" } })
  assert.deepEqual(review, { rating: 4.8, scale: 5, source: "Clutch", url: "https://clutch.co/review/1", icon: null, quote: { pl: "Polecam" }, author: null })
  assert.equal(normalizeReview({ rating: 9, source: "Clutch" })?.rating, 5)
  assert.equal(normalizeReview({ rating: 9, scale: 10, source: "Google" })?.scale, 10)
  assert.equal(normalizeReview({ rating: 5, source: "Clutch", url: "http://clutch.co" })?.url, null)
  assert.equal(normalizeReview({ rating: 0, source: "Clutch" }), null)
  assert.equal(normalizeReview({ rating: 5 }), null)
  assert.equal(normalizeReview("5 stars"), null)
})

test("references: the admin language with a fallback to the other one", () => {
  assert.equal(pickText({ en: "Tyres", pl: "Opony" }, "pl"), "Opony")
  assert.equal(pickText({ en: "Tyres", pl: "Opony" }, "en-US"), "Tyres")
  assert.equal(pickText({ en: "Only English" }, "pl"), "Only English")
  assert.equal(pickText({ pl: "Tylko polski" }, "en"), "Tylko polski")
  assert.equal(pickText(null, "pl"), "")
})

test("references: a store that starts soon needs only its name, a live one still needs an https URL", () => {
  const refs = normalizeReferences([
    { name: "Soon, no address", soon: true, description: "Opens in spring" },
    { name: "Soon, with an address", soon: true, url: "https://soon.example.com" },
    { name: "Soon, insecure address", soon: true, url: "http://soon.example.com" },
    { name: "Live, no address" },
    { name: "Live, insecure address", url: "http://live.example.com" },
    { name: "Not a boolean", soon: "yes" },
    { soon: true },
  ])
  assert.deepEqual(
    refs.map((r) => ({ name: r.name, soon: r.soon, url: r.url })),
    [
      { name: "Soon, no address", soon: true, url: null },
      { name: "Soon, with an address", soon: true, url: "https://soon.example.com/" },
      { name: "Soon, insecure address", soon: true, url: null },
    ],
  )
  assert.equal(normalizeReferences(Array.from({ length: 15 }, (_, i) => ({ name: `Store ${i}`, soon: true }))).length, 12)
  assert.deepEqual(resolveOptions({ references: [{ name: "Soon", soon: true }] }).references.map((r) => r.soon), [true])
})

test("references: the since date of an older config is ignored, never an error", () => {
  const refs = normalizeReferences([
    { name: "Live", url: "https://a.pl", since: "2026-04" },
    { name: "Soon", soon: true, since: { not: "a month" } },
  ])
  assert.equal(refs.length, 2)
  for (const r of refs) assert.equal("since" in r, false)
})
