import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildOrderPayload, normalizeEan, normalizeSku, pickupPoint, PayloadError, type OrderRecord } from "../src/modules/subiekt/lib/order-payload.ts"
import { paymentState } from "../src/modules/subiekt/lib/payment.ts"
import { DEFAULT_COD_PROVIDERS, DEFAULT_NIP_SOURCES, DEFAULT_PREPAID_PROVIDERS, TAX_ID_METADATA_KEYS } from "../src/modules/subiekt/lib/constants.ts"

const example = JSON.parse(readFileSync(new URL("../contract/examples/order-create.request.json", import.meta.url), "utf8"))

const address = {
  first_name: "Anna",
  last_name: "Nowak",
  company: "",
  address_1: "ul. Przykładowa 12/3",
  address_2: null,
  postal_code: "60-101",
  city: "Poznań",
  province: null,
  country_code: "PL",
  phone: "+48 600 000 000",
}

/** What query.graph returns for the example order, with the usual Medusa quirks. */
const order: OrderRecord = {
  id: "order_01JDEMO0000000000000000001",
  display_id: 1042,
  email: "anna.nowak@example.com",
  currency_code: "PLN",
  created_at: new Date("2026-10-04T09:15:00.000Z"),
  metadata: { customer_note: "  Proszę o próbkę kremu pod oczy. ", internal: "x" },
  total: { numeric: 244.29 },
  item_total: 229.3,
  shipping_total: "14.99",
  discount_total: 5.5,
  tax_total: 45.68,
  customer: { id: "cus_01JDEMO0000000000000000001", first_name: "Anna", last_name: "Nowak", company_name: null, phone: "+48 600 000 000" },
  shipping_address: address,
  billing_address: address,
  items: [
    {
      id: "ordli_01JDEMO0000000000000000001",
      title: "Krem nawilżający",
      product_title: "Krem nawilżający",
      variant_title: "50 ml",
      variant_sku: "KR-050",
      variant_barcode: "5901234123457",
      quantity: 2,
      unit_price: 89.9,
      total: { numeric: 179.8 },
      discount_total: 0,
      tax_lines: [{ rate: 23 }],
    },
    {
      id: "ordli_01JDEMO0000000000000000002",
      title: "Tonik łagodzący",
      product_title: "Tonik łagodzący",
      variant_title: "200 ml",
      variant_sku: "TN-200-wh",
      variant_barcode: null,
      variant: { ean: "590-1234-123464" },
      quantity: 1,
      unit_price: 55,
      total: "49.5",
      discount_total: 5.5,
      tax_lines: [{ rate: 23 }],
    },
  ],
  shipping_methods: [
    {
      name: "Paczkomat InPost",
      shipping_option_id: "so_01JDEMO0000000000000000001",
      amount: 14.99,
      total: 14.99,
      tax_lines: [{ rate: 23 }],
      data: { target_point: { id: "POZ08M", name: "Paczkomat POZ08M", address: { line1: "ul. Głogowska 1", line2: "60-101 Poznań" } } },
    },
  ],
}

const options = { stripSkuSuffixes: ["-WH"], omitLinesWithoutCode: false, forwardMetadataKeys: [], taxIdMetadataKeys: TAX_ID_METADATA_KEYS }

const captured = paymentState({
  collections: [{ status: "completed", payments: [{ provider_id: "pp_stripe_stripe", amount: 244.29, captured_at: "2026-10-04T09:15:04.000Z" }] }],
  totalGross: 244.29,
  prepaidProviders: DEFAULT_PREPAID_PROVIDERS,
  codProviders: DEFAULT_COD_PROVIDERS,
})

test("the example order of the contract is exactly what the plugin sends", () => {
  const { payload, omitted } = buildOrderPayload(order, captured, options)
  assert.deepEqual(omitted, [])
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), example)
})

test("a buyer with a NIP in metadata asks for an invoice", () => {
  const { payload } = buildOrderPayload(
    { ...order, metadata: { nip: "PL 123-456-32-18" }, billing_address: { ...address, company: "Salon Ania" } },
    captured,
    options,
  )
  assert.deepEqual(payload.invoice, { requested: true, tax_id: "PL 123-456-32-18", company_name: "Salon Ania" })
})

test("a valid NIP sends the buyer block, an invalid one sends a warning and the retail buyer", () => {
  const b2b = buildOrderPayload(
    { ...order, metadata: {}, billing_address: { ...address, company: "Salon Ania sp. z o.o., NIP 123-456-32-18" } },
    captured,
    { ...options, nipSources: DEFAULT_NIP_SOURCES, createContractors: true },
  )
  assert.equal(b2b.buyerNip, "1234563218")
  assert.deepEqual(b2b.warnings, [])
  assert.equal(b2b.payload.buyer?.nip, "1234563218")
  assert.equal(b2b.payload.buyer?.company_name, "Salon Ania sp. z o.o.")
  assert.equal(b2b.payload.buyer?.address?.address_1, "ul. Przykładowa 12/3")
  assert.equal(b2b.payload.buyer?.email, "anna.nowak@example.com")
  assert.equal(b2b.payload.buyer?.create_if_missing, true)

  const wrong = buildOrderPayload({ ...order, metadata: { nip: "123-456-32-19" } }, captured, { ...options, nipSources: DEFAULT_NIP_SOURCES })
  assert.equal(wrong.payload.buyer, null)
  assert.equal(wrong.buyerNip, null)
  assert.match(wrong.warnings[0], /123-456-32-19.*not a valid NIP/)

  const off = buildOrderPayload({ ...order, metadata: { nip: "1234563218" } }, captured, { ...options, nipSources: [] })
  assert.equal(off.payload.buyer, null)
})

test("forwarded metadata keys pass through, others stay home", () => {
  const { payload } = buildOrderPayload(order, captured, { ...options, forwardMetadataKeys: ["internal", "absent"] })
  assert.deepEqual(payload.metadata, { internal: "x" })
})

test("lines without any code fail the order, or are left off with a note when allowed", () => {
  const noCode = { ...order, items: [...order.items!, { id: "ordli_3", title: "Szkolenie online", quantity: 1, unit_price: 100, total: 100 }] }
  const strict = buildOrderPayload(noCode, captured, options)
  assert.equal(strict.payload.lines.length, 3)
  assert.equal(strict.payload.lines[2].sku, null)

  const lenient = buildOrderPayload(noCode, captured, { ...options, omitLinesWithoutCode: true })
  assert.equal(lenient.payload.lines.length, 2)
  assert.deepEqual(lenient.omitted, [{ line_id: "ordli_3", title: "Szkolenie online" }])
  assert.match(lenient.payload.note ?? "", /Szkolenie online/)

  assert.throws(
    () =>
      buildOrderPayload({ ...order, items: [{ id: "x", title: "Bez kodu", quantity: 1, total: 10 }] }, captured, {
        ...options,
        omitLinesWithoutCode: true,
      }),
    (err: unknown) => err instanceof PayloadError && err.code === "no_lines" && err.retryable === false,
  )
})

test("unit prices keep four decimals so odd totals survive the division", () => {
  const { payload } = buildOrderPayload({ ...order, items: [{ id: "l1", variant_sku: "A-1", quantity: 3, unit_price: 33.34, total: 100 }] }, captured, options)
  assert.equal(payload.lines[0].unit_price_gross, 33.3333)
  assert.equal(payload.lines[0].total_gross, 100)
})

test("zero-quantity lines from order edits are skipped", () => {
  const { payload } = buildOrderPayload({ ...order, items: [{ ...order.items![0], quantity: 0 }, order.items![1]] }, captured, options)
  assert.deepEqual(
    payload.lines.map((l) => l.line_id),
    ["ordli_01JDEMO0000000000000000002"],
  )
})

test("codes are normalized the same way everywhere", () => {
  assert.equal(normalizeEan(" 5901234123457 "), "5901234123457")
  assert.equal(normalizeEan("590 1234 123457"), "5901234123457")
  assert.equal(normalizeEan("ABC123"), null)
  assert.equal(normalizeEan("1234567"), null)
  assert.equal(normalizeSku("  myc-001-WH ", ["-WH"]), "myc-001")
  assert.equal(normalizeSku("-WH", ["-WH"]), "-WH")
  assert.equal(normalizeSku("   ", []), null)
})

test("pickup points are found under the usual keys", () => {
  assert.deepEqual(pickupPoint({ locker_id: "KRA01A" }), { id: "KRA01A", name: null, address: null })
  assert.deepEqual(pickupPoint({ pickup_point: { code: "WAW22", address: "Marszałkowska 1" } }), { id: "WAW22", name: null, address: "Marszałkowska 1" })
  assert.equal(pickupPoint({ carrier: "dpd" }), null)
  assert.equal(pickupPoint(null), null)
})
