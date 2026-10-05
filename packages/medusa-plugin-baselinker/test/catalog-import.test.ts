import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildImportGroups,
  manufacturerTagIds,
  planCatalogImport,
  slugify,
  tagManufacturer,
  toBaseLinkerPrice,
  toMedusaPrice,
  toMedusaWeight,
  type ImportGroup,
  type ImportPlanInput,
  type MedusaProductLite,
  type MedusaVariantLite,
} from "../src/modules/baselinker/lib/catalog-import.ts"
import { parseProductsData } from "../src/modules/baselinker/lib/catalog.ts"

const opts = { taxInclusive: true, priceGroup: true, createMissingCategories: false, draftRemoved: false, weightUnit: "g" as const, optionTitle: "Variant" }

function group(over: Partial<ImportGroup> & { blId: string }): ImportGroup {
  return {
    name: "Opona zimowa",
    description: "Opis",
    images: ["https://cdn.example.com/a.jpg"],
    weightKg: 8.5,
    category: "Opony",
    manufacturer: "Dębica",
    isBundle: false,
    hasVariants: false,
    taxRate: 23,
    units: [{ blId: over.blId, sku: `SKU-${over.blId}`, ean: null, name: "Opona zimowa", price: 300 }],
    ...over,
  }
}

function input(over: Partial<ImportPlanInput>): ImportPlanInput {
  return {
    groups: [],
    complete: true,
    variants: [],
    products: [],
    links: new Map(),
    categories: new Map([["opony", "pcat_1"]]),
    options: opts,
    ...over,
  }
}

const product = (over: Partial<MedusaProductLite> & { id: string }): MedusaProductLite => ({
  title: "Opona zimowa",
  handle: "opona-zimowa",
  description: "Opis",
  status: "published",
  images: ["https://cdn.example.com/a.jpg"],
  categoryIds: ["pcat_1"],
  categoryNames: ["Opony"],
  manufacturer: "Dębica",
  blProductId: null,
  options: [],
  ...over,
})

const variant = (over: Partial<MedusaVariantLite> & { id: string; productId: string }): MedusaVariantLite => ({
  sku: null,
  ean: null,
  title: "Default variant",
  weight: 8500,
  price: 300,
  ...over,
})

test("an incomplete read plans nothing", () => {
  const plan = planCatalogImport(input({ complete: false, groups: [group({ blId: "1" })] }))
  assert.equal(plan.skipped, "incomplete_read")
  assert.equal(plan.items.length, 0)
})

test("a product only in BaseLinker is created with its price, images, weight, category and manufacturer", () => {
  const plan = planCatalogImport(input({ groups: [group({ blId: "11" })] }))
  assert.equal(plan.stats.create, 1)
  const item = plan.items[0]
  assert.equal(item.action, "create")
  assert.equal(item.key, "bl:11")
  assert.equal(item.create?.handle, "opona-zimowa")
  assert.equal(item.create?.optionTitle, null, "one variant: no option of ours")
  assert.deepEqual(item.create?.variants[0], { blId: "11", title: "Opona zimowa", sku: "SKU-11", ean: null, weight: 8500, price: 300, optionValue: null })
  assert.deepEqual(item.create?.category, { id: "pcat_1", name: "Opony" })
  assert.equal(item.create?.manufacturer, "Dębica")
})

test("a product with variants gets one option with unique values", () => {
  const g = group({
    blId: "20",
    name: "Rękawice",
    hasVariants: true,
    units: [
      { blId: "21", sku: "R-M", ean: null, name: "M", price: 19.9 },
      { blId: "22", sku: "R-L", ean: null, name: "M", price: 19.9 },
    ],
  })
  const item = planCatalogImport(input({ groups: [g] })).items[0]
  assert.equal(item.create?.optionTitle, "Variant")
  assert.deepEqual(
    item.create?.variants.map((v) => v.optionValue),
    ["M", "M (R-L)"],
    "a clash gets the SKU, never two equal values",
  )
})

test("duplicates are conflicts, never imported: a SKU on two cards, an EAN on two cards", () => {
  const plan = planCatalogImport(
    input({
      groups: [
        group({ blId: "1", units: [{ blId: "1", sku: "op-1", ean: null, name: "A", price: 1 }] }),
        group({ blId: "2", units: [{ blId: "2", sku: "OP-1 ", ean: null, name: "B", price: 1 }] }),
        group({ blId: "3", units: [{ blId: "3", sku: "E-1", ean: "5901234123457", name: "C", price: 1 }] }),
        group({ blId: "4", units: [{ blId: "4", sku: "E-2", ean: "590-1234-123457", name: "D", price: 1 }] }),
      ],
    }),
  )
  assert.equal(plan.stats.duplicateSku, 2)
  assert.equal(plan.stats.duplicateEan, 2)
  assert.equal(plan.stats.create, 0)
  assert.ok(plan.items.every((i) => i.action === "conflict"))
})

test("bundles and units without a SKU are skipped with the reason", () => {
  const plan = planCatalogImport(
    input({
      groups: [
        group({ blId: "1", isBundle: true }),
        group({ blId: "2", units: [{ blId: "2", sku: "", ean: null, name: "X", price: 1 }] }),
      ],
    }),
  )
  assert.deepEqual(
    plan.items.map((i) => [i.action, i.reason]),
    [
      ["skip", "bundle"],
      ["skip", "no_sku"],
    ],
  )
})

test("a linked product is updated field by field: title, price, EAN, weight; unchanged fields stay out", () => {
  const plan = planCatalogImport(
    input({
      groups: [group({ blId: "5", name: "Opona zimowa 205/55", units: [{ blId: "5", sku: "SKU-5", ean: "5901234123457", name: "x", price: 320 }] })],
      products: [product({ id: "prod_5" })],
      variants: [variant({ id: "var_5", productId: "prod_5", sku: "SKU-5", ean: null, weight: 8000, price: 300 })],
    }),
  )
  assert.equal(plan.stats.update, 1)
  const item = plan.items[0]
  assert.equal(item.action, "update")
  assert.deepEqual(
    item.changes.map((c) => [c.field, c.from, c.to]),
    [
      ["title", "Opona zimowa", "Opona zimowa 205/55"],
      ["ean:SKU-5", null, "5901234123457"],
      ["weight:SKU-5", 8000, 8500],
      ["price:SKU-5", 300, 320],
    ],
  )
  assert.deepEqual(item.update?.variants, [{ variantId: "var_5", ean: "5901234123457", weight: 8500, price: 320 }])
})

test("nothing to change is counted, not stored", () => {
  const plan = planCatalogImport(
    input({
      groups: [group({ blId: "6", units: [{ blId: "6", sku: "SKU-6", ean: null, name: "x", price: 300 }] })],
      products: [product({ id: "prod_6" })],
      variants: [variant({ id: "var_6", productId: "prod_6", sku: "sku-6" })],
    }),
  )
  assert.equal(plan.items.length, 0)
  assert.equal(plan.stats.unchanged, 1)
})

test("net Medusa prices: the gross BaseLinker price is divided by the VAT rate; without a rate it is left out", () => {
  assert.equal(toMedusaPrice(123, 23, false), 100)
  assert.equal(toMedusaPrice(100, -1, false), 100, "exempt counts as 0 %")
  assert.equal(toMedusaPrice(123, null, false), null)
  assert.equal(toMedusaPrice(123, null, true), 123)
  assert.equal(toBaseLinkerPrice(100, 23, false), 123)
  const plan = planCatalogImport(
    input({
      options: { ...opts, taxInclusive: false },
      groups: [group({ blId: "7", taxRate: null }), group({ blId: "8", units: [{ blId: "8", sku: "SKU-8", ean: null, name: "y", price: 246 }] })],
    }),
  )
  const byKey = new Map(plan.items.map((i) => [i.key, i]))
  assert.equal(byKey.get("bl:7")?.create?.variants[0].price, null)
  assert.equal(byKey.get("bl:8")?.create?.variants[0].price, 200)
  assert.equal(plan.stats.netWithoutRate, 1)
})

test("a SKU used by two Medusa variants and variants spread over two Medusa products are conflicts", () => {
  const plan = planCatalogImport(
    input({
      groups: [
        group({ blId: "1", units: [{ blId: "1", sku: "TWICE", ean: null, name: "a", price: 1 }] }),
        group({
          blId: "2",
          hasVariants: true,
          units: [
            { blId: "21", sku: "S-1", ean: null, name: "a", price: 1 },
            { blId: "22", sku: "S-2", ean: null, name: "b", price: 1 },
          ],
        }),
      ],
      products: [product({ id: "p1" }), product({ id: "p2" })],
      variants: [
        variant({ id: "v1", productId: "p1", sku: "TWICE" }),
        variant({ id: "v2", productId: "p2", sku: "twice" }),
        variant({ id: "v3", productId: "p1", sku: "S-1" }),
        variant({ id: "v4", productId: "p2", sku: "S-2" }),
      ],
    }),
  )
  assert.deepEqual(
    plan.items.map((i) => i.reason),
    ["ambiguous_variant", "split_product"],
  )
})

test("a new BaseLinker variant of an imported product adds the option value; of a foreign product it is only reported", () => {
  const g = group({
    blId: "30",
    name: "Rękawice",
    hasVariants: true,
    units: [
      { blId: "31", sku: "R-M", ean: null, name: "M", price: 19.9 },
      { blId: "32", sku: "R-XL", ean: null, name: "XL", price: 21 },
    ],
  })
  const ours = product({ id: "p30", title: "Rękawice", blProductId: "30", options: [{ id: "opt_1", title: "Variant", values: ["M"] }] })
  const v = variant({ id: "v31", productId: "p30", sku: "R-M", title: "M", price: 19.9 })
  const plan = planCatalogImport(input({ groups: [g], products: [ours], variants: [v] }))
  const item = plan.items[0]
  assert.equal(item.action, "update")
  assert.deepEqual(item.update?.option, { id: "opt_1", title: "Variant", values: ["M", "XL"] })
  assert.equal(item.update?.newVariants[0].sku, "R-XL")

  const foreign = planCatalogImport(input({ groups: [g], products: [{ ...ours, blProductId: null }], variants: [v] }))
  assert.equal(foreign.items[0].action, "skip")
  assert.equal(foreign.items[0].reason, "new_variant_needs_options")
})

test("an imported product removed in BaseLinker: reported, or a draft when the option says so; never deleted", () => {
  const gone = product({ id: "p9", blProductId: "999" })
  const reported = planCatalogImport(input({ products: [gone] }))
  assert.equal(reported.items[0].action, "skip")
  assert.equal(reported.items[0].reason, "removed_in_baselinker")
  const drafted = planCatalogImport(input({ products: [gone], options: { ...opts, draftRemoved: true } }))
  assert.equal(drafted.items[0].action, "draft")
  assert.deepEqual(drafted.items[0].changes, [{ field: "status", from: "published", to: "draft" }])
  const alreadyDraft = planCatalogImport(input({ products: [{ ...gone, status: "draft" }], options: { ...opts, draftRemoved: true } }))
  assert.equal(alreadyDraft.items.length, 0)
})

test("handles: ASCII from Polish names, a taken handle gets the BaseLinker id", () => {
  assert.equal(slugify("Łańcuch śniegowy Żółty 205/55 R16"), "lancuch-sniegowy-zolty-205-55-r16")
  const plan = planCatalogImport(input({ groups: [group({ blId: "77" })], products: [product({ id: "other", handle: "opona-zimowa", blProductId: "1" })] }))
  const create = plan.items.find((i) => i.action === "create")
  assert.equal(create?.create?.handle, "opona-zimowa-77")
  assert.equal(toMedusaWeight(0.25, "g"), 250)
  assert.equal(toMedusaWeight(0.25, "kg"), 0.25)
  assert.equal(toMedusaWeight(0, "g"), null)
})

test("categories: an existing one is linked, a missing one is reported unless creating is allowed", () => {
  const missing = planCatalogImport(input({ groups: [group({ blId: "1", category: "Felgi" })] }))
  assert.equal(missing.items[0].create?.category, null)
  assert.equal(missing.items[0].reason, "category_missing")
  const created = planCatalogImport(input({ groups: [group({ blId: "1", category: "Felgi" })], options: { ...opts, createMissingCategories: true } }))
  assert.deepEqual(created.items[0].create?.category, { id: null, name: "Felgi" })
  assert.ok(created.items[0].changes.some((c) => c.field === "category_new"))
})

test("manufacturer as a tag: only a tag naming a BaseLinker manufacturer counts, and a change keeps the store's own tags", () => {
  const known = new Set(["dębica", "michelin"])
  const tags = [
    { id: "ptag_sale", value: "sale" },
    { id: "ptag_debica", value: "Dębica" },
    { id: "ptag_summer", value: "summer" },
  ]
  assert.equal(tagManufacturer(tags, known), "Dębica", "the tag that names a manufacturer, not the first tag")
  assert.equal(tagManufacturer([{ value: "sale" }], known), null, "a store tag is never taken for a manufacturer")
  assert.equal(tagManufacturer(tags, new Set()), null, "without BaseLinker's list nothing is guessed")
  assert.deepEqual(manufacturerTagIds(tags, known, "ptag_michelin"), ["ptag_sale", "ptag_summer", "ptag_michelin"])
  assert.deepEqual(manufacturerTagIds([{ id: "ptag_sale", value: "sale" }], known, "ptag_sale"), ["ptag_sale"], "never a tag twice")
})

test("details of getInventoryProductsData become groups: variants sell, a simple product sells itself", () => {
  const details = parseProductsData({
    "100": {
      is_bundle: false,
      sku: "",
      ean: "",
      tax_rate: 23,
      weight: 0.3,
      category_id: 5,
      manufacturer_id: 7,
      prices: { "105": 10 },
      text_fields: { name: "Koszulka", description: "Bawełna", "name|de": "T-Shirt" },
      images: { "2": "https://cdn.example.com/2.jpg", "1": "https://cdn.example.com/1.jpg", "1|amazon_0": "https://cdn.example.com/amz.jpg" },
      variants: { "102": { name: "XL", sku: "K-XL", ean: "", prices: { "105": 12 } }, "101": { name: "M", sku: "K-M", ean: "", prices: { "105": 11 } } },
    },
    "200": { is_bundle: true, sku: "SET", text_fields: { name: "Zestaw" }, prices: { "105": 99 } },
  })
  const groups = buildImportGroups(details, { priceGroupId: 105, categories: new Map([[5, { name: "Odzież" }]]), manufacturers: new Map([[7, "Koda"]]) })
  assert.equal(groups.length, 2)
  const shirt = groups[0]
  assert.equal(shirt.name, "Koszulka")
  assert.deepEqual(shirt.images, ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"])
  assert.equal(shirt.category, "Odzież")
  assert.equal(shirt.manufacturer, "Koda")
  assert.deepEqual(
    shirt.units.map((u) => [u.blId, u.sku, u.price]),
    [
      ["101", "K-M", 11],
      ["102", "K-XL", 12],
    ],
  )
  assert.equal(groups[1].isBundle, true)
  assert.deepEqual(groups[1].units, [{ blId: "200", sku: "SET", ean: null, name: "Zestaw", price: 99 }])
})
