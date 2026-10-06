/**
 * The template registry and app templates: the order of the lookup, the
 * render shorthand, the kit for your own templates, and the switches.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/emails/lib/options.ts"
import { renderEmailPreview } from "../src/modules/emails/lib/preview.ts"
import { defineEmailTemplate, listTemplates, registerEmailTemplate, resolveTemplate, sampleData, unregisterEmailTemplate } from "../src/modules/emails/lib/registry.ts"
import { readSettings, templateKey, templateState } from "../src/modules/emails/lib/settings.ts"
import type { EmailTemplateDefinition } from "../src/modules/emails/lib/types.ts"
import { FORBIDDEN, LIVE } from "./helpers.ts"

afterEach(() => {
  unregisterEmailTemplate("company.approved")
  unregisterEmailTemplate("order.placed")
})

/** What the Koda Plus demo keeps as app code: a B2B approval in the same look. */
const companyApproved = defineEmailTemplate<{ company_name?: string; tier_label?: string; prices?: Array<{ title: string; sku?: string; retail: string; yours: string; save?: string }> }>({
  label: { en: "B2B company approved", pl: "Firma B2B zatwierdzona" },
  description: { en: "The team approves a B2B company account", pl: "Zespół zatwierdza konto firmy B2B" },
  trigger: { kind: "event", name: "company.approved" },
  sample: (locale) => ({ company_name: locale === "pl" ? "Budownictwo Krawczyk Sp. z o.o." : "Krawczyk Builders Ltd", tier_label: "B2B Premium", prices: [{ title: "Drill 18V", sku: "KS-ELN-18V", retail: "549,00 zł", yours: "450,00 zł", save: "-18%" }] }),
  render: ({ data, locale, kit, links }) => ({
    subject: locale === "pl" ? `Ceny ${data.tier_label} są już aktywne` : `${data.tier_label} prices are live`,
    eyebrow: locale === "pl" ? "Firma zweryfikowana" : "Company verified",
    title: [locale === "pl" ? "Gotowe. Widzisz już " : "Done. You now see ", kit.accent(`${data.tier_label}`), "."],
    band: kit.card({ title: data.company_name ?? "", status: { label: "OK", tone: "accent" }, pairs: [[locale === "pl" ? "Poziom cen" : "Price level", data.tier_label ?? ""]], highlight: 0 }),
    blocks: [kit.section(locale === "pl" ? "Twoje ceny" : "Your prices", kit.priceList((data.prices ?? []).map((p) => ({ title: p.title, sku: p.sku, was: p.retail, now: p.yours, badge: p.save })))), kit.actions({ label: "Shop", href: links.store() })],
  }),
})

test("the built-in set comes first in a fixed order, then app templates by key", () => {
  const o = resolveOptions({ templates: { "invoice.ready": { render: () => ({ subject: "x", html: "<p>x</p>" }) }, "company.approved": companyApproved } })
  const keys = listTemplates(o).map((t) => t.key)
  assert.deepEqual(keys.slice(0, 9), ["order.placed", "order.shipped", "order.canceled", "customer.welcome", "password.reset", "cart.abandoned", "negotiation.countered", "negotiation.accepted", "negotiation.rejected"])
  assert.deepEqual(keys.slice(9), ["company.approved", "invoice.ready"])
})

test("lookup order: the options, then registerEmailTemplate, then the built-in set", () => {
  const fromCode: EmailTemplateDefinition = { render: () => ({ subject: "code", html: "<p>code</p>" }) }
  const fromOptions: EmailTemplateDefinition = { render: () => ({ subject: "options", html: "<p>options</p>" }) }
  const plain = resolveOptions({})
  assert.equal(resolveTemplate("order.placed", plain)?.source, "builtin")
  registerEmailTemplate("order.placed", fromCode)
  assert.equal(resolveTemplate("order.placed", plain)?.source, "registry")
  assert.equal(resolveTemplate("order.placed", plain)?.builtIn, true)
  assert.equal(resolveTemplate("order.placed", resolveOptions({ templates: { "order.placed": fromOptions } }))?.def, fromOptions)
  assert.equal(resolveTemplate("nope.missing", plain), null)
  assert.equal(resolveTemplate("<bad>", plain), null)
})

test("registerEmailTemplate takes a render function alone, and refuses bad keys and definitions", () => {
  registerEmailTemplate("company.approved", () => ({ subject: "S", html: "<p>H</p>" }))
  assert.equal(renderEmailPreview({ template: "company.approved", options: LIVE }).subject, "S")
  assert.throws(() => registerEmailTemplate("bad key", () => ({ subject: "S", html: "" })), TypeError)
  assert.throws(() => registerEmailTemplate("x.y", {} as never), TypeError)
  assert.equal(unregisterEmailTemplate("company.approved"), true)
  assert.equal(unregisterEmailTemplate("company.approved"), false)
})

test("the registry is one per process, even when the file is loaded twice", async () => {
  const again = await import("../src/modules/emails/lib/registry.ts?copy=2")
  again.registerEmailTemplate("company.approved", companyApproved)
  assert.equal(resolveTemplate("company.approved", resolveOptions({}))?.source, "registry")
})

test("an app template built with the kit gets the look, dark mode, typography and a text part", () => {
  const options = { ...LIVE, templates: { "company.approved": companyApproved } }
  for (const locale of ["pl", "en"] as const) {
    const r = renderEmailPreview({ template: "company.approved", locale, options })
    assert.match(r.html, /prefers-color-scheme:dark/)
    assert.match(r.html, /KS-ELN-18V/)
    assert.match(r.html, /text-decoration:line-through/)
    assert.match(r.text, /Drill 18V \(KS-ELN-18V\): 549,00 zł > 450,00 zł \(-18%\)/)
    assert.ok(!FORBIDDEN.test(r.html))
  }
  assert.equal(renderEmailPreview({ template: "company.approved", locale: "pl", options }).subject, "Ceny B2B Premium są już aktywne")
})

test("samples: per language, the locale added, a throwing sample gives an empty object", () => {
  const t = resolveTemplate("order.placed", resolveOptions({}))!
  assert.equal(sampleData(t, "pl").locale, "pl")
  const broken = { key: "x", source: "option" as const, builtIn: false, def: { sample: () => { throw new Error("no") }, render: () => ({ subject: "s", html: "" }) } }
  assert.deepEqual(sampleData(broken, "en"), { locale: "en" })
})

test("switches: optional templates start off, an option can force one on or off, the admin decides the rest", () => {
  const o = resolveOptions({ templates: { "order.canceled": false, "negotiation.accepted": true } })
  const none = readSettings([], false)
  const state = (key: string, byDefault: boolean, s = none) => templateState(key, byDefault, o, s)
  assert.deepEqual([state("order.placed", true).enabled, state("cart.abandoned", false).enabled, state("cart.abandoned", false).optional], [true, false, true])
  assert.equal(state("order.canceled", true).allowed, false)
  assert.equal(state("negotiation.accepted", false).enabled, true)
  const s = readSettings([{ key: templateKey(false, "cart.abandoned"), value: { on: true }, updated_by: "user_1", updated_at: new Date() }, { key: templateKey(false, "order.canceled"), value: { on: true } }], false)
  assert.equal(state("cart.abandoned", false, s).enabled, true)
  assert.equal(state("cart.abandoned", false, s).updatedBy, "user_1")
  assert.equal(state("order.canceled", true, s).enabled, false, "the option's false wins")
})
