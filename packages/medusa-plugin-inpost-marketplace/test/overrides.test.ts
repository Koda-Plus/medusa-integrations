/**
 * "Edit offer", the pure parts: an edit is checked against the marketplace's
 * rules before anything is kept (a name of 7 to 150 characters with two
 * words, a description of 100 characters of text, photos over https in a
 * format the marketplace takes, all four package numbers within the parcel
 * limits, 0 to 60 days to ship); null goes back to Medusa; a row with
 * nothing overridden keeps a clean column; overrides win over Medusa in the
 * checks (`offerPatch`), in the proposal and in the list (`offerEditOf`);
 * and a bad value kept by an older version falls back to Medusa's.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { applyOverrides, imageAccepted, isRefusal, mergeOverrides, overriddenFields, overridesOf, parseOverridesPatch, type OverridesPatch } from "../src/modules/vonhalsky/lib/overrides.ts"
import { editPatchOf, patchTouchesContent } from "../src/modules/vonhalsky/lib/offer-payload.ts"
import { offerEditOf } from "../src/modules/vonhalsky/lib/store.ts"
import type { VariantFacts } from "../src/modules/vonhalsky/lib/eligibility.ts"
import { offerPatch, rowProposal } from "../src/workflows/vonhalsky/offers.ts"

const LONG = "Kubek z grubej ceramiki, szkliwiony od środka i z zewnątrz, mieści 300 ml, można go myć w zmywarce i podgrzewać w mikrofalówce."

const refusal = (input: unknown) => {
  const r = parseOverridesPatch(input)
  return isRefusal(r) ? r.code : null
}
const ok = (input: unknown): OverridesPatch => {
  const r = parseOverridesPatch(input)
  if (isRefusal(r)) throw new Error(`${r.code}: ${r.message}`)
  return r
}

test("edit: every field is checked against the marketplace's rules", () => {
  assert.equal(refusal({ title: "Kubek" }), "title_invalid", "one word, too short")
  assert.equal(refusal({ title: "Kubekceramiczny" }), "title_invalid", "one word")
  assert.equal(refusal({ title: `Kubek ${"x".repeat(150)}` }), "title_invalid", "over 150 characters")
  assert.equal(refusal({ description: "Krótko." }), "description_short")
  assert.equal(refusal({ description: `<p>${"<b></b>".repeat(40)}</p>` }), "description_short", "markup alone is no text")
  assert.equal(refusal({ images: [] }), "images_empty")
  assert.equal(refusal({ images: ["http://cdn.example.com/a.jpg"] }), "image_invalid", "https only")
  assert.equal(refusal({ images: ["https://cdn.example.com/a.avif"] }), "image_invalid", "a format the marketplace refuses")
  assert.equal(refusal({ images: ["not a url"] }), "image_invalid")
  assert.equal(refusal({ images: Array.from({ length: 21 }, (_, i) => `https://cdn.example.com/${i}.jpg`) }), "images_too_many")
  assert.equal(refusal({ dimension: { length: 100, width: 100, height: 100 } }), "dimension_invalid", "all four or none")
  assert.equal(refusal({ dimension: { length: 100.5, width: 100, height: 100, weight: 10 } }), "dimension_invalid", "whole numbers")
  assert.equal(refusal({ dimension: { length: 0, width: 100, height: 100, weight: 10 } }), "dimension_invalid", "above 0")
  assert.equal(refusal({ dimension: { length: 1201, width: 10, height: 10, weight: 10 } }), "too_large", "a side over 1200 mm")
  assert.equal(refusal({ dimension: { length: 1000, width: 700, height: 600, weight: 10 } }), "too_large", "2300 mm together")
  assert.equal(refusal({ daysToShip: -1 }), "days_invalid")
  assert.equal(refusal({ daysToShip: 61 }), "days_invalid")
  assert.equal(refusal({ daysToShip: 1.5 }), "days_invalid")
  assert.equal(refusal({ price: 10 }), "unknown_field", "price and stock are not edited here")
  assert.equal(refusal({}), "nothing_to_change")
  assert.equal(refusal(null), "invalid_overrides")
})

test("edit: good values are kept as given, null goes back to Medusa", () => {
  const p = ok({ title: "  Kubek emaliowany niebieski ", description: LONG, images: ["https://cdn.example.com/b.png", "https://cdn.example.com/a.webp", "https://cdn.example.com/b.png"], dimension: { length: 1200, width: 500, height: 500, weight: 350 }, daysToShip: 0, })
  assert.equal(p.set.title, "Kubek emaliowany niebieski")
  assert.deepEqual(p.set.images, ["https://cdn.example.com/b.png", "https://cdn.example.com/a.webp"], "in the given order, once each")
  assert.deepEqual(p.set.dimension, { length: 1200, width: 500, height: 500, weight: 350 })
  assert.equal(p.set.daysToShip, 0, "0 days is a value, not nothing")
  assert.deepEqual(ok({ title: null, images: null }).clear, ["title", "images"])
})

test("edit: merging keeps the other fields, and nothing overridden leaves the column empty", () => {
  const current = { title: "Kubek emaliowany niebieski", daysToShip: 4 }
  assert.deepEqual(mergeOverrides(current, ok({ daysToShip: 1 })), { title: "Kubek emaliowany niebieski", daysToShip: 1 })
  assert.deepEqual(mergeOverrides(current, ok({ title: null })), { daysToShip: 4 })
  assert.equal(mergeOverrides(current, ok({ title: null, daysToShip: null })), null)
})

test("edit: a stored value that breaks a rule falls back to Medusa", () => {
  assert.deepEqual(overridesOf({ title: "Kubek", images: ["https://cdn.example.com/a.svg", "https://cdn.example.com/a.jpg"], dimension: { length: 1300, width: 1, height: 1, weight: 1 }, daysToShip: 99, other: 1 }), { images: ["https://cdn.example.com/a.jpg"] })
  assert.deepEqual(overridesOf("nonsense"), {})
  assert.deepEqual(overriddenFields({ daysToShip: 0, title: "Kubek emaliowany niebieski" }), ["title", "daysToShip"], "in the order of the form")
})

test("edit: the photo format filter is the one of the catalog", async () => {
  const catalog = await import("../src/workflows/vonhalsky/catalog.ts")
  assert.equal(catalog.imageAccepted, imageAccepted)
  assert.equal(imageAccepted("https://cdn.example.com/a.HEIC"), false)
  assert.equal(imageAccepted("https://cdn.example.com/a.gif?v=1"), true)
})

const facts = (over: Partial<VariantFacts> = {}): VariantFacts => ({
  variantId: "variant_1",
  productId: "prod_1",
  sku: "KS-OFF-MUG",
  title: "Kubek ceramiczny biały",
  thumbnail: null,
  images: ["https://cdn.example.com/mug.jpg"],
  description: "Kubek.",
  productStatus: "published",
  ean: "5901234123457",
  brand: "Koda Plus",
  mpn: "MUG-300",
  manufacturer: { name: "Koda Plus sp. z o.o.", email: "gpsr@example.com", address: null, phone: null },
  gpsrSource: "metadata",
  gpsrExempt: false,
  categoryIds: [],
  dimension: { width: 1300, height: 100, length: 100, weight: 350 },
  vatRate: null,
  basePriceMinor: 4999,
  stock: 3,
  ...over,
})
const LEAF = { id: "leaf-1", source: "map" as const, info: { path: "Dom > Kubki", leaf: true, gpsrFree: false, required: [] } }
const PRICING = { includesTax: true, vatRate: 23, markupPercent: 0 }

test("edit: overrides win over Medusa in the checks that block a listing", () => {
  const medusaOnly = offerPatch(facts(), { status: "draft" }, PRICING, false, LEAF)
  assert.deepEqual(medusaOnly.reasons, ["description_short", "too_large"])
  const edited = offerPatch(facts(), { status: "draft", overrides: { title: "Kubek emaliowany niebieski", description: LONG, dimension: { length: 120, width: 90, height: 100, weight: 400 } } }, PRICING, false, LEAF)
  assert.deepEqual(edited.reasons, [])
  assert.equal(edited.status, "draft")
  assert.equal(edited.title, "Kubek emaliowany niebieski", "the row carries the name that is sent")
  const noPhotos = offerPatch(facts({ images: [] }), { status: "draft", overrides: { description: LONG, images: ["https://cdn.example.com/new.jpg"], dimension: { length: 120, width: 90, height: 100, weight: 400 } } }, PRICING, false, LEAF)
  assert.deepEqual(noPhotos.reasons, [], "a photo set in the edit is a photo")
})

test("edit: the proposal carries the edits, the patch only what an edit may change", () => {
  const row = { variant_id: "variant_1", title: "Kubek emaliowany niebieski", sku: "KS-OFF-MUG", ean: "5901234123457", brand: "Koda Plus", mpn: null, price_minor: 6149, stock: 3, category_id: "leaf-1", attributes: [{ id: "a1", values: ["biały"] }], overrides: { title: "Kubek emaliowany niebieski", description: LONG, images: ["https://cdn.example.com/2.jpg", "https://cdn.example.com/1.jpg"], dimension: { length: 120, width: 90, height: 100, weight: 400 }, daysToShip: 7 } }
  const p = rowProposal(row, facts(), false, { daysToShip: 2, returnPolicy: "", complaintPolicy: "" }, 23)
  assert.equal(p.product.name, "Kubek emaliowany niebieski")
  assert.equal(p.product.description, LONG)
  assert.deepEqual(p.images.map((i) => [i.fileUrl, i.priority]), [["https://cdn.example.com/2.jpg", 1], ["https://cdn.example.com/1.jpg", 2]])
  assert.deepEqual(p.product.dimension, { width: 90, height: 100, length: 120, weight: 400 })
  assert.equal(p.shippingTime.daysToShip, 7, "the offer's own days win over the defaults")
  const patch = editPatchOf(p)
  assert.deepEqual(Object.keys(patch).sort(), ["images", "product", "shippingTime"])
  assert.deepEqual(Object.keys(patch.product ?? {}).sort(), ["attributes", "categoryId", "description", "dimension", "name"])
  assert.equal(patchTouchesContent(patch), true)
  assert.equal(patchTouchesContent({ price: p.price, stock: p.stock }), false)
  const defaults = rowProposal({ ...row, overrides: null }, facts(), false, { daysToShip: 2, returnPolicy: "", complaintPolicy: "" }, 23)
  assert.equal(defaults.shippingTime.daysToShip, 2)
})

test("edit: the list shows what is set, what Medusa gives and what the marketplace gets", () => {
  const medusa = { title: "Kubek ceramiczny biały", description: `<p>${LONG}</p>`, images: ["https://cdn.example.com/mug.jpg"], dimension: { width: 90, height: 100, length: 120, weight: 350 } }
  const v = offerEditOf({ title: "Kubek emaliowany niebieski", daysToShip: 0 }, medusa, 2)
  assert.deepEqual(v.overridden, ["title", "daysToShip"])
  assert.equal(v.medusa?.description, LONG, "Medusa's description as the plain text the marketplace gets")
  assert.deepEqual(v.effective, { title: "Kubek emaliowany niebieski", description: LONG, images: ["https://cdn.example.com/mug.jpg"], dimension: { width: 90, height: 100, length: 120, weight: 350 }, daysToShip: 0 })
  const unread = offerEditOf({ title: "Kubek emaliowany niebieski" }, null, 2)
  assert.equal(unread.medusa, null)
  assert.equal(unread.effective, null, "without Medusa's side the effective values are not guessed")
  assert.equal(unread.overrides.title, "Kubek emaliowany niebieski")
  assert.deepEqual(applyOverrides({ title: "A b c d e f", description: null, images: [], dimension: null }, {}), { title: "A b c d e f", description: null, images: [], dimension: null })
})
