import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/olx/lib/options.ts"
import {
  advertTitle,
  buildAttributes,
  parseAttributeDefs,
  parseCategory,
  planPublication,
  type CategoryDefinition,
  type PublishCandidate,
} from "../src/modules/olx/lib/publish.ts"
import { capitalShare, checkDescription, checkTitle, hasPhone, htmlToText, repeatedPunctuation } from "../src/modules/olx/lib/validation.ts"

test("text rules: lengths, capitals, punctuation, addresses and phone numbers", () => {
  assert.deepEqual(checkTitle("Kask ochronny"), [{ code: "title_short", detail: "13" }])
  assert.deepEqual(checkTitle("Wiertarko-wkrętarka 18V z dwoma akumulatorami"), [])
  assert.ok(checkTitle("WIERTARKA BOSCH GSR 18V").some((p) => p.code === "title_caps"))
  assert.ok(checkTitle("Okazja!!! Wiertarka 18V tanio").some((p) => p.code === "title_punctuation"))
  assert.equal(repeatedPunctuation("Ceny... od 10 zł"), "...")
  assert.equal(repeatedPunctuation("Rozmiar: 4-5 (S)"), null)
  assert.ok(checkDescription("Krótki opis").some((p) => p.code === "description_short"))
  const long = "Solidna wiertarka do domu i warsztatu, dwa akumulatory, ładowarka i walizka w zestawie. "
  assert.deepEqual(checkDescription(long), [])
  assert.ok(checkDescription(`${long} Pisz na sklep@example.com`).some((p) => p.code === "description_email"))
  assert.ok(checkDescription(`${long} Więcej na www.sklep.pl`).some((p) => p.code === "description_www"))
  assert.ok(checkDescription(`${long} Zadzwoń 600 700 800`).some((p) => p.code === "description_phone"))
  assert.ok(hasPhone("tel. +48 600-700-800"))
  assert.ok(hasPhone("61 123 45 67"))
  assert.equal(hasPhone("EAN 5901234123457"), false, "a 13 digit EAN is not a phone number")
  assert.equal(hasPhone("Wkręty 4x40, op. 1000 szt."), false)
  assert.equal(capitalShare("abc DEF"), 0.5)
})

test("HTML descriptions become plain text", () => {
  assert.equal(htmlToText("<p>Opis&nbsp;produktu</p><ul><li>raz</li><li>dwa &amp; trzy</li></ul>"), "Opis produktu\n- raz\n- dwa & trzy")
  assert.equal(htmlToText(null), "")
})

const rawDefs = [
  {
    code: "state",
    label: "Stan",
    validation: { type: "attribute", required: true, numeric: false, allow_multiple_values: false },
    values: [
      { code: "new", label: "Nowe" },
      { code: "used", label: "Używane" },
    ],
  },
  { code: "brand", label: "Marka", validation: { type: "attribute", required: true }, values: [] },
  { code: "width", label: "Szerokość", unit: "mm", validation: { type: "attribute", required: false, numeric: true, min: 100, max: "400" }, values: [] },
  { code: "colors", label: "Kolory", validation: { type: "attribute", required: false, allow_multiple_values: true }, values: [] },
  { code: "price", label: "Cena", validation: { type: "price", required: true, numeric: true }, values: [] },
  { code: "delivery", label: "Przesyłka", validation: { type: "package", required: false, allow_multiple_values: true }, values: [{ code: "1", label: "InPost" }] },
]

test("category attributes: parsed from either answer shape, numbers read", () => {
  const defs = parseAttributeDefs({ data: rawDefs })
  assert.equal(defs.length, 6)
  assert.equal(defs[2].max, 400)
  assert.equal(defs[5].type, "package")
  assert.deepEqual(parseAttributeDefs(rawDefs).map((d) => d.code), defs.map((d) => d.code))
  assert.deepEqual(parseCategory({ data: { id: 1559, name: "Elektronarzędzia", photos_limit: 8, is_leaf: true } }), {
    id: 1559,
    name: "Elektronarzędzia",
    photosLimit: 8,
    isLeaf: true,
  })
  assert.equal(parseCategory({ data: {} }), null)
})

test("attributes: required ones must be there, values must be allowed, numbers within bounds", () => {
  const defs = parseAttributeDefs(rawDefs)
  const ok = buildAttributes(defs, { state: "new", brand: "Makita", width: "205", colors: ["red", "blue"], unknown: "x" }, true)
  assert.deepEqual(ok.missing, [])
  assert.deepEqual(ok.attributes, [
    { code: "state", value: "new" },
    { code: "brand", value: "Makita" },
    { code: "width", value: "205" },
    { code: "colors", values: ["red", "blue"] },
  ])
  assert.deepEqual(ok.warnings, [{ code: "attribute_unknown", detail: "unknown" }])

  const bad = buildAttributes(defs, { state: "broken", width: "50" }, false)
  assert.deepEqual(
    bad.missing.map((m) => m.code),
    ["attribute_invalid", "attribute_missing", "attribute_invalid", "price"],
  )
  assert.match(bad.missing[0].detail ?? "", /not one of new, used/)
  assert.match(bad.missing[1].detail ?? "", /brand/)
  assert.match(bad.missing[2].detail ?? "", /below 100/)
})

const candidate = (over: Partial<PublishCandidate> = {}): PublishCandidate => ({
  variantId: "variant_1",
  productId: "prod_1",
  sku: "KS-MLT-CIE",
  productTitle: "Młotek ciesielski 600 g",
  variantTitle: "Standard",
  multiVariant: false,
  description: "<p>Młotek ciesielski 600 g z magnetycznym uchwytem gwoździa. Trzonek z włókna szklanego, okładzina antywibracyjna.</p>",
  images: ["https://images.example.com/hammer.jpg", "http://insecure.example.com/a.jpg"],
  price: 79,
  categoryIds: ["pcat_tools"],
  categoryHandles: ["narzedzia"],
  productMetadata: { olx_attributes: { brand: "Koda Supply" } },
  variantMetadata: null,
  ...over,
})

const definitions = new Map<number, CategoryDefinition>([
  [1559, { category: { id: 1559, name: "Narzędzia", photosLimit: 8, isLeaf: true }, attributes: parseAttributeDefs(rawDefs), error: null }],
])

const options = resolveOptions({
  publish: {
    categories: [{ medusaCategory: "narzedzia", olxCategoryId: 1559, attributes: { state: "new" } }],
    location: { cityId: 5659 },
    contact: { name: "Koda Supply", phone: "600700800" },
    descriptionFooter: "Wysyłka w 24 godziny.",
  },
}).publish

test("a complete candidate is ready and carries the exact body of POST /adverts", () => {
  const item = planPublication(candidate(), { options, currency: "PLN", skuLabel: "Kod produktu", definitions })
  assert.equal(item.ready, true, JSON.stringify(item.missing))
  assert.equal(item.olxCategoryId, 1559)
  const p = item.payload as Record<string, unknown>
  assert.equal(p.title, "Młotek ciesielski 600 g")
  assert.equal(p.external_id, "KS-MLT-CIE")
  assert.equal(p.category_id, 1559)
  assert.equal(p.advertiser_type, "business")
  assert.deepEqual(p.location, { city_id: 5659 })
  assert.deepEqual(p.contact, { name: "Koda Supply", phone: "600700800" })
  assert.deepEqual(p.images, [{ url: "https://images.example.com/hammer.jpg" }])
  assert.deepEqual(p.price, { value: 79, currency: "PLN", negotiable: false })
  assert.deepEqual(p.attributes, [
    { code: "state", value: "new" },
    { code: "brand", value: "Koda Supply" },
  ])
  assert.match(String(p.description), /Kod produktu: KS-MLT-CIE/)
  assert.match(String(p.description), /Wysyłka w 24 godziny\.$/)
  assert.ok(item.warnings.some((w) => w.code === "images_not_https"))
})

test("a candidate with gaps is blocked with every reason listed", () => {
  const item = planPublication(
    candidate({ productTitle: "Młotek", description: "Krótko", price: null, productMetadata: null, images: [] }),
    { options: { ...options, location: null }, currency: "PLN", skuLabel: "SKU", definitions },
  )
  assert.equal(item.ready, false)
  assert.equal(item.payload, null)
  const codes = item.missing.map((m) => m.code)
  for (const code of ["location", "price", "title_short", "description_short", "attribute_missing"]) assert.ok(codes.includes(code), code)
  assert.ok(item.warnings.some((w) => w.code === "images_none"))

  const unmapped = planPublication(candidate({ categoryIds: [], categoryHandles: ["other"] }), { options, currency: "PLN", skuLabel: "SKU", definitions })
  assert.deepEqual(unmapped.missing, [{ code: "category" }])

  const unread = planPublication(candidate({ productMetadata: { olx_category_id: 42 } }), { options, currency: "PLN", skuLabel: "SKU", definitions })
  assert.equal(unread.olxCategoryId, 42, "product metadata picks the category")
  assert.ok(unread.missing.some((m) => m.code === "category_unavailable"))
})

test("titles: overrides from metadata, the variant named only when the product has several", () => {
  assert.equal(advertTitle(candidate({ multiVariant: true, variantTitle: "XL" })), "Młotek ciesielski 600 g XL")
  assert.equal(advertTitle(candidate({ productMetadata: { olx_title: "  Młotek  stolarski 600 g " } })), "Młotek stolarski 600 g")
  assert.equal(advertTitle(candidate({ variantMetadata: { olx_title: "Wariant" }, productMetadata: { olx_title: "Produkt" } })), "Wariant")
})
