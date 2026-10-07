/**
 * The admin and store routes as a browser meets them: reads never write (in
 * demo mode too: the sample data comes from the job or one explicit POST),
 * every filter does what it says and every tile counts its own list, the
 * search keeps the filter, the files carry safe headers, a shopper never sees
 * the reason of a failure, and the middlewares guard the writes.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { validateHeaderValue } from "node:http"
import { GET as statusRoute } from "../src/api/admin/fakturownia/route.ts"
import { GET as documentsRoute } from "../src/api/admin/fakturownia/documents/route.ts"
import { GET as documentRoute } from "../src/api/admin/fakturownia/documents/[id]/route.ts"
import { GET as adminPdfRoute } from "../src/api/admin/fakturownia/documents/[id]/pdf/route.ts"
import { GET as ksefFileRoute } from "../src/api/admin/fakturownia/documents/[id]/ksef-file/route.ts"
import { GET as orderRoute } from "../src/api/admin/fakturownia/orders/[orderId]/route.ts"
import { GET as correctionsRoute } from "../src/api/admin/fakturownia/corrections/route.ts"
import { GET as emailsRoute } from "../src/api/admin/fakturownia/emails/route.ts"
import { GET as remindersRoute } from "../src/api/admin/fakturownia/reminders/route.ts"
import { GET as runsRoute } from "../src/api/admin/fakturownia/runs/route.ts"
import { GET as summaryRoute } from "../src/api/admin/fakturownia/summary/route.ts"
import { POST as seedRoute } from "../src/api/admin/fakturownia/demo/seed/route.ts"
import { GET as storeListRoute } from "../src/api/store/fakturownia/orders/[orderId]/documents/route.ts"
import { GET as storePdfRoute } from "../src/api/store/fakturownia/documents/[id]/pdf/route.ts"
import { DOCUMENT_FILTERS } from "../src/api/admin/fakturownia/helpers.ts"
import { contentDisposition, pdfFileName, unicodeFileName } from "../src/modules/fakturownia/lib/pdf.ts"
import { MAX_ATTACHMENT_BYTES, readLimited } from "../src/modules/fakturownia/lib/client.ts"
import { enqueueDue, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { FakeFakturownia, LIVE, order, setup, today, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

interface FakeRes {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  status(code: number): FakeRes
  json(body: unknown): FakeRes
  send(body: unknown): FakeRes
  setHeader(name: string, value: string): void
}

function response(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      res.statusCode = code
      return res
    },
    json(body) {
      res.body = body
      return res
    },
    send(body) {
      res.body = body
      return res
    },
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value
    },
  }
  return res
}

function req(s: Setup, args: { params?: Row; query?: Row; customer?: string } = {}) {
  return {
    scope: s.container,
    params: args.params ?? {},
    query: args.query ?? {},
    body: {},
    headers: {},
    auth_context: args.customer ? { actor_id: args.customer, actor_type: "customer" } : { actor_id: "user_1", actor_type: "user" },
  } as never
}

/** Every call that would change data: the service writes, the two atomic stores, the event bus, a write to Fakturownia. */
function recordWrites(s: Setup): () => string[] {
  const calls: string[] = []
  const svc = s.container.resolve("fakturownia") as Record<string, unknown>
  for (const k of Object.keys(svc)) {
    const fn = svc[k]
    if (typeof fn !== "function" || !/^(create|update|delete|softDelete|restore|upsert)/.test(k)) continue
    svc[k] = (...args: unknown[]) => {
      calls.push(`service.${k}`)
      return (fn as (...a: unknown[]) => unknown)(...args)
    }
  }
  for (const [name, target] of [
    ["store", s.store],
    ["planStore", s.planStore],
  ] as const) {
    const t = target as unknown as Record<string, unknown>
    for (const k of Object.keys(t)) {
      const fn = t[k]
      if (typeof fn !== "function") continue
      t[k] = (...args: unknown[]) => {
        calls.push(`${name}.${k}`)
        return (fn as (...a: unknown[]) => unknown)(...args)
      }
    }
  }
  const bus = s.container.resolve("event_bus") as { emit: (...a: unknown[]) => unknown }
  const emit = bus.emit
  bus.emit = (...args: unknown[]) => {
    calls.push("event_bus.emit")
    return emit(...args)
  }
  const seen = globalThis.fetch
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "GET") calls.push(`fetch ${init?.method} ${new URL(String(input)).pathname}`)
    return seen(input, init)
  }) as typeof fetch
  return () => calls
}

async function issued(options = LIVE, orders: Row[] = [order({ customer_id: "cus_1" })]): Promise<{ s: Setup; fake: FakeFakturownia | null }> {
  const s = setup(options, orders)
  const fake = options.demo ? null : new FakeFakturownia()
  globalThis.fetch = fake
    ? fake.fetch
    : ((async () => {
        throw new Error("demo mode must not call the network")
      }) as typeof fetch)
  for (const o of orders) await enqueueDue(s.container, o.id, "payment_captured")
  await issueDue(s.container, "schedule")
  return { s, fake }
}

async function everyGet(s: Setup, doc: Row): Promise<void> {
  const calls: Array<[string, (q: never, r: never) => Promise<void>, Parameters<typeof req>[1]]> = [
    ["status", statusRoute, {}],
    ["documents", documentsRoute, { query: { filter: "attention", q: "1042" } }],
    ["document", documentRoute, { params: { id: doc.id } }],
    ["pdf", adminPdfRoute, { params: { id: doc.id } }],
    ["ksef file", ksefFileRoute, { params: { id: doc.id }, query: { file: "upo" } }],
    ["order", orderRoute, { params: { orderId: doc.order_id } }],
    ["corrections", correctionsRoute, { query: { filter: "all" } }],
    ["emails", emailsRoute, {}],
    ["reminders", remindersRoute, {}],
    ["runs", runsRoute, { query: { kind: "corrections" } }],
    ["summary", summaryRoute, {}],
    ["store list", storeListRoute, { params: { orderId: doc.order_id }, customer: "cus_1" }],
    ["store pdf", storePdfRoute, { params: { id: doc.id }, customer: "cus_1" }],
  ]
  for (const [name, handler, args] of calls) {
    const res = response()
    await handler(req(s, args), res as never)
    assert.ok(res.statusCode < 500, `${name}: ${res.statusCode} ${JSON.stringify(res.body)}`)
  }
}

test("live: no GET route writes anything, to the database, the event bus or Fakturownia", async () => {
  const { s } = await issued()
  const doc = s.documents.rows[0]
  const writes = recordWrites(s)
  await everyGet(s, doc)
  assert.deepEqual(writes(), [])
})

test("demo: no GET route writes either; the sample data comes from one explicit POST, idempotent", async () => {
  const orders = Array.from({ length: 4 }, (_, i) => order({ id: `order_demo_${i}`, display_id: 400 + i, customer_id: "cus_1", created_at: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() }))
  const s = setup({ demo: true }, orders)
  globalThis.fetch = (async () => {
    throw new Error("demo mode must not call the network")
  }) as typeof fetch
  const writes = recordWrites(s)
  const first = response()
  await statusRoute(req(s), first as never)
  assert.equal((first.body as Row).demoPrepared, false)
  assert.equal(s.documents.rows.length, 0, "a first visit seeds nothing by itself")
  assert.deepEqual(writes(), [])

  const seeded = response()
  await seedRoute(req(s), seeded as never)
  assert.equal(seeded.statusCode, 200)
  assert.equal((seeded.body as Row).demoPrepared, true)
  const count = s.documents.rows.length
  assert.ok(count >= 4)
  await seedRoute(req(s), response() as never)
  assert.equal(s.documents.rows.length, count, "a second seed changes nothing")

  const before = writes().length
  await everyGet(s, s.documents.rows.find((r) => r.status === "issued" && r.kind === "vat")!)
  assert.deepEqual(writes().slice(before), [])
})

test("the demo seed answers 409 in live mode", async () => {
  const s = setup(LIVE, [order()])
  const res = response()
  await seedRoute(req(s), res as never)
  assert.equal(res.statusCode, 409)
})

/** One row of each case the filters must tell apart. */
function mixed(): Setup {
  const s = setup(LIVE)
  const base = { demo: false, deleted_at: null, created_at: new Date(), issued_at: new Date(), issue_date: today(), paid: false, error_code: null, converted_at: null, cancel_requested_at: null, gov_status: null }
  const rows: Row[] = [
    { id: "fkdoc_vat_unpaid", order_id: "order_a", display_id: 1042, kind: "vat", status: "issued", number: "FV 1/10/2026", fakturownia_id: "11" },
    { id: "fkdoc_vat_paid", order_id: "order_b", display_id: 1043, kind: "vat", status: "issued", paid: true, number: "FV 2/10/2026", fakturownia_id: "12", gov_status: "send_error" },
    { id: "fkdoc_pro_converted", order_id: "order_c", display_id: 1044, kind: "proforma", status: "issued", number: "PRO 1/10/2026", fakturownia_id: "13", converted_at: new Date() },
    { id: "fkdoc_pro_open", order_id: "order_d", display_id: 1045, kind: "proforma", status: "issued", number: "PRO 2/10/2026", fakturownia_id: "14" },
    { id: "fkdoc_pro_reject_failed", order_id: "order_e", display_id: 1046, kind: "proforma", status: "issued", number: "PRO 3/10/2026", fakturownia_id: "15", error_code: "reject_failed", cancel_requested_at: new Date() },
    { id: "fkdoc_correction", order_id: "order_b", display_id: 1043, kind: "correction", status: "issued", number: "KOR 1/10/2026", fakturownia_id: "16", gov_status: "ok" },
    { id: "fkdoc_failed", order_id: "order_f", display_id: 1047, kind: "vat", status: "failed", number: null, fakturownia_id: null },
    { id: "fkdoc_unknown", order_id: "order_g", display_id: 1048, kind: "receipt", status: "unknown", number: null, fakturownia_id: null },
    { id: "fkdoc_needs", order_id: "order_h", display_id: 1049, kind: "vat", status: "needs_correction", number: "FV 3/10/2026", fakturownia_id: "17" },
    { id: "fkdoc_pending", order_id: "order_i", display_id: 1050, kind: "vat", status: "pending", number: null, fakturownia_id: null },
    { id: "fkdoc_canceled", order_id: "order_j", display_id: 1051, kind: "proforma", status: "canceled", number: "PRO 4/10/2026", fakturownia_id: "18" },
  ]
  for (const r of rows) s.documents.rows.push({ ...base, ...r })
  return s
}

async function list(s: Setup, query: Row): Promise<string[]> {
  const res = response()
  await documentsRoute(req(s, { query: { limit: "100", ...query } }), res as never)
  return ((res.body as Row).documents as Row[]).map((d) => d.id).sort()
}

test("every filter does what it says, and every tile of the page counts its own list", async () => {
  const s = mixed()
  const res = response()
  await statusRoute(req(s), res as never)
  const counts = (res.body as Row).counts as Row
  const tile: Record<string, number> = {
    all: counts.total,
    pending: counts.pending,
    issued: counts.issued,
    attention: counts.attention,
    unpaid: counts.unpaid,
    ksef: counts.ksefProblems,
    canceled: counts.canceled,
    corrections: counts.corrections,
  }
  for (const filter of DOCUMENT_FILTERS) assert.equal((await list(s, { filter })).length, tile[filter], `filter ${filter}`)
  assert.deepEqual(await list(s, { filter: "corrections" }), ["fkdoc_correction"])
  assert.deepEqual(await list(s, { filter: "unpaid" }), ["fkdoc_pro_open", "fkdoc_vat_unpaid"], "no correction, no converted proforma, no document of a canceled order")
  assert.deepEqual(await list(s, { filter: "attention" }), ["fkdoc_failed", "fkdoc_needs", "fkdoc_pro_reject_failed", "fkdoc_unknown"])
  assert.deepEqual(await list(s, { filter: "ksef" }), ["fkdoc_vat_paid"])
  assert.equal((await list(s, { filter: "nonsense" })).length, counts.total, "an unknown filter reads as all")
})

test("a search keeps the filter; exact lookups by order ids and by number", async () => {
  const s = mixed()
  assert.deepEqual(await list(s, { filter: "attention", q: "1047" }), ["fkdoc_failed"])
  assert.deepEqual(await list(s, { filter: "attention", q: "1042" }), [], "the unpaid invoice of order 1042 needs no attention")
  assert.deepEqual(await list(s, { q: "#1043" }), ["fkdoc_correction", "fkdoc_vat_paid"])
  assert.deepEqual(await list(s, { order_id: "order_a,order_h,bad id" }), ["fkdoc_needs", "fkdoc_vat_unpaid"])
  assert.deepEqual(await list(s, { number: "PRO 2/10/2026" }), ["fkdoc_pro_open"])
  assert.deepEqual(await list(s, { number: "PRO 2" }), [], "the number is exact")
})

test("file names with Polish letters: an ASCII name Node accepts, and the name as printed in filename*", () => {
  const number = "FV/ŁÓDŹ/12/10/2026"
  const ascii = pdfFileName(number, "document-1")
  assert.equal(ascii, "FV-LODZ-12-10-2026.pdf")
  const header = contentDisposition("attachment", ascii, unicodeFileName(number, "document-1"))
  assert.doesNotThrow(() => validateHeaderValue("Content-Disposition", header))
  assert.match(header, /^attachment; filename="FV-LODZ-12-10-2026\.pdf"; filename\*=UTF-8''FV-%C5%81%C3%93D%C5%B9-12-10-2026\.pdf$/)
  assert.equal(contentDisposition("inline", "FV-1-10-2026.pdf", "FV-1-10-2026.pdf"), 'inline; filename="FV-1-10-2026.pdf"')
  /* What 0.2.x sent: Node refused it. */
  assert.throws(() => validateHeaderValue("Content-Disposition", 'attachment; filename="FV-ŁÓDŹ-12-10-2026.pdf"'))
})

test("the PDF and the KSeF files: safe names, nosniff, and always XML whatever the file host answers", async () => {
  const { s, fake } = await issued()
  const doc = s.documents.rows[0]
  doc.number = "FV/ŁÓDŹ/1/10/2026"
  const pdf = response()
  await adminPdfRoute(req(s, { params: { id: doc.id } }), pdf as never)
  assert.equal(pdf.statusCode, 200)
  assert.equal(pdf.headers["x-content-type-options"], "nosniff")
  assert.doesNotThrow(() => validateHeaderValue("Content-Disposition", pdf.headers["content-disposition"]))

  doc.gov_status = "ok"
  fake!.docs[0].gov_status = "ok"
  const xml = response()
  await ksefFileRoute(req(s, { params: { id: doc.id }, query: { file: "xml" } }), xml as never)
  assert.equal(xml.statusCode, 200)
  assert.equal(xml.headers["content-type"], "application/xml")
  assert.equal(xml.headers["x-content-type-options"], "nosniff")
  assert.match(xml.headers["content-disposition"], /filename="KSeF-FV-LODZ-1-10-2026\.xml"/)
})

test("an attachment larger than 5 MB is refused without being read whole", async () => {
  const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 10)
  let pulled = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = big.subarray(pulled, pulled + 1024 * 1024)
      if (chunk.length === 0) controller.close()
      else {
        pulled += chunk.length
        controller.enqueue(chunk)
      }
    },
  })
  assert.equal(await readLimited(new Response(stream), MAX_ATTACHMENT_BYTES), null)
  assert.ok(pulled <= MAX_ATTACHMENT_BYTES + 2 * 1024 * 1024, "stopped soon after the limit")
  const small = await readLimited(new Response(new Uint8Array([1, 2, 3])), MAX_ATTACHMENT_BYTES)
  assert.deepEqual([...(small ?? [])], [1, 2, 3])
})

test("a shopper never reads why a PDF failed; a store without a token answers 503", async () => {
  const { s, fake } = await issued()
  const doc = s.documents.rows[0]
  fake!.pdfReady = true
  globalThis.fetch = (async () => new Response("<html>Internal error at db.query(SELECT ...)</html>", { status: 500 })) as typeof fetch
  /* The cached client keeps its fetch: a new setup with a broken Fakturownia. */
  const broken = setup(LIVE, [order({ customer_id: "cus_1" })])
  broken.documents.rows.push({ ...doc })
  const res = response()
  await storePdfRoute(req(broken, { params: { id: doc.id }, customer: "cus_1" }), res as never)
  assert.equal(res.statusCode, 502)
  assert.equal((res.body as Row).message, "The document cannot be downloaded right now. Try again later.")
  assert.ok(broken.logs.some((l) => l.includes("PDF of")), "the reason goes to the server log")

  const lost = setup({ account: "mojafirma" }, [order({ customer_id: "cus_1" })])
  lost.documents.rows.push({ ...doc })
  const off = response()
  await storePdfRoute(req(lost, { params: { id: doc.id }, customer: "cus_1" }), off as never)
  assert.equal(off.statusCode, 503)
  assert.doesNotMatch(JSON.stringify(off.body), /token|apiToken|NO_TOKEN/i)
})
