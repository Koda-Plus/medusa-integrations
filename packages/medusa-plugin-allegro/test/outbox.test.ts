import { test } from "node:test"
import assert from "node:assert/strict"
import { planReservations, type VariantInventory } from "../src/modules/allegro/lib/reservations.ts"
import { allShipped, carriersFromApi, cleanWaybill, hasWaybill, parcelKey, parcelsOf, resolveCarrier, shouldSetStatus, waybillsFromApi } from "../src/modules/allegro/lib/shipping.ts"
import { checkPdf, demoPdf, findExisting, invoiceFilename, invoicesFromApi, parseAttachRequested, parseInvoiceIssued, safeFilename, shouldAttach } from "../src/modules/allegro/lib/invoices.ts"
import { classify, processOutboxItem, type OutboxItem, type OutboxPorts } from "../src/modules/allegro/lib/outbox.ts"

/* ---- reservations ------------------------------------------------- */

const inv = (over: Partial<VariantInventory> = {}): VariantInventory => ({
  variantId: "v1",
  sku: "KS-1",
  manageInventory: true,
  allowBackorder: false,
  items: [
    {
      inventoryItemId: "iitem_1",
      requiredQuantity: 1,
      levels: [
        { locationId: "sloc_a", stocked: 1, reserved: 0 },
        { locationId: "sloc_b", stocked: 10, reserved: 2 },
        { locationId: "sloc_x", stocked: 99, reserved: 0 },
      ],
    },
  ],
  ...over,
})

test("reservations: a location of the channel that has enough, otherwise an oversell with numbers", () => {
  const ok = planReservations([{ lineItemId: "li_1", variantId: "v1", quantity: 2 }], new Map([["v1", inv()]]), ["sloc_a", "sloc_b"])
  assert.deepEqual(ok.problems, [])
  assert.deepEqual(ok.reservations, [{ line_item_id: "li_1", inventory_item_id: "iitem_1", location_id: "sloc_b", quantity: 2, allow_backorder: false }])
  const over = planReservations([{ lineItemId: "li_1", variantId: "v1", quantity: 20 }], new Map([["v1", inv()]]), ["sloc_a", "sloc_b"])
  assert.equal(over.reservations.length, 0)
  assert.match(over.problems[0], /KS-1: Allegro sold 20 and Medusa has 8 available/)
})

test("reservations: backorders reserve anyway, untracked variants need nothing, kits multiply", () => {
  const back = planReservations([{ lineItemId: "li_1", variantId: "v1", quantity: 20 }], new Map([["v1", inv({ allowBackorder: true })]]), ["sloc_a", "sloc_b"])
  assert.deepEqual(back.problems, [])
  assert.equal(back.reservations[0].allow_backorder, true)
  const untracked = planReservations([{ lineItemId: "li_1", variantId: "v1", quantity: 5 }], new Map([["v1", inv({ manageInventory: false })]]), [])
  assert.deepEqual(untracked, { reservations: [], problems: [] })
  const kit = inv({ items: [{ inventoryItemId: "iitem_k", requiredQuantity: 3, levels: [{ locationId: "sloc_a", stocked: 10, reserved: 0 }] }] })
  assert.equal(planReservations([{ lineItemId: "li", variantId: "v1", quantity: 2 }], new Map([["v1", kit]]), ["sloc_a"]).reservations[0].quantity, 6)
})

test("reservations: two lines of one order share the stock, a location outside the channel does not count", () => {
  const twice = planReservations(
    [
      { lineItemId: "li_1", variantId: "v1", quantity: 5 },
      { lineItemId: "li_2", variantId: "v1", quantity: 5 },
    ],
    new Map([["v1", inv()]]),
    ["sloc_b"],
  )
  assert.equal(twice.reservations.length, 1)
  assert.match(twice.problems[0], /Allegro sold 5 and Medusa has 3/)
  const elsewhere = planReservations([{ lineItemId: "li", variantId: "v1", quantity: 1 }], new Map([["v1", inv()]]), ["sloc_z"])
  assert.match(elsewhere.problems[0], /no stock location of the sales channel/)
})

/* ---- shipping ----------------------------------------------------- */

const carriers = carriersFromApi({
  carriers: [
    { id: "INPOST", name: "InPost" },
    { id: "DHL", name: "DHL" },
    { id: "POCZTA_POLSKA", name: "Poczta Polska" },
    { id: "OTHER" },
    { name: "no id" },
  ],
})

test("carriers: the option mapping first, then a shared word, then OTHER with a name", () => {
  assert.equal(carriers.length, 4)
  assert.deepEqual(resolveCarrier("inpost_inpost", carriers, {}), { carrierId: "INPOST", carrierName: null })
  assert.deepEqual(resolveCarrier("dhl-express", carriers, {}), { carrierId: "DHL", carrierName: null })
  assert.deepEqual(resolveCarrier("manual_manual", carriers, {}), { carrierId: "OTHER", carrierName: "Manual" })
  assert.deepEqual(resolveCarrier("manual_manual", carriers, { manual_manual: "POCZTA_POLSKA" }), { carrierId: "POCZTA_POLSKA", carrierName: null })
  assert.deepEqual(resolveCarrier("gls_courier", carriers, { gls: "OTHER" }), { carrierId: "OTHER", carrierName: "Gls" })
})

test("parcels: one per tracking number, with the Allegro lines it carries; a cancelled fulfillment has none", () => {
  const parcels = parcelsOf(
    {
      providerId: "inpost_inpost",
      canceled: false,
      labels: [{ trackingNumber: " 600123 " }, { trackingNumber: "600123" }, { trackingNumber: null }, { trackingNumber: "x".repeat(65) }],
      items: [{ lineItemId: "ordli_1", quantity: 1 }, { lineItemId: "ordli_9", quantity: 1 }],
    },
    new Map([["ordli_1", "allegro-line-1"]]),
    carriers,
    {},
  )
  assert.deepEqual(parcels, [{ waybill: "600123", carrierId: "INPOST", carrierName: null, lineItemIds: ["allegro-line-1"] }])
  assert.deepEqual(parcelsOf({ providerId: "x", canceled: true, labels: [{ trackingNumber: "1" }], items: [] }, new Map(), carriers, {}), [])
  assert.equal(cleanWaybill(""), null)
  assert.equal(parcelKey("F", " ab1 "), "parcel:F:AB1")
})

test("seller status: only forward, never out of a final or manual state", () => {
  assert.equal(shouldSetStatus("NEW", "READY_FOR_SHIPMENT"), true)
  assert.equal(shouldSetStatus("PROCESSING", "SENT"), true)
  assert.equal(shouldSetStatus("SENT", "READY_FOR_SHIPMENT"), false)
  assert.equal(shouldSetStatus("SENT", "SENT"), false)
  for (const s of ["PICKED_UP", "CANCELLED", "SUSPENDED", "RETURNED"]) assert.equal(shouldSetStatus(s, "SENT"), false)
  assert.equal(shouldSetStatus(null, "SENT"), true)
})

test("shipped in full: every Allegro line covered by shipped fulfillments", () => {
  const ordered = new Map([
    ["l1", 2],
    ["l2", 1],
  ])
  assert.equal(allShipped(ordered, new Map([["l1", 2]])), false)
  assert.equal(
    allShipped(
      ordered,
      new Map([
        ["l1", 2],
        ["l2", 1],
      ]),
    ),
    true,
  )
  assert.equal(allShipped(new Map(), new Map()), false)
  const existing = waybillsFromApi({ shipments: [{ id: "s1", waybill: "AB123", carrierId: "DHL" }, { waybill: "" }] })
  assert.equal(existing.length, 1)
  assert.equal(hasWaybill(existing, " ab123"), true)
})

/* ---- invoices ----------------------------------------------------- */

test("invoice events: the 0.2 contract and the 0.1 shape of Fakturownia, malformed ones dropped", () => {
  assert.deepEqual(parseInvoiceIssued({ id: "fkdoc_1", order_id: "order_1", kind: "vat", number: "FV 12/10/2026", external_id: "777", demo: false }), {
    documentId: "fkdoc_1",
    orderId: "order_1",
    kind: "vat",
    number: "FV 12/10/2026",
    externalId: "777",
    demo: false,
  })
  assert.equal(parseInvoiceIssued({ document_id: "fkdoc_2", order_id: "order_1", kind: "VAT", fakturownia_id: 5, demo: true })?.externalId, "5")
  assert.equal(parseInvoiceIssued({ order_id: "order_1", kind: "vat" }), null)
  assert.equal(shouldAttach("VAT", ["vat", "correction"]), true)
  assert.equal(shouldAttach("proforma", ["vat", "correction"]), false)
})

test("invoice by URL: https only, a safe file name", () => {
  assert.equal(parseAttachRequested({ order_id: "o", url: "http://x.example/f.pdf", filename: "f.pdf" }), null)
  assert.equal(parseAttachRequested({ order_id: "o", url: "not a url" }), null)
  const ok = parseAttachRequested({ order_id: "o", url: "https://x.example/f.pdf", filename: "Faktura nr 1/łódź.pdf", number: "FV 1" })
  assert.deepEqual(ok, { orderId: "o", url: "https://x.example/f.pdf", filename: "Faktura_nr_1_lodz.pdf", number: "FV 1" })
  assert.equal(safeFilename(null, "invoice.pdf"), "invoice.pdf")
  assert.equal(invoiceFilename("FV 12/10/2026", "doc"), "FV_12_10_2026.pdf")
})

test("invoice PDF: checked before anything is registered", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 tiny")
  assert.equal(checkPdf(pdf), null)
  assert.equal(checkPdf(new Uint8Array(0)), "empty")
  assert.equal(checkPdf(new TextEncoder().encode("<html>")), "not_pdf")
  assert.equal(checkPdf(new Uint8Array(3 * 1024 * 1024 + 1)), "too_large")
})

test("invoice lookup: the same number (or file name without a number) is already on the order", () => {
  const list = invoicesFromApi({ invoices: [{ id: "i1", invoiceNumber: "FV 12/10/2026", file: { name: "a.pdf" } }, { id: "i2", file: { name: "b.pdf" } }, {}] })
  assert.equal(list.length, 2)
  assert.deepEqual(findExisting(list, "fv 12/10/2026", "x.pdf"), { id: "i1" })
  assert.deepEqual(findExisting(list, null, "B.PDF"), { id: "i2" })
  assert.equal(findExisting(list, "FV 13/10/2026", "a.pdf"), null)
})

/* ---- the outbox state machine -------------------------------------- */

interface Box {
  item: OutboxItem & { claim?: string | null; patch?: Record<string, unknown> }
  remote: boolean
  sends: number
  sendError?: unknown
  lookupError?: unknown
  skip?: string
}

function box(over: Partial<Box> = {}): Box {
  return { item: { id: "algout_1", status: "pending", attempts: 0, payload: { kind: "parcel", waybill: "W1" } }, remote: false, sends: 0, ...over }
}

function outboxPorts(b: Box): OutboxPorts {
  return {
    now: () => new Date("2026-10-06T10:00:00Z"),
    token: () => "t",
    claim: async (item, token) => {
      if (!["pending", "unknown"].includes(b.item.status)) return null
      b.item = { ...b.item, status: "sending", attempts: b.item.attempts + 1, claim: token }
      return b.item
    },
    finish: async (_i, token, patch) => {
      if (b.item.claim !== token) return false
      b.item = { ...b.item, ...(patch as Partial<OutboxItem>), claim: null, patch }
      return true
    },
    lookup: async () => {
      if (b.lookupError) throw b.lookupError
      return b.remote ? { found: true, result: { waybill: "W1" } } : { found: false }
    },
    send: async () => {
      if (b.sendError) throw b.sendError
      if (b.skip) return { kind: "skip", reason: b.skip }
      b.sends += 1
      b.remote = true
      return { kind: "sent", result: { shipmentId: "s1" } }
    },
  }
}

test("outbox: sent once; a repeat finds it on Allegro and adopts it", async () => {
  const b = box()
  assert.deepEqual(await processOutboxItem(b.item, outboxPorts(b)), { kind: "done", adopted: false })
  assert.equal(b.sends, 1)
  b.item = { ...b.item, status: "unknown" }
  assert.deepEqual(await processOutboxItem(b.item, outboxPorts(b)), { kind: "done", adopted: true })
  assert.equal(b.sends, 1)
})

test("outbox: an unclear answer is never retried blindly, it becomes unknown and is looked up first", async () => {
  const b = box({ sendError: Object.assign(new Error("no answer"), { name: "AllegroUnclearError", status: 0 }) })
  const out = await processOutboxItem(b.item, outboxPorts(b))
  assert.equal(out.kind, "unknown")
  assert.equal(b.item.status, "unknown")
  /* The request did reach Allegro after all: the next attempt adopts it. */
  b.remote = true
  b.sendError = undefined
  assert.deepEqual(await processOutboxItem(b.item, outboxPorts(b)), { kind: "done", adopted: true })
  assert.equal(b.sends, 0)
})

test("outbox: transient errors retry with a delay, a 4xx about the item needs a person, attempts run out", async () => {
  const transient = box({ sendError: Object.assign(new Error("Allegro 503"), { status: 503, transient: true }) })
  const t = await processOutboxItem(transient.item, outboxPorts(transient))
  assert.deepEqual([t.kind, (t as { systemic?: boolean }).systemic], ["retry", true])
  assert.ok(transient.item.patch?.next_attempt_at instanceof Date)
  const refused = box({ sendError: Object.assign(new Error("Allegro 400: unknown carrier"), { status: 400 }) })
  assert.equal((await processOutboxItem(refused.item, outboxPorts(refused))).kind, "failed")
  const tired = box({ sendError: Object.assign(new Error("Allegro 503"), { status: 503, transient: true }) })
  tired.item = { ...tired.item, attempts: 6 }
  assert.equal((await processOutboxItem(tired.item, outboxPorts(tired))).kind, "failed")
  const lookup = box({ lookupError: Object.assign(new Error("Allegro 400"), { status: 400 }) })
  assert.equal((await processOutboxItem(lookup.item, outboxPorts(lookup))).kind, "retry")
})

test("outbox: a busy item is left alone; a skip ends it with the reason", async () => {
  const busy = box()
  busy.item = { ...busy.item, status: "sending" }
  assert.deepEqual(await processOutboxItem(busy.item, outboxPorts(busy)), { kind: "busy" })
  const skip = box({ skip: "The order is cancelled on Allegro." })
  assert.equal((await processOutboxItem(skip.item, outboxPorts(skip))).kind, "skipped")
  assert.equal(skip.item.status, "skipped")
  assert.deepEqual(classify(Object.assign(new Error("x"), { name: "AllegroUnclearError" })).unclear, true)
})

test("demo PDF: a valid one page document, ASCII only, with a correct cross-reference table", () => {
  const bytes = demoPdf("Demo invoice FV 1/10/2026 (Łódź)")
  assert.equal(checkPdf(bytes), null)
  const text = new TextDecoder().decode(bytes)
  assert.ok(text.startsWith("%PDF-1.4\n"))
  assert.ok(text.endsWith("%%EOF\n"))
  /* Parentheses inside a PDF string are escaped with a backslash; Polish letters lose their marks. */
  assert.ok(text.includes(String.raw`(Demo invoice FV 1/10/2026 \(Lodz\)) Tj`))
  assert.ok([...text].every((c) => c.charCodeAt(0) < 128))
  /* Every xref entry points at the start of its object, and startxref at the table. */
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)?.[1])
  assert.ok(text.slice(xrefAt).startsWith("xref\n0 6\n"))
  const entries = text.slice(xrefAt).split("\n").slice(3, 8).map((l) => Number(l.slice(0, 10)))
  entries.forEach((offset, i) => assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj\n`), `object ${i + 1}`))
  /* The stream length is the length of the stream. */
  const length = Number(/\/Length (\d+) >>\nstream\n/.exec(text)?.[1])
  const start = text.indexOf("stream\n") + "stream\n".length
  assert.equal(text.indexOf("\nendstream"), start + length)
})
