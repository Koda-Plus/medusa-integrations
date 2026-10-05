/**
 * KSeF in depth: the history of a document's status, the new fields, "send
 * to KSeF again" behind its writer, the KSeF XML and UPO through the
 * backend, and the simulated KSeF of the demo.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { canResendKsef } from "../src/modules/fakturownia/lib/status.ts"
import { FakturowniaClient, safeRedirect } from "../src/modules/fakturownia/lib/client.ts"
import { FakturowniaApiError } from "../src/modules/fakturownia/lib/errors.ts"
import { writerSettingKey } from "../src/modules/fakturownia/lib/writers.ts"
import { enqueueDue, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { demoKsefNext, ksefFile, resendRefusal, resendToKsef } from "../src/workflows/fakturownia/ksef.ts"
import { refreshStatuses } from "../src/workflows/fakturownia/statuses.ts"
import { ActionError } from "../src/workflows/fakturownia/runtime.ts"
import { FakeFakturownia, LIVE, TOKEN, order, setup, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("send again: never sent, errors a person can fix, offline; never status_check_error or duplicate_error", () => {
  for (const s of [null, "send_error", "server_error", "offline", "offline_error", "not_connected", "blocked_403_error", "demo_send_error"]) assert.equal(canResendKsef(s), true, String(s))
  for (const s of ["ok", "processing", "status_check_error", "duplicate_error", "not_applicable", "demo_ok"]) assert.equal(canResendKsef(s), false, s)
  assert.match(resendRefusal("status_check_error") ?? "", /may have accepted/)
  assert.match(resendRefusal("duplicate_error") ?? "", /holds a document with this number/)
  assert.equal(resendRefusal("send_error"), null)
})

test("a redirect is followed to https only, never to a bare IP or a local name", () => {
  const base = "https://mojafirma.fakturownia.pl/invoices/1/attachment?kind=gov_upo"
  assert.equal(safeRedirect("https://storage.example.com/upo/1.xml", base), "https://storage.example.com/upo/1.xml")
  assert.equal(safeRedirect("/files/gov_upo/1.xml", base), "https://mojafirma.fakturownia.pl/files/gov_upo/1.xml")
  for (const bad of ["http://storage.example.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://[::1]/x", "https://intranet/x", null]) assert.equal(safeRedirect(bad, base), null, String(bad))
})

test("the client: send_to_ksef as documented, one request; the UPO through the redirect, the token never leaves the account host", async () => {
  const fake = new FakeFakturownia()
  const doc = fake.add({ gov_status: "send_error" })
  const client = new FakturowniaClient({ token: TOKEN, account: "mojafirma", requestsPerMinute: 600, timeoutMs: 5000, fetch: fake.fetch, limiter: null })
  const answer = await client.sendToKsef(doc.id)
  assert.equal(answer.gov_status, "processing")
  assert.equal(fake.calls[0].query.get("send_to_ksef"), "yes")
  await assert.rejects(client.getAttachment(doc.id, "gov_upo"), (e: unknown) => e instanceof FakturowniaApiError && e.status === 404)
  doc.gov_status = "ok"
  const upo = await client.getAttachment(doc.id, "gov_upo")
  assert.match(Buffer.from(upo.bytes).toString(), /<UPO>\/gov_upo\//)
  const storage = fake.calls.find((c) => c.url.startsWith("https://storage.example.com/"))!
  assert.equal(storage.authorization, null, "no token to another host")
  fake.attachmentHost = "self"
  const xml = await client.getAttachment(doc.id, "gov")
  assert.match(Buffer.from(xml.bytes).toString(), /<UPO>\d+<\/UPO>/)
  assert.equal(fake.calls.at(-1)?.authorization, `Bearer ${TOKEN}`, "the account's own host keeps the header")
})

async function issued(): Promise<{ s: Setup; fake: FakeFakturownia; doc: Row }> {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  return { s, fake, doc: s.documents.rows[0] }
}

test("the status read keeps every change in the history, with the number, the date, the link and the errors", async () => {
  const { s, fake, doc } = await issued()
  assert.deepEqual(
    s.ksef.rows.map((k) => [k.source, k.gov_status]),
    [["issue", "processing"]],
  )
  Object.assign(fake.docs[0], { gov_status: "send_error", gov_error_messages: ["Telefon klienta - pole jest za długie (maksymalna ilość znaków: 16)"] })
  await refreshStatuses(s.container, "manual")
  await refreshStatuses(s.container, "manual")
  assert.equal(s.ksef.rows.length, 2, "an unchanged status is not a new line")
  assert.deepEqual(doc.gov_errors, ["Telefon klienta - pole jest za długie (maksymalna ilość znaków: 16)"])
  Object.assign(fake.docs[0], {
    gov_status: "ok",
    gov_id: "1234563218-20261006-ABCDEF123456",
    gov_error_messages: null,
    gov_send_date: "2026-10-06T10:30:00.000+02:00",
    gov_verification_link: "https://ksef.mf.gov.pl/web/verify/1234563218-20261006-ABCDEF123456/abc",
  })
  await refreshStatuses(s.container, "manual")
  assert.deepEqual([doc.gov_status, doc.gov_id, doc.gov_errors], ["ok", "1234563218-20261006-ABCDEF123456", null])
  assert.equal(doc.gov_send_date.toISOString(), "2026-10-06T08:30:00.000Z")
  assert.match(doc.gov_verification_link, /^https:\/\/ksef\.mf\.gov\.pl\/web\/verify\//)
  assert.deepEqual(
    s.ksef.rows.map((k) => k.gov_status),
    ["processing", "send_error", "ok"],
  )
  const fields = fake.calls.filter((c) => c.query.get("fields[invoice]")).at(-1)!.query.get("fields[invoice]")!
  for (const f of ["gov_send_date", "gov_verification_link", "gov_corrected_invoice_number", "gov_error_messages"]) assert.ok(fields.includes(f), f)
})

test("send to KSeF again: the writer, the status rules and the five minute guard; one request, recorded with who asked", async () => {
  const { s, fake, doc } = await issued()
  Object.assign(fake.docs[0], { gov_status: "status_check_error" })
  await refreshStatuses(s.container, "manual")
  await assert.rejects(resendToKsef(s.container, doc.id, "user_1"), (e: unknown) => e instanceof ActionError && /may have accepted/.test(e.message))
  Object.assign(fake.docs[0], { gov_status: "server_error" })
  await refreshStatuses(s.container, "manual")
  await assert.rejects(resendToKsef(s.container, doc.id, "user_1"), (e: unknown) => e instanceof ActionError && /writer is off/.test(e.message))
  await s.planStore.setSetting(writerSettingKey("ksef", false), { on: true }, "user_1")
  const r = await resendToKsef(s.container, doc.id, "user_1")
  assert.equal(r.outcome, "sent")
  assert.equal(doc.gov_status, "processing")
  assert.equal(fake.calls.filter((c) => c.query.get("send_to_ksef") === "yes").length, 1)
  assert.deepEqual([s.ksef.rows.at(-1)?.source, s.ksef.rows.at(-1)?.requested_by], ["resend", "user_1"])
  Object.assign(fake.docs[0], { gov_status: "server_error" })
  await refreshStatuses(s.container, "manual")
  await assert.rejects(resendToKsef(s.container, doc.id, "user_1"), (e: unknown) => e instanceof ActionError && /five minutes/.test(e.message))
})

test("the UPO and the KSeF XML of an accepted document, with readable names; nothing before acceptance", async () => {
  const { s, fake, doc } = await issued()
  await assert.rejects(ksefFile(s.container, doc as never, "upo"), (e: unknown) => e instanceof ActionError && e.status === 409)
  Object.assign(fake.docs[0], { gov_status: "ok", gov_id: "1234563218-20261006-ABCDEF123456" })
  await refreshStatuses(s.container, "manual")
  const upo = await ksefFile(s.container, doc as never, "upo")
  assert.equal(upo.filename, "UPO-FV-1-10-2026.xml")
  assert.match(upo.data.toString(), /<UPO>/)
})

test("demo: processing becomes accepted after a few minutes; a rejection waits for a send; the files are simulated", async () => {
  const s = setup({}, [order()])
  globalThis.fetch = (async () => {
    throw new Error("demo mode must not call the network")
  }) as typeof fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const doc = s.documents.rows[0]
  assert.equal(doc.gov_status, "processing")
  const later = new Date(Date.now() + 9 * 60_000)
  assert.equal(demoKsefNext({ ...doc, gov_status: "send_error" } as never, later), null, "a rejection stays")
  assert.equal(demoKsefNext(doc as never, new Date())?.govStatus ?? null, null, "not yet")
  assert.equal(demoKsefNext(doc as never, later)?.govStatus, "ok")
  Object.assign(doc, { gov_status: "send_error", gov_errors: ["Telefon klienta - pole jest za długie (maksymalna ilość znaków: 16)"] })
  await s.planStore.setSetting(writerSettingKey("ksef", true), { on: true }, "user_1")
  await resendToKsef(s.container, doc.id, "user_1")
  assert.deepEqual([doc.gov_status, doc.gov_errors], ["processing", null])
  doc.ksef_resend_at = new Date(Date.now() - 9 * 60_000)
  await refreshStatuses(s.container, "manual")
  assert.equal(doc.gov_status, "ok")
  assert.match(doc.gov_id, /^0000000000-/)
  const upo = await ksefFile(s.container, doc as never, "upo")
  assert.match(upo.data.toString(), /Simulation/)
  assert.deepEqual(
    s.ksef.rows.map((k) => k.source),
    ["issue", "resend", "refresh"],
  )
})
