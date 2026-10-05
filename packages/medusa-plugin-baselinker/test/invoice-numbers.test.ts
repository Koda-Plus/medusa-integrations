import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { acceptDocument, decideInvoiceWrite, fieldValue, parseDocumentIssued } from "../src/modules/baselinker/lib/invoice-numbers.ts"
import { processDueInvoices, recordInvoiceDocument, retryInvoice } from "../src/workflows/baselinker/invoices.ts"
import { setArm } from "../src/workflows/baselinker/settings.ts"
import { fakeContainer, fakeService, scriptedBaseLinker, silentEvents, type Row } from "./fakes.ts"

test("the event: cleaned, kinds filtered, a simulated document never reaches a real account", () => {
  const doc = parseDocumentIssued({ id: "fdoc_1", order_id: "order_1", kind: "VAT", number: " FV 12/10/2026 ", external_id: 991, demo: false })
  assert.deepEqual(doc, { id: "fdoc_1", order_id: "order_1", kind: "vat", number: "FV 12/10/2026", external_id: "991", demo: false })
  assert.equal(parseDocumentIssued({ id: "x" }), null)
  assert.deepEqual(acceptDocument(doc!, { kinds: ["vat"], demo: false }), { accept: true })
  assert.deepEqual(acceptDocument({ ...doc!, kind: "proforma" }, { kinds: ["vat"], demo: false }), { accept: false, reason: "kind" })
  assert.deepEqual(acceptDocument({ ...doc!, number: null }, { kinds: ["vat"], demo: false }), { accept: false, reason: "no_number" })
  assert.deepEqual(acceptDocument({ ...doc!, demo: true }, { kinds: ["vat"], demo: false }), { accept: false, reason: "demo_event_live" })
})

test("the field: read before writing; empty writes, the same number adopts, another value is a conflict", () => {
  const order = { extra_field_1: "", extra_field_2: "FV 1/2026", custom_extra_fields: { "135": "FV 2/2026" } }
  assert.equal(fieldValue(order, "extra_field_1"), null)
  assert.equal(fieldValue(order, "extra_field_2"), "FV 1/2026")
  assert.equal(fieldValue(order, "custom:135"), "FV 2/2026")
  assert.equal(decideInvoiceWrite(null, "FV 1/2026", "extra_field_1"), "write")
  assert.equal(decideInvoiceWrite("fv 1/2026", "FV 1/2026", "extra_field_1"), "adopt")
  assert.equal(decideInvoiceWrite("FV 9/2026", "FV 1/2026", "extra_field_1"), "conflict")
  assert.equal(decideInvoiceWrite(null, "X".repeat(51), "extra_field_1"), "too_long")
  assert.equal(decideInvoiceWrite(null, "X".repeat(51), "custom:135"), "write")
})

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

const live = { apiToken: "t0ken-t0ken-t0ken", inventoryId: 1, orderStatusId: 1, warehouseId: "bl_1" }
const actor = { id: "user_1", label: "anna@example.com" }

function setup(options: Row, held: Row[]) {
  const bl = scriptedBaseLinker({
    getOrders: (p) => {
      assert.equal(p.include_custom_extra_fields, true)
      return { orders: held.filter((o) => o.order_id === p.order_id) }
    },
    setOrderFields: (p) => {
      const o = held.find((x) => x.order_id === p.order_id) as Row
      Object.assign(o, p)
      return {}
    },
  })
  restore = bl.restore
  const s = fakeService(options)
  const { events, bus } = silentEvents()
  return { bl, s, events, container: fakeContainer({ baselinker: s.svc, event_bus: bus }) }
}

test("exactly once: queued per document, written only when armed, adopted when already there, conflicts left to a person", async () => {
  const held = [
    { order_id: 501, extra_field_1: "" },
    { order_id: 502, extra_field_1: "FV 7/2026" },
    { order_id: 503, extra_field_1: "Inny numer" },
  ]
  const t = setup(live, held)
  t.s.table("Orders").create({ order_id: "order_1", bl_order_id: "501", status: "sent", demo: false, display_id: 1 })
  t.s.table("Orders").create({ order_id: "order_2", bl_order_id: "502", status: "sent", demo: false, display_id: 2 })
  t.s.table("Imports").create({ order_id: "order_3", bl_order_id: "503", status: "imported", source: "allegro", demo: false, display_id: 3 })
  t.s.table("Orders").create({ order_id: "order_4", bl_order_id: null, status: "pending", demo: false, display_id: 4 })
  const doc = (id: string, orderId: string, number: string) => ({ id, order_id: orderId, kind: "vat", number, external_id: id, demo: false })
  assert.equal(await recordInvoiceDocument(t.container, doc("d1", "order_1", "FV 6/2026")), "queued")
  assert.equal(await recordInvoiceDocument(t.container, doc("d1", "order_1", "FV 6/2026")), "known", "one row per document")
  await recordInvoiceDocument(t.container, doc("d2", "order_2", "FV 7/2026"))
  await recordInvoiceDocument(t.container, doc("d3", "order_3", "FV 8/2026"))
  await recordInvoiceDocument(t.container, doc("d4", "order_4", "FV 9/2026"))
  assert.equal(await recordInvoiceDocument(t.container, { ...doc("d5", "order_1", "PRO 1"), kind: "proforma" }), "ignored")

  const idle = await processDueInvoices(t.container, "schedule")
  assert.equal(idle?.armed, false)
  assert.equal(t.bl.calls.length, 0, "nothing read or written before the writer is armed")

  await setArm(t.s.svc, "invoiceNumbers", true, actor)
  const stats = await processDueInvoices(t.container, "schedule")
  assert.deepEqual([stats?.written, stats?.adopted, stats?.conflict, stats?.waiting], [1, 1, 1, 1])
  assert.deepEqual(
    t.bl.calls.filter((c) => c.method === "setOrderFields").map((c) => c.params),
    [{ order_id: 501, extra_field_1: "FV 6/2026" }],
    "only the empty field was written, and only that field",
  )
  const byDoc = new Map(t.s.table("Invoices").rows.map((r) => [r.document_id, r]))
  assert.equal(byDoc.get("d2")?.last_error_code, "adopted")
  assert.equal(byDoc.get("d3")?.status, "conflict")
  assert.match(String(byDoc.get("d3")?.last_error), /Inny numer/)
  assert.equal(byDoc.get("d4")?.status, "pending", "still on its way to BaseLinker")
  assert.equal(t.events.filter((e) => e.name === "baselinker.invoice_number_written").length, 2)

  held[2].extra_field_1 = ""
  const retried = await retryInvoice(t.container, byDoc.get("d3")?.id as string)
  assert.equal(retried?.status, "written")
})

test("a simulated document is never written to a real account; the demo writes into the simulation", async () => {
  const t = setup(live, [])
  t.s.table("Orders").create({ order_id: "order_1", bl_order_id: "501", status: "sent", demo: false })
  assert.equal(await recordInvoiceDocument(t.container, { id: "d1", order_id: "order_1", kind: "vat", number: "FV 1", demo: true }), "ignored")

  const demo = setup({ demo: true }, [])
  demo.s.table("Orders").create({ order_id: "order_1", bl_order_id: "9100001", status: "sent", demo: true })
  await recordInvoiceDocument(demo.container, { id: "d1", order_id: "order_1", kind: "vat", number: "FV 1/10/2026", demo: true })
  await setArm(demo.s.svc, "invoiceNumbers", true, actor)
  const stats = await processDueInvoices(demo.container, "schedule")
  assert.equal(stats?.written, 1)
  assert.equal(demo.bl.calls.length, 0, "the simulation makes no request")
  const state = demo.s.table("Settings").rows.find((r) => r.key === "demo:state")?.value as Row
  assert.equal(state.invoiceNumbers["9100001"], "FV 1/10/2026")
})
