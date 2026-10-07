/**
 * E-mails of documents: masking, addresses, the reminder rule, the
 * documented request, the writer's switches, the history and the simulated
 * mailbox of the demo.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { ageInDays, canRemind, demoSubject, isEmail, maskEmail, maskEmailsIn, parseRecipients } from "../src/modules/fakturownia/lib/email.ts"
import { enqueueDue, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { sendDocumentEmail } from "../src/workflows/fakturownia/emails.ts"
import { refreshStatuses } from "../src/workflows/fakturownia/statuses.ts"
import { ActionError } from "../src/workflows/fakturownia/runtime.ts"
import { writerSettingKey } from "../src/modules/fakturownia/lib/writers.ts"
import { FakeFakturownia, LIVE, TOKEN, order, setup, unpaid, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("addresses are masked to the first letters and the top level domain", () => {
  assert.equal(maskEmail("anna.nowak@example.com"), "a***@e***.com")
  assert.equal(maskEmail("x@mail.example.com"), "x***@m***.com")
  assert.equal(maskEmail("not an address"), "***")
  assert.equal(maskEmail(null), "***")
  assert.equal(maskEmailsIn("Nie można wysłać do anna@example.com ani do b@c.test"), "Nie można wysłać do a***@e***.com ani do b***@c***.test")
})

test("addresses typed by a person: separators, repeats, invalid ones and the limit of five", () => {
  assert.deepEqual(parseRecipients("a@x.test, b@x.test;c@x.test  A@X.TEST"), { valid: ["a@x.test", "b@x.test", "c@x.test"], invalid: [] })
  assert.deepEqual(parseRecipients("a@x.test, nope"), { valid: ["a@x.test"], invalid: ["nope"] })
  assert.deepEqual(parseRecipients("1@x.test 2@x.test 3@x.test 4@x.test 5@x.test 6@x.test").invalid, ["6@x.test"])
  assert.deepEqual(parseRecipients(""), { valid: [], invalid: [] })
  assert.equal(isEmail("a@b"), false)
})

test("reminders: at most one a day; the age of a document in whole days", () => {
  const now = new Date("2026-10-06T12:00:00Z")
  assert.equal(canRemind(null, now, 24), true)
  assert.equal(canRemind(new Date("2026-10-06T00:00:00Z"), now, 24), false)
  assert.equal(canRemind(new Date("2026-10-05T11:00:00Z"), now, 24), true)
  assert.equal(ageInDays("2026-09-26", now), 10)
  assert.equal(ageInDays(null, now), 0)
  assert.equal(demoSubject("proforma", "PRO 3/10/2026", "reminder", "pl"), "Przypomnienie o płatności: Faktura pro forma PRO 3/10/2026")
  assert.equal(demoSubject("vat", "FV 1/10/2026", "manual", "en"), "VAT invoice FV 1/10/2026")
})

async function issuedLive(options = LIVE, o: Row = order()): Promise<{ s: Setup; fake: FakeFakturownia; doc: Row }> {
  const s = setup(options, [o])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, o.id, options.trigger === "order_placed" ? "order_placed" : "payment_captured")
  await issueDue(s.container, "schedule")
  return { s, fake, doc: s.documents.rows[0] }
}

const armEmails = (s: Setup, demo = false) => s.planStore.setSetting(writerSettingKey("emails", demo), { on: true }, "user_1")

test("a manual e-mail needs the armed writer; then it goes once, recorded with the address masked", async () => {
  const { s, fake, doc } = await issuedLive()
  await assert.rejects(sendDocumentEmail(s.container, doc.id, { kind: "manual", actorId: "user_1" }), (e: unknown) => e instanceof ActionError && e.status === 409)
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length, 0)
  await armEmails(s)
  const r = await sendDocumentEmail(s.container, doc.id, { kind: "manual", actorId: "user_1" })
  assert.equal(r.outcome, "sent")
  const call = fake.calls.find((c) => c.path.endsWith("/send_by_email.json"))!
  assert.equal(call.authorization, `Bearer ${TOKEN}`)
  assert.equal(call.query.get("email_to"), null, "to the buyer's address on the document")
  assert.deepEqual([s.emails.rows[0].kind, s.emails.rows[0].status, s.emails.rows[0].recipient, s.emails.rows[0].requested_by], ["manual", "sent", "a***@e***.com", "user_1"])
  assert.ok(!JSON.stringify(s.emails.rows).includes("anna@example.com"), "no address at rest")
  assert.ok(doc.emailed_at instanceof Date)
})

test("to other addresses, with the PDF: the documented parameters; a wrong address is refused before anything leaves", async () => {
  const { s, fake, doc } = await issuedLive()
  await armEmails(s)
  await assert.rejects(sendDocumentEmail(s.container, doc.id, { kind: "manual", to: "biuro@example.com, nope", actorId: null }), (e: unknown) => e instanceof ActionError && e.status === 400)
  await sendDocumentEmail(s.container, doc.id, { kind: "manual", to: "biuro@example.com; ksiegowa@example.com", attachPdf: true, actorId: null })
  const call = fake.calls.find((c) => c.path.endsWith("/send_by_email.json"))!
  assert.deepEqual([call.query.get("email_to"), call.query.get("email_pdf")], ["biuro@example.com,ksiegowa@example.com", "true"])
  assert.deepEqual([s.emails.rows[0].recipient, s.emails.rows[0].with_pdf], ["b***@e***.com, k***@e***.com", true])
})

test("Fakturownia's refusal (no KSeF number yet) is recorded as refused; a lost answer is never sent again", async () => {
  const { s, fake, doc } = await issuedLive()
  await armEmails(s)
  fake.emailMode = "ksef_wait"
  const refused = await sendDocumentEmail(s.container, doc.id, { kind: "manual", actorId: null })
  assert.equal(refused.outcome, "refused")
  assert.match(refused.message ?? "", /KSeF/)
  fake.emailMode = "timeout"
  const lost = await sendDocumentEmail(s.container, doc.id, { kind: "manual", actorId: null })
  assert.equal(lost.outcome, "failed")
  assert.match(lost.message ?? "", /may have gone out/)
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length, 2, "one request each, no retries")
  assert.deepEqual(
    s.emails.rows.map((e) => e.status),
    ["refused", "failed"],
  )
})

test("a reminder: an unpaid proforma or VAT invoice only, at most once a day", async () => {
  const { s, doc } = await issuedLive({ ...LIVE, trigger: "order_placed" }, unpaid())
  await armEmails(s)
  assert.equal(doc.paid, false)
  const r = await sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" })
  assert.equal(r.outcome, "sent")
  await assert.rejects(sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" }), (e: unknown) => e instanceof ActionError && /less than a day/.test(e.message))
  /* A day later (the history and the claim of the last reminder). */
  s.emails.rows[0].created_at = new Date(Date.now() - 25 * 3600 * 1000)
  doc.reminder_at = new Date(Date.now() - 25 * 3600 * 1000)
  assert.equal((await sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" })).outcome, "sent")
  doc.paid = true
  s.emails.rows.forEach((e) => (e.created_at = new Date(0)))
  await assert.rejects(sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" }), (e: unknown) => e instanceof ActionError && /unpaid/.test(e.message))
})

test("the automatic e-mail is recorded once it goes out; writers.emails: false stops it", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, sendByEmail: true })
  assert.equal(doc.email_status, "sent")
  assert.deepEqual([s.emails.rows.length, s.emails.rows[0].kind, s.emails.rows[0].requested_by], [1, "auto", "system"])
  const off = await issuedLive({ ...LIVE, sendByEmail: true, writers: { emails: false } })
  assert.equal(off.doc.email_status, null)
  await refreshStatuses(off.s.container, "manual")
  assert.equal(off.fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length, 0)
  assert.ok(fake.calls.some((c) => c.path.endsWith("/send_by_email.json")))
})

test("demo: the simulated mailbox, nothing sent", async () => {
  const s = setup({ demo: true }, [order()])
  globalThis.fetch = (async () => {
    throw new Error("demo mode must not call the network")
  }) as typeof fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  await issueDue(s.container, "schedule")
  const doc = s.documents.rows[0]
  await armEmails(s, true)
  const r = await sendDocumentEmail(s.container, doc.id, { kind: "manual", to: "biuro@example.com", actorId: "user_1" })
  assert.equal(r.outcome, "sent")
  const mail = s.emails.rows[0]
  assert.deepEqual([mail.demo, mail.recipient, mail.status], [true, "b***@e***.com", "sent"])
  assert.match(mail.subject, /^Faktura VAT FV 1\//)
})
