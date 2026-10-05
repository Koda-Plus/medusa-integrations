import { test } from "node:test"
import assert from "node:assert/strict"
import { issueCounts, issuesFromApi, returnsFromApi, unreadThreads } from "../src/modules/allegro/lib/issues.ts"
import { catalogMatchFromApi, draftOfferBody, planPublish, validGtin } from "../src/modules/allegro/lib/publish.ts"
import { normalizeReferences, pickText, sinceLabel } from "../src/modules/allegro/lib/references.ts"

test("returns: codes, dates and counts only; a delivered return waits for the seller's refund", () => {
  const rows = returnsFromApi({
    count: 2,
    customerReturns: [
      {
        id: "r1",
        createdAt: "2026-10-01T10:00:00Z",
        referenceNumber: "ZW/1",
        orderId: "form-1",
        buyer: { email: "jan@example.com", login: "jan" },
        items: [{ offerId: "1", quantity: 2, name: "X", reason: { type: "DAMAGED", userComment: "Paczka była mokra, Jan Kowalski" } }],
        status: "DELIVERED",
      },
      { id: "r2", status: "FINISHED", items: [] },
    ],
  })
  assert.deepEqual(
    rows.map((r) => [r.allegroId, r.status, r.open, r.needsReply, r.items, r.reasonCode]),
    [
      ["r1", "DELIVERED", true, true, 2, "DAMAGED"],
      ["r2", "FINISHED", false, false, 0, null],
    ],
  )
  const text = JSON.stringify(rows)
  for (const personal of ["jan@example.com", "Jan Kowalski", "mokra"]) assert.ok(!text.includes(personal), `${personal} must not be stored`)
})

test("disputes and claims: waiting for the seller when the last word is not the seller's", () => {
  const rows = issuesFromApi({
    issues: [
      {
        id: "d1",
        type: "DISPUTE",
        openedDate: "2026-10-02T10:00:00Z",
        subject: "NO_PRODUCT_RECEIVED",
        description: "Gdzie moja paczka?",
        checkoutForm: { id: "form-1" },
        currentState: { status: "DISPUTE_ONGOING", chatActive: true },
        chat: { lastMessage: { status: "BUYER_REPLIED", createdAt: "2026-10-03T10:00:00Z" } },
      },
      {
        id: "c1",
        type: "CLAIM",
        referenceNumber: "1/2026",
        decisionDueDate: "2026-10-08T10:00:00Z",
        currentState: { status: "CLAIM_SUBMITTED", chatActive: true },
        chat: { lastMessage: { status: "SELLER_REPLIED" } },
      },
      { id: "d2", type: "DISPUTE", currentState: { status: "DISPUTE_CLOSED" }, chat: { lastMessage: { status: "BUYER_REPLIED" } } },
    ],
  })
  assert.deepEqual(
    rows.map((r) => [r.kind, r.needsReply, r.open]),
    [
      ["dispute", true, true],
      ["claim", false, true],
      ["dispute", false, false],
    ],
  )
  assert.equal(rows[1].dueAt, "2026-10-08T10:00:00.000Z")
  assert.ok(!JSON.stringify(rows).includes("paczka"))
  const counts = issueCounts(rows, new Date("2026-10-06T10:00:00Z"))
  assert.deepEqual(counts, { returnsOpen: 0, disputesOpen: 1, claimsOpen: 1, needReply: 1, dueSoon: 1 })
})

test("unread threads: counted once each across pages", () => {
  assert.deepEqual(
    unreadThreads([
      { threads: [{ id: "a", read: false }, { id: "b", read: true }] },
      { threads: [{ id: "a", read: false }, { id: "c", read: false }, { read: false }] },
    ]),
    { unread: 2, scanned: 3 },
  )
})

test("GTIN: 8, 12, 13 and 14 digits with a valid check digit", () => {
  assert.equal(validGtin("5901234123457"), "5901234123457")
  assert.equal(validGtin("5901234123458"), null)
  assert.equal(validGtin("96385074"), "96385074")
  assert.equal(validGtin(" 590 1234 123457 "), "5901234123457")
  assert.equal(validGtin("abc"), null)
  assert.equal(validGtin(null), null)
})

test("catalog match: exactly one product, never a guess between several", () => {
  assert.equal(catalogMatchFromApi({ products: [] }).status, "none")
  assert.equal(catalogMatchFromApi({ products: [{ id: "a" }, { id: "b" }] }).status, "many")
  assert.deepEqual(catalogMatchFromApi({ products: [{ id: "a", name: "Wkrętarka", category: { id: "123" } }, { id: "a" }] }), {
    status: "one",
    productId: "a",
    productName: "Wkrętarka",
    categoryId: "123",
  })
})

test("publish plan: drafts for one catalog product, reasons for the rest, the cap defers", () => {
  const variant = (id: string, ean: string | null, price = 100, available: number | null = 3) => ({
    id,
    sku: `SKU-${id}`,
    productId: `p${id}`,
    title: `Product ${id}`,
    ean,
    price: { value: price, currency: "PLN" },
    available,
  })
  const plan = planPublish({
    variants: [
      variant("1", "5901234123457"),
      variant("2", "96385074"),
      variant("3", "4006381333931"),
      variant("4", "5901234123457", 0),
      variant("5", "5901234123457", 50, 0),
      variant("6", null),
      variant("7", "5901234123457"),
      variant("8", "5901234123457"),
    ],
    linked: new Set(["7"]),
    matches: new Map([
      ["5901234123457", { status: "one" as const, productId: "prod-a", productName: "A", categoryId: "1" }],
      ["96385074", { status: "none" as const, productId: null, productName: null, categoryId: null }],
      ["4006381333931", { status: "many" as const, productId: null, productName: null, categoryId: null }],
    ]),
    optionsMissing: [],
    cap: 1,
    quarantined: new Set(),
  })
  const by = new Map(plan.map((e) => [e.variantId, e]))
  assert.equal(by.get("1")?.status, "planned")
  assert.equal(by.get("8")?.status, "deferred")
  assert.equal(by.get("2")?.reason, "not_in_catalog")
  assert.equal(by.get("3")?.reason, "ambiguous")
  assert.equal(by.get("4")?.reason, "no_price")
  assert.equal(by.get("5")?.reason, "no_stock")
  assert.equal(by.has("6"), false)
  assert.equal(by.has("7"), false)
  const missing = planPublish({
    variants: [variant("1", "5901234123457")],
    linked: new Set(),
    matches: new Map([["5901234123457", { status: "one" as const, productId: "prod-a", productName: "A", categoryId: "1" }]]),
    optionsMissing: ["publish.shippingRatesId"],
    cap: 5,
    quarantined: new Set(),
  })
  assert.equal(missing[0].reason, "options_missing")
})

test("draft offer body: always INACTIVE, the signature is the SKU, shipping rates by id or name", () => {
  const location = { city: "Warszawa", postCode: "00-001", province: "MAZOWIECKIE", countryCode: "PL" }
  const body = draftOfferBody({ catalogProductId: "prod-a", price: { amount: "99.00", currency: "PLN" }, quantity: 0, sku: "KS-1" }, { shippingRatesId: "Standard", location, invoice: "VAT" })
  assert.deepEqual(body.publication, { status: "INACTIVE" })
  assert.deepEqual(body.external, { id: "KS-1" })
  assert.deepEqual(body.stock, { available: 1 })
  assert.deepEqual((body.delivery as { shippingRates: unknown }).shippingRates, { name: "Standard" })
  const byId = draftOfferBody({ catalogProductId: "p", price: null, quantity: 2, sku: "S" }, { shippingRatesId: "5c7bbf8b-b294-4737-bbda-894320c413b8", location, invoice: "VAT" })
  assert.deepEqual((byId.delivery as { shippingRates: unknown }).shippingRates, { id: "5c7bbf8b-b294-4737-bbda-894320c413b8" })
})

test("references: lenient, https only, both languages, a readable since", () => {
  const refs = normalizeReferences([
    { name: "Sklep", url: "https://sklep.example", description: { pl: "Opony", en: "Tyres" }, since: "2026-04", metrics: [{ label: "offers", value: 4000 }], links: [{ label: "Product", url: "https://sklep.example/p" }, { label: "x", url: "http://bad" }] },
    { name: "No https", url: "http://x.example" },
    { url: "https://no-name.example" },
    { name: "Bad since", url: "https://b.example", since: "April" },
    "nonsense",
    null,
  ])
  assert.equal(refs.length, 2)
  assert.deepEqual(refs[0].metrics, [{ label: { en: "offers", pl: "offers" }, value: "4000" }])
  assert.equal(refs[0].links.length, 1)
  assert.equal(refs[1].since, null)
  assert.equal(pickText(refs[0].description, "pl-PL"), "Opony")
  assert.equal(pickText({ en: null, pl: "Tylko polski" }, "en"), "Tylko polski")
  assert.equal(sinceLabel("2026-04", "pl"), "Od kwietnia 2026")
  assert.equal(sinceLabel("2026-04", "en"), "Since April 2026")
  assert.deepEqual(normalizeReferences(undefined), [])
})
