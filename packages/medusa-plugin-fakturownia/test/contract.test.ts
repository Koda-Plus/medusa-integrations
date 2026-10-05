/**
 * The contract other plugins build on: the two events (shape, exactly once,
 * from every road to `issued`) and the PDF of a document (demo and live).
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { DOCUMENT_CORRECTED_EVENT, DOCUMENT_ISSUED_EVENT, documentEvent } from "../src/modules/fakturownia/lib/events.ts"
import { decodeDemoId, encodeDemoId } from "../src/modules/fakturownia/lib/demo.ts"
import { buildDemoPdf, buildPdf, pdfFileName, pdfStringBytes } from "../src/modules/fakturownia/lib/pdf.ts"
import { fetchDocumentPdf } from "../src/modules/fakturownia/lib/files.ts"
import { FakturowniaClient } from "../src/modules/fakturownia/lib/client.ts"
import { resolveOptions } from "../src/modules/fakturownia/lib/options.ts"
import { FakturowniaApiError } from "../src/modules/fakturownia/lib/errors.ts"
import { enqueueDue, issueDue, markIssued } from "../src/workflows/fakturownia/documents.ts"
import { FakeFakturownia, LIVE, TOKEN, order, setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const row = (over: Record<string, unknown> = {}) => ({
  id: "fkdoc_1",
  order_id: "order_1",
  kind: "vat",
  number: "FV 12/10/2026",
  fakturownia_id: "600000123",
  demo: false,
  status: "issued",
  ...over,
})

test("the event of an issued document has exactly the contract shape", () => {
  const e = documentEvent(row())
  assert.equal(e?.name, DOCUMENT_ISSUED_EVENT)
  assert.deepEqual(e?.data, { id: "fkdoc_1", order_id: "order_1", kind: "vat", number: "FV 12/10/2026", external_id: "600000123", demo: false })
  assert.deepEqual(Object.keys(e!.data).sort(), ["demo", "external_id", "id", "kind", "number", "order_id"])
  for (const kind of ["proforma", "receipt"]) assert.equal(documentEvent(row({ kind }))?.name, DOCUMENT_ISSUED_EVENT)
})

test("a correction is announced as corrected, never as issued", () => {
  const e = documentEvent(row({ kind: "correction", number: "KOR 1/10/2026" }))
  assert.equal(e?.name, DOCUMENT_CORRECTED_EVENT)
  assert.equal(e?.data.kind, "correction")
})

test("nothing to announce without an issued status, a Fakturownia id or a known kind", () => {
  assert.equal(documentEvent(row({ status: "pending" })), null)
  assert.equal(documentEvent(row({ status: "unknown" })), null)
  assert.equal(documentEvent(row({ fakturownia_id: null })), null)
  assert.equal(documentEvent(row({ fakturownia_id: "abc" })), null)
  assert.equal(documentEvent(row({ kind: "bill" })), null)
  assert.equal(documentEvent(row({ demo: true }))?.data.demo, true)
})

test("live: one issue, one contract event, also when a second pass comes by", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  await issueDue(s.container, "schedule")
  const issued = s.events.filter((e) => e.name === DOCUMENT_ISSUED_EVENT)
  assert.equal(issued.length, 1)
  const doc = s.documents.rows[0]
  assert.deepEqual(issued[0].data, { id: doc.id, order_id: order().id, kind: "vat", number: "FV 1/10/2026", external_id: String(fake.docs[0].id), demo: false })
  assert.equal(s.events.filter((e) => e.name === "fakturownia.document_issued").length, 1, "the 0.1.0 event stays")
})

test("live: a document adopted by the reconciliation is announced once", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.createModes = ["lost_no_commit"]
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  assert.equal(s.events.filter((e) => e.name === DOCUMENT_ISSUED_EVENT).length, 0, "unknown is not issued")
  const doc = s.documents.rows[0]
  fake.add({ oid: "1042", kind: "vat", price_gross: "143.0", number: "FV 7/10/2026" })
  doc.next_attempt_at = new Date(Date.now() - 60_000)
  await issueDue(s.container, "schedule")
  await issueDue(s.container, "schedule")
  const issued = s.events.filter((e) => e.name === DOCUMENT_ISSUED_EVENT)
  assert.equal(issued.length, 1)
  assert.equal(issued[0].data.number, "FV 7/10/2026")
})

test("Mark as issued announces the document only when its Fakturownia id is known", async () => {
  const s = setup(LIVE, [order(), order({ id: "order_2", display_id: 1043 })])
  const fake = new FakeFakturownia()
  fake.createModes = ["http_422"]
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await enqueueDue(s.container, "order_2", "payment_captured")
  await issueDue(s.container, "schedule")
  const [a, b] = s.documents.rows
  const remote = fake.add({ oid: "1042", kind: "vat", price_gross: "143.0", number: "FV 4/10/2026" })
  await markIssued(s.container, a.id, { number: "FV 4/10/2026", fakturowniaId: String(remote.id) })
  await markIssued(s.container, b.id, { number: "FV 5/10/2026" })
  const issued = s.events.filter((e) => e.name === DOCUMENT_ISSUED_EVENT)
  assert.equal(issued.length, 1)
  assert.equal(issued[0].data.external_id, String(remote.id))
})

test("simulated ids carry the kind, the month and the sequence; ids of 0.1.0 carry nothing", () => {
  const id = encodeDemoId("vat", "2026-10-05", 12)
  assert.equal(id, "7120261000012")
  assert.deepEqual(decodeDemoId(id), { kind: "vat", month: "2026-10-01", sequence: 12, number: "FV 12/10/2026" })
  assert.equal(decodeDemoId(encodeDemoId("correction", "2027-01-31", 3))?.number, "KOR 3/01/2027")
  assert.equal(decodeDemoId(encodeDemoId("proforma", "2026-10-05", 1))?.kind, "proforma")
  assert.equal(decodeDemoId("700000012"), null)
  assert.equal(decodeDemoId("7120261300012"), null, "month 13")
  assert.ok(Number(id) < Number.MAX_SAFE_INTEGER && id.length <= 15, "a valid Fakturownia id")
})

/** Checks the cross reference table of a PDF against the real byte offsets of its objects. */
function assertValidPdf(data: Buffer): string {
  const text = data.toString("latin1")
  assert.ok(text.startsWith("%PDF-1.4\n"))
  assert.ok(text.trimEnd().endsWith("%%EOF"))
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1])
  assert.equal(text.slice(startxref, startxref + 4), "xref")
  const entries = text.slice(startxref).split("\n").filter((l) => / 00000 n $/.test(l))
  entries.forEach((line, i) => {
    const offset = Number(line.slice(0, 10))
    assert.equal(text.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1}`)
  })
  const stream = /<< \/Length (\d+) >>\nstream\n/.exec(text)!
  const start = stream.index + stream[0].length
  assert.equal(text.slice(start + Number(stream[1]), start + Number(stream[1]) + "\nendstream".length), "\nendstream")
  return text
}

test("the demo PDF is a valid PDF with the kind and the number, Polish letters included", () => {
  const file = buildDemoPdf({ externalId: encodeDemoId("correction", "2026-10-05", 2) })
  assert.equal(file.filename, "KOR-2-10-2026.pdf")
  const text = assertValidPdf(file.data)
  assert.ok(text.includes("(Nr KOR 2/10/2026)"))
  assert.ok(text.includes("/Differences [128 /aogonek"))
  const legacy = buildDemoPdf({ externalId: "700000012", number: "FV 3/10/2026", kind: "vat", issueDate: "2026-10-05", total: "143.00 PLN" })
  assert.equal(legacy.filename, "FV-3-10-2026.pdf")
  assert.ok(assertValidPdf(legacy.data).includes("(Razem brutto: 143.00 PLN)"))
  assert.equal(buildDemoPdf({ externalId: "700000012" }).filename, "document-700000012.pdf")
})

test("PDF strings: Polish letters on the spare codes, brackets escaped, the rest replaced", () => {
  assert.deepEqual(pdfStringBytes("ąŻó"), [0x28, 128, 143, 0xf3, 0x29])
  assert.deepEqual(pdfStringBytes("a(b)\\"), [0x28, 0x61, 0x5c, 0x28, 0x62, 0x5c, 0x29, 0x5c, 0x5c, 0x29])
  assert.deepEqual(pdfStringBytes("€✓"), [0x28, 63, 63, 0x29])
  assertValidPdf(buildPdf([{ text: "Zażółć gęślą jaźń", bold: true }, { text: "x", gap: 900 }]))
  assert.equal(pdfFileName("FV 12/10/2026", "x"), "FV-12-10-2026.pdf")
  assert.equal(pdfFileName(null, "document-1"), "document-1.pdf")
})

test("fetchDocumentPdf: demo never calls the network", async () => {
  globalThis.fetch = (async () => {
    throw new Error("no network in demo")
  }) as typeof fetch
  const file = await fetchDocumentPdf({
    options: resolveOptions({}),
    client: () => {
      throw new Error("no client in demo")
    },
    externalId: encodeDemoId("vat", "2026-10-05", 5),
    demo: true,
  })
  assert.equal(file.contentType, "application/pdf")
  assert.equal(file.filename, "FV-5-10-2026.pdf")
  assert.ok(file.data.subarray(0, 5).toString() === "%PDF-")
})

test("fetchDocumentPdf: live reads the number, then the PDF, with the token in the header only", async () => {
  const fake = new FakeFakturownia()
  const doc = fake.add({ number: "FV 9/10/2026" })
  const client = new FakturowniaClient({ token: TOKEN, account: "mojafirma", requestsPerMinute: 600, timeoutMs: 5000, fetch: fake.fetch, limiter: null })
  const file = await fetchDocumentPdf({ options: resolveOptions(LIVE), client: () => client, externalId: String(doc.id), demo: false })
  assert.equal(file.filename, "FV-9-10-2026.pdf")
  assert.equal(file.data.toString(), "%PDF-1.4 fake")
  assert.deepEqual(fake.methods(), [`GET /invoices/${doc.id}.json`, `GET /invoices/${doc.id}.pdf`])
  assert.ok(fake.calls.every((c) => c.authorization === `Bearer ${TOKEN}` && !c.url.includes("api_token")))

  fake.pdfReady = false
  await assert.rejects(
    fetchDocumentPdf({ options: resolveOptions(LIVE), client: () => client, externalId: String(doc.id), demo: false, number: "FV 9/10/2026" }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "PDF_NOT_READY",
  )
  await assert.rejects(
    fetchDocumentPdf({ options: resolveOptions({}), client: () => client, externalId: String(doc.id), demo: false }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "DEMO_MODE",
  )
  await assert.rejects(
    fetchDocumentPdf({ options: resolveOptions(LIVE), client: () => client, externalId: "../etc", demo: false }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "BAD_ID",
  )
})
