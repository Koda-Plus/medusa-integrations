/**
 * The words a person rewrites in the admin: checked on the way in, the
 * placeholders filled (and dropped cleanly when empty), the accent kept,
 * the customer's data escaped, and only the edited language changed.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { fillText, sanitizeCopyOverrides } from "../src/modules/emails/lib/copy-overrides.ts"
import { renderTemplate } from "../src/modules/emails/lib/render.ts"
import { resolveTemplate } from "../src/modules/emails/lib/registry.ts"
import { readSettings } from "../src/modules/emails/lib/settings.ts"
import { sampleOrder } from "../src/modules/emails/lib/templates/index.ts"
import { live } from "./helpers.ts"

test("placeholders: filled, and an empty one takes its comma along", () => {
  assert.equal(fillText("{name}, dziękujemy za zamówienie {order}.", { name: "Anna", order: "1042" }), "Anna, dziękujemy za zamówienie 1042.")
  assert.equal(fillText("{name}, dziękujemy za zamówienie {order}.", { name: "", order: "1042" }), "Dziękujemy za zamówienie 1042.")
  assert.equal(fillText("Hej {name}!", { name: "" }), "Hej!")
  assert.equal(fillText("Kod {unknown} zostaje", {}), "Kod {unknown} zostaje")
})

test("sanitize: limits, types and empty fields", () => {
  const ok = sanitizeCopyOverrides({ pl: { subject: "  Mamy   to {order} ", title: "", note: "a\n\n\n\nb" }, en: null })
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.value, { pl: { subject: "Mamy to {order}", note: "a\n\nb" } })
  assert.deepEqual(sanitizeCopyOverrides({ pl: { subject: "x".repeat(151) } }).errors, ["pl.subject"])
  assert.deepEqual(sanitizeCopyOverrides({ en: { intro: 5 } }).errors, ["en.intro"])
  assert.deepEqual(sanitizeCopyOverrides([]).errors, ["copy"])
})

test("render: the edited words in the edited language only, the rest of the order intact", () => {
  const o = live()
  const t = resolveTemplate("order.placed", o)!
  const copy = { pl: { subject: "Zamówienie {order} przyjęte", title: "{name}, *dzięki* za zakupy", note: "Wysyłamy w 24 godziny." } }
  const pl = renderTemplate(t, sampleOrder("pl") as Record<string, unknown>, { locale: "pl", options: o, brand: o.brand, copy })
  assert.match(pl.subject, /^Zamówienie \S+ przyjęte$/)
  assert.match(pl.text, /za zakupy/)
  assert.match(pl.text, /Wysyłamy w 24/)
  assert.match(pl.text, /Razem/, "the totals stay")
  assert.ok(pl.defaults && /\*Kompletujemy\*/.test(pl.defaults.title), "defaults show the accent as *word*")
  const en = renderTemplate(t, sampleOrder("en") as Record<string, unknown>, { locale: "en", options: o, brand: o.brand, copy })
  assert.doesNotMatch(en.subject, /przyjęte/)
})

test("render: a customer's name with markup is escaped in an edited title", () => {
  const o = live()
  const t = resolveTemplate("order.placed", o)!
  const data = { ...(sampleOrder("pl") as Record<string, unknown>), customer_name: "<b>Ola</b>" }
  const r = renderTemplate(t, data, { locale: "pl", options: o, brand: o.brand, copy: { pl: { title: "{name}, dzięki" } } })
  assert.doesNotMatch(r.html, /<b>Ola<\/b>/)
})

test("settings: copy rows are read per mode and invalid ones dropped", () => {
  const s = readSettings(
    [
      { key: "live:copy:order.placed", value: { pl: { subject: "Hej {name}" } }, updated_by: "user_1", updated_at: new Date() },
      { key: "live:copy:order.shipped", value: { pl: { subject: 5 } } },
      { key: "demo:copy:order.canceled", value: { pl: { subject: "demo" } } },
    ],
    false,
  )
  assert.deepEqual(Object.keys(s.copy), ["order.placed"])
  assert.equal(s.copy["order.placed"].value.pl?.subject, "Hej {name}")
})
