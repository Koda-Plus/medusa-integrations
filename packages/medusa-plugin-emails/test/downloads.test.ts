/**
 * Digital products: signed download links, the kind of an order, the data
 * of the confirmation and the three confirmations it picks from.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { attachmentName, downloadToken, downloadUrl, orderKind, verifyDownloadToken } from "../src/modules/emails/lib/downloads.ts"
import { orderData } from "../src/modules/emails/lib/data.ts"
import { resolveOptions } from "../src/modules/emails/lib/options.ts"
import { renderEmailPreview } from "../src/modules/emails/lib/preview.ts"
import { sampleOrderDigital, sampleOrderMixed } from "../src/modules/emails/lib/templates/index.ts"
import { placedTemplateFor } from "../src/workflows/emails/events.ts"
import { LIVE } from "./helpers.ts"

const SECRET = "0123456789abcdef-secret"

test("a token opens only its own order line and needs the same secret", () => {
  const t = downloadToken(SECRET, "order_1", "item_1")
  assert.equal(t.length, 32)
  assert.equal(verifyDownloadToken(SECRET, "order_1", "item_1", t), true)
  assert.equal(verifyDownloadToken(SECRET, "order_1", "item_2", t), false)
  assert.equal(verifyDownloadToken(SECRET, "order_2", "item_1", t), false)
  assert.equal(verifyDownloadToken("another-secret-0123", "order_1", "item_1", t), false)
  assert.equal(verifyDownloadToken(SECRET, "order_1", "item_1", "x"), false)
  assert.equal(verifyDownloadToken(SECRET, "order_1", "item_1", undefined), false)
})

test("the link template gets the order, the line and the token", () => {
  const url = downloadUrl("https://shop.example.com/api/ebook?o={order_id}&i={item_id}&t={token}", SECRET, "order_1", "item_1")
  assert.equal(url, `https://shop.example.com/api/ebook?o=order_1&i=item_1&t=${downloadToken(SECRET, "order_1", "item_1")}`)
})

test("an order is physical, digital or mixed by requires_shipping", () => {
  assert.equal(orderKind([{ requires_shipping: true }]), "physical")
  assert.equal(orderKind([{}]), "physical")
  assert.equal(orderKind([{ requires_shipping: false }, { requires_shipping: false }]), "digital")
  assert.equal(orderKind([{ requires_shipping: false }, { requires_shipping: true }]), "mixed")
  assert.equal(orderKind([]), "physical")
  assert.equal(placedTemplateFor({ items: [{ requires_shipping: true }] }), "order.placed")
  assert.equal(placedTemplateFor({ items: [{ requires_shipping: false }] }), "order.placed.digital")
  assert.equal(placedTemplateFor({ items: [{ requires_shipping: false }, { requires_shipping: true }] }), "order.placed.mixed")
})

test("the order data has a signed link per digital line, none for physical ones", () => {
  const o = resolveOptions({ storefrontUrl: "https://shop.example.com", downloads: { secret: SECRET, url: "/api/ebook?o={order_id}&i={item_id}&t={token}" } })
  const order = {
    id: "order_1",
    email: "a@example.com",
    items: [
      { id: "item_1", title: "E-book A", quantity: 1, unit_price: 30, requires_shipping: false },
      { id: "item_2", title: "Herbs", quantity: 2, unit_price: 40, requires_shipping: true },
    ],
    customer: { has_account: true },
  }
  const d = orderData(order as never, o)
  assert.equal(d.downloads?.length, 1)
  assert.equal(d.downloads?.[0].title, "E-book A")
  assert.equal(d.downloads?.[0].url, `https://shop.example.com/api/ebook?o=order_1&i=item_1&t=${downloadToken(SECRET, "order_1", "item_1")}`)
  assert.equal(d.has_account, true)
  assert.equal(d.items?.[0].digital, true)
  assert.equal(d.items?.[1].digital, undefined)
})

test("without a secret the digital lines are listed with no links", () => {
  const d = orderData({ id: "order_1", items: [{ id: "i", title: "E-book", quantity: 1, requires_shipping: false }] } as never, resolveOptions({}))
  assert.deepEqual(d.downloads, [{ title: "E-book", url: null }])
})

test("a physical order gets no downloads field at all", () => {
  const d = orderData({ id: "order_1", items: [{ id: "i", title: "Herbs", quantity: 1, requires_shipping: true }] } as never, resolveOptions({}))
  assert.equal("downloads" in d, false)
})

test("a short secret or a url without {token} is refused", () => {
  const o = resolveOptions({ downloads: { secret: "short", url: "https://x.example.com/dl" } })
  assert.equal(o.downloads.secret, null)
  assert.equal(o.downloads.url, null)
})

test("the digital confirmation shows the links and no address; the mixed one shows both", () => {
  for (const locale of ["pl", "en"] as const) {
    const digital = renderEmailPreview({ template: "order.placed.digital", locale, options: LIVE, data: sampleOrderDigital(locale) as never })
    assert.match(digital.html, /token=sample-token/)
    assert.doesNotMatch(digital.html, /ul\. Lipowa|Linden Street/)
    const mixed = renderEmailPreview({ template: "order.placed.mixed", locale, options: LIVE, data: sampleOrderMixed(locale) as never })
    assert.match(mixed.html, /token=sample-token/)
    assert.match(mixed.html, /ul\. Lipowa|Linden Street/)
  }
})

test("an attachment gets a plain file name with its extension", () => {
  assert.equal(attachmentName("E-book: Masło z haszu!", "https://cdn.example.com/a/b-01ABC.pdf"), "E-book-Maslo-z-haszu.pdf")
  assert.equal(attachmentName("Ł", "https://cdn.example.com/file"), "L.pdf")
})
