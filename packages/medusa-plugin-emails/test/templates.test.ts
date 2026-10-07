/**
 * Every built-in template, in Polish and English, with full data and with
 * the least data it can get: it renders, says what it must, escapes what it
 * gets, stays under Gmail's clipping size, carries a text part and dark
 * mode, and never prints a dash or a middle dot.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { GMAIL_CLIP_BYTES, LOCALES } from "../src/modules/emails/lib/constants.ts"
import { renderEmailPreview } from "../src/modules/emails/lib/preview.ts"
import { BUILT_IN_KEYS } from "../src/modules/emails/lib/templates/index.ts"
import { resolveOptions } from "../src/modules/emails/lib/options.ts"
import { resolveTemplate, sensitiveFields } from "../src/modules/emails/lib/registry.ts"
import { FORBIDDEN, LIVE } from "./helpers.ts"

const BAD = /undefined|NaN|\[object Object\]|>null</

function checkRendered(r: { subject: string; html: string; text: string }, label: string) {
  assert.ok(r.subject.trim().length > 3, `${label}: subject`)
  assert.ok(r.text.trim().length > 40, `${label}: text part`)
  assert.ok(!BAD.test(r.subject) && !BAD.test(r.text), `${label}: no undefined/NaN in subject or text`)
  assert.ok(!BAD.test(r.html), `${label}: no undefined/NaN in HTML`)
  assert.ok(!FORBIDDEN.test(r.subject) && !FORBIDDEN.test(r.text) && !FORBIDDEN.test(r.html), `${label}: no dash or middle dot`)
  assert.ok(Buffer.byteLength(r.html, "utf8") < GMAIL_CLIP_BYTES, `${label}: below Gmail's clipping size`)
  assert.match(r.html, /prefers-color-scheme:dark/, `${label}: dark mode`)
  assert.match(r.html, /\[data-ogsc\]/, `${label}: Outlook dark mode`)
  assert.doesNotMatch(r.html, /<img\b/i, `${label}: no images`)
  assert.doesNotMatch(r.html, /<script\b/i, `${label}: no scripts`)
}

test("every built-in template renders in both languages from its sample", () => {
  assert.equal(BUILT_IN_KEYS.length, 9)
  for (const key of BUILT_IN_KEYS) {
    for (const locale of LOCALES) {
      const r = renderEmailPreview({ template: key, locale, options: LIVE })
      checkRendered(r, `${key} ${locale}`)
      assert.match(r.html, new RegExp(`<html lang="${locale}"`), `${key} ${locale}: lang`)
      assert.match(r.html, /Koda Supply/, `${key} ${locale}: the store name`)
    }
  }
})

test("every built-in template renders with almost no data and no options at all", () => {
  const minimal: Record<string, Record<string, unknown>> = {
    "password.reset": { email: "anna@example.com", reset_url: "https://shop.example.com/reset?token=t" },
  }
  for (const key of BUILT_IN_KEYS) {
    for (const locale of LOCALES) {
      const r = renderEmailPreview({ template: key, locale, data: minimal[key] ?? {}, options: {} })
      checkRendered(r, `${key} ${locale} minimal`)
    }
  }
})

test("the order confirmation lists the products, the totals and the address, and the text part says the same", () => {
  const r = renderEmailPreview({ template: "order.placed", locale: "pl", options: LIVE })
  assert.equal(r.subject, "Mamy Twoje zamówienie nr 1042")
  const plain = r.html.replace(/&nbsp;/g, " ")
  for (const s of ["Lampka biurkowa LED", "HO-LMP-10W", "802,49", "Poznań", "w tym VAT"]) assert.ok(plain.includes(s), `html has ${s}`)
  assert.match(r.text, /Lampka biurkowa LED \(HO-LMP-10W\), 2 szt\. po 189,00\s?zł: 378,00\s?zł/)
  assert.match(r.text, /Razem: 802,49\s?zł/)
  assert.match(r.text, /Zobacz zamówienie: https:\/\/shop\.example\.com\/account/)
  const en = renderEmailPreview({ template: "order.placed", locale: "en", options: LIVE })
  assert.equal(en.subject, "We have your order #1042")
  assert.match(en.text, /Qty 2 at €39\.00 each: €78\.00/)
})

test("the shipping e-mail shows every tracking number with its link, and a partial shipment says so", () => {
  const data = {
    order_number: 7,
    items: [{ title: "Lamp", quantity: 1, unit_price: 10 }],
    tracking: [
      { number: "TRACK-1", url: "https://carrier.example.com/t/TRACK-1" },
      { number: "TRACK-2", url: "javascript:alert(1)" },
    ],
    partial: true,
  }
  const r = renderEmailPreview({ template: "order.shipped", locale: "en", data, options: LIVE })
  assert.equal(r.subject, "Part of order #7 is on its way")
  assert.match(r.html, /TRACK-1/)
  assert.match(r.html, /href="https:\/\/carrier\.example\.com\/t\/TRACK-1"/)
  assert.match(r.html, /TRACK-2/)
  assert.doesNotMatch(r.html, /javascript:/)
  assert.match(r.text, /The rest follows in another parcel/)
})

test("values from customers are escaped everywhere, and bad links are dropped", () => {
  const evil = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`
  const data = {
    order_number: evil,
    customer_name: evil,
    company_name: evil,
    items: [{ title: evil, sku: evil, variant: evil, quantity: 1, unit_price: 5 }],
    shipping_address: [evil, evil],
    shipping_method: evil,
    order_url: "javascript:alert(3)",
    total: 5,
    currency_code: "pln",
  }
  for (const key of ["order.placed", "order.canceled", "order.shipped", "cart.abandoned", "customer.welcome"]) {
    for (const locale of LOCALES) {
      const r = renderEmailPreview({ template: key, locale, data, options: LIVE })
      assert.doesNotMatch(r.html, /<script>alert/, `${key} ${locale}: no live script`)
      assert.doesNotMatch(r.html, /<img src=x/, `${key} ${locale}: no live img`)
      assert.doesNotMatch(r.html, /javascript:/, `${key} ${locale}: no javascript link`)
    }
  }
})

test("long orders are cut to 30 lines with a sum-up line, and stay below the clipping size", () => {
  const items = Array.from({ length: 80 }, (_, i) => ({ title: `Product number ${i + 1} with a long and descriptive name`, sku: `SKU-${i}-X`, quantity: 3, unit_price: 19.99 }))
  const r = renderEmailPreview({ template: "order.placed", locale: "pl", data: { order_number: 1, items, total: 4797.6, currency_code: "pln" }, options: LIVE })
  assert.match(r.text, /i jeszcze 50 produktów/)
  assert.ok(Buffer.byteLength(r.html, "utf8") < GMAIL_CLIP_BYTES)
})

test("Polish messages keep short words with the next one and e-mail unbroken; English ones are left alone", () => {
  const pl = renderEmailPreview({ template: "customer.welcome", locale: "pl", options: LIVE })
  assert.match(pl.html, /i&nbsp;trzy/)
  const en = renderEmailPreview({ template: "customer.welcome", locale: "en", options: LIVE })
  assert.match(en.html, /customer card and three things/)
})

test("the password reset links to the given page and explains how long it works", () => {
  const data = { email: "anna@example.com", reset_url: "https://shop.example.com/reset-password?token=abc&email=anna%40example.com", expires_minutes: 22 }
  const pl = renderEmailPreview({ template: "password.reset", locale: "pl", data, options: LIVE })
  assert.match(pl.html, /href="https:\/\/shop\.example\.com\/reset-password\?token=abc&amp;email=anna%40example\.com"/)
  assert.match(pl.text, /Link działa przez 22 minuty/)
  const admin = renderEmailPreview({ template: "password.reset", locale: "en", data: { ...data, actor: "user", expires_minutes: 1 }, options: LIVE })
  assert.equal(admin.subject, "Reset your Koda Supply admin password")
  assert.match(admin.text, /1 minute\./)
  const noName = renderEmailPreview({ template: "password.reset", locale: "pl", data, options: {} })
  assert.equal(noName.subject, "Ustaw nowe hasło do swojego konta")
})

test("the light and dark preview themes are forced on the html element", () => {
  const dark = renderEmailPreview({ template: "order.placed", locale: "en", options: LIVE, theme: "dark" })
  assert.match(dark.html, /<html class="em-theme-dark" lang="en"/)
  const light = renderEmailPreview({ template: "order.placed", locale: "en", options: LIVE, theme: "light" })
  assert.match(light.html, /<html class="em-theme-light" lang="en"/)
})

test("the brand of the options shapes the message: logo parts, colours, footer, support address", () => {
  const r = renderEmailPreview({
    template: "order.placed",
    locale: "pl",
    options: {
      ...LIVE,
      brand: { name: "Koda Supply", logo: { text: "KODA", accent: "+", suffix: "Supply", italic: true }, accentColor: "#2563eb", footer: { pl: "Firma sp. z o.o., Warszawa", en: "Company Ltd" }, supportEmail: "pomoc@example.com" },
    },
  })
  assert.match(r.html, /KODA<span[^>]*>\+<\/span>/)
  assert.match(r.html, /font-style:italic/)
  assert.match(r.html, /#2563EB/)
  assert.match(r.html, /Firma sp\.(&nbsp;| )z(&nbsp;| )o\.o\., Warszawa/)
  assert.match(r.html, /mailto:pomoc@example\.com/)
  assert.match(r.text, /Firma sp\. z o\.o\., Warszawa/)
})

test("the welcome never puts what a stranger typed at registration in the subject, nor a link anywhere", () => {
  for (const locale of LOCALES) {
    const named = renderEmailPreview({ template: "customer.welcome", locale, options: LIVE, data: { customer_name: "Anna", customer_since: "2026-10-01T10:00:00Z" } })
    assert.doesNotMatch(named.subject, /Anna/, `${locale}: no name in the subject`)
    assert.match(named.html, /Anna/, `${locale}: the name in the message`)
    const spam = renderEmailPreview({ template: "customer.welcome", locale, options: LIVE, data: { customer_name: "Claim your prize at evil.example", company_name: "https://evil.example/win", customer_since: "2026-10-01T10:00:00Z" } })
    assert.doesNotMatch(`${spam.subject} ${spam.html} ${spam.text}`, /evil\.example/, `${locale}: the stranger's line is dropped`)
    checkRendered(spam, `welcome ${locale} without a usable name`)
  }
})

test("the password reset template marks its link as a secret", () => {
  assert.deepEqual(sensitiveFields(resolveTemplate("password.reset", resolveOptions(LIVE))!), ["reset_url"])
  /* A replaced password reset (an app's own template under the key) still carries the token. */
  const replaced = resolveOptions({ ...LIVE, templates: { "password.reset": { render: () => ({ subject: "Reset", html: "<p>x</p>" }) } } })
  assert.deepEqual(sensitiveFields(resolveTemplate("password.reset", replaced)!), ["reset_url"])
  assert.deepEqual(sensitiveFields(resolveTemplate("order.placed", resolveOptions(LIVE))!), [])
})
