/**
 * 0.4.0: a VAT invoice stuck without a KSeF number, a numbered one the buyer
 * never got, and the gate of payment reminders. The rules in memory and as
 * service filters agree; the status pass reads Fakturownia's own e-mail and
 * keeps reading late documents; "Needs attention" lists them and clears them
 * by itself; a reminder needs Medusa and Fakturownia to agree.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { GET as documentsRoute } from "../src/api/admin/fakturownia/documents/route.ts"
import { GET as remindersRoute } from "../src/api/admin/fakturownia/reminders/route.ts"
import { POST as emailRoute } from "../src/api/admin/fakturownia/documents/[id]/email/route.ts"
import { KSEF_LATE_WINDOW_DAYS } from "../src/modules/fakturownia/lib/constants.ts"
import { documentFilters } from "../src/modules/fakturownia/lib/filters.ts"
import { expectsKsefNumber, lateReadFilters, notEmailed, remoteEmailed, stuckWithoutNumber, watchFilters, watchOf, type WatchContext, type WatchRow } from "../src/modules/fakturownia/lib/ksef-watch.ts"
import { resolveOptions } from "../src/modules/fakturownia/lib/options.ts"
import { reminderGate, reminderRefusalText } from "../src/modules/fakturownia/lib/reminder-gate.ts"
import { writerSettingKey } from "../src/modules/fakturownia/lib/writers.ts"
import { enqueueDue, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { ReminderGateError, sendDocumentEmail } from "../src/workflows/fakturownia/emails.ts"
import { refreshStatuses } from "../src/workflows/fakturownia/statuses.ts"
import { FakeFakturownia, LIVE, matches, order, setup, unpaid, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const NOW = new Date("2026-11-02T12:00:00.000Z")
const DAY = 86_400_000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const ctx = (over: Partial<WatchContext> = {}): WatchContext => ({ now: NOW, ksefStuckAfterDays: 3, notEmailedAfterHours: 24, ksefActive: true, emailsExpected: true, ...over })

function row(over: Partial<WatchRow> & Row = {}): WatchRow & Row {
  return {
    id: "fkdoc_x",
    demo: false,
    kind: "vat",
    status: "issued",
    fakturownia_id: "11",
    gov_status: null,
    gov_id: null,
    gov_error: null,
    gov_errors: null,
    buyer_type: "company",
    issued_at: ago(5),
    error_code: null,
    emailed_at: null,
    ksef_number_at: null,
    remote_email_status: null,
    remote_sent_at: null,
    remote_email_checked_at: null,
    gov_checked_at: ago(1),
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* The rules                                                           */
/* ------------------------------------------------------------------ */

test("options: ksefStuckAfterDays 3 and notEmailedAfterHours 24 by default, 0 turns each off, strings from the environment", () => {
  const d = resolveOptions({})
  assert.deepEqual([d.ksefStuckAfterDays, d.notEmailedAfterHours], [3, 24])
  const o = resolveOptions({ ksefStuckAfterDays: "0", notEmailedAfterHours: "48" })
  assert.deepEqual([o.ksefStuckAfterDays, o.notEmailedAfterHours], [0, 48])
  assert.equal(resolveOptions({ ksefStuckAfterDays: 900 }).ksefStuckAfterDays, 60)
})

test("stuck without a KSeF number: the exact state, after N days, within 60 days, only for what must go to KSeF", () => {
  const c = ctx()
  assert.deepEqual(stuckWithoutNumber(row(), c), { kind: "ksef_stuck", state: "not_sent", govStatus: null, errors: [], since: ago(5).toISOString(), days: 5 })
  assert.equal(stuckWithoutNumber(row({ gov_status: "processing" }), c)?.state, "processing")
  assert.equal(stuckWithoutNumber(row({ gov_status: "offline" }), c)?.state, "offline")
  const err = stuckWithoutNumber(row({ gov_status: "demo_send_error", gov_errors: ["Telefon klienta - pole jest za długie"] }), c)
  assert.deepEqual([err?.state, err?.govStatus, err?.errors], ["error", "send_error", ["Telefon klienta - pole jest za długie"]])
  assert.deepEqual(stuckWithoutNumber(row({ gov_status: "server_error", gov_error: "KSeF nie odpowiada" }), c)?.errors, ["KSeF nie odpowiada"])

  assert.equal(stuckWithoutNumber(row({ issued_at: ago(2) }), c), null, "not yet N days")
  assert.equal(stuckWithoutNumber(row({ issued_at: ago(KSEF_LATE_WINDOW_DAYS + 1) }), c), null, "older than the window")
  assert.equal(stuckWithoutNumber(row({ gov_id: "123-20261030-AB" , gov_status: "ok" }), c), null, "has its number")
  assert.equal(stuckWithoutNumber(row({ kind: "proforma", gov_status: "not_applicable" }), c), null)
  assert.equal(stuckWithoutNumber(row({ kind: "receipt" }), c), null)
  assert.equal(stuckWithoutNumber(row({ buyer_type: "person" }), c), null, "never sent for a consumer: a companies only account leaves it outside KSeF")
  assert.equal(stuckWithoutNumber(row({ buyer_type: "person", gov_status: "processing" }), c)?.state, "processing", "sent for a consumer: it should come back numbered")
  assert.equal(stuckWithoutNumber(row({ error_code: "remote_missing" }), c), null)
  assert.equal(stuckWithoutNumber(row({ status: "failed" }), c), null)
  assert.equal(stuckWithoutNumber(row(), ctx({ ksefActive: false })), null, "an account KSeF never numbered")
  assert.equal(stuckWithoutNumber(row(), ctx({ ksefStuckAfterDays: 0 })), null, "off")
  assert.equal(stuckWithoutNumber(row({ kind: "correction", gov_status: "processing" }), c)?.kind, "ksef_stuck")
})

test("numbered but never e-mailed: Fakturownia's e-mail or the plugin's clears it; only after one read, N hours, and when e-mails are expected", () => {
  const c = ctx()
  const numbered = { gov_status: "ok", gov_id: "1234563218-20261030-ABCDEF", ksef_number_at: ago(2), remote_email_checked_at: ago(0.01) }
  assert.deepEqual(notEmailed(row(numbered), c), { kind: "not_emailed", since: ago(2).toISOString(), hours: 48 })
  assert.equal(notEmailed(row({ ...numbered, remote_email_status: "sent" }), c), null)
  assert.equal(notEmailed(row({ ...numbered, remote_sent_at: ago(1) }), c), null)
  assert.equal(notEmailed(row({ ...numbered, emailed_at: ago(1) }), c), null, "the plugin sent it")
  assert.equal(notEmailed(row({ ...numbered, ksef_number_at: new Date(NOW.getTime() - 23 * 3600_000) }), c), null, "less than 24 h")
  assert.equal(notEmailed(row({ ...numbered, remote_email_checked_at: null }), c), null, "Fakturownia's e-mail not read yet")
  assert.equal(notEmailed(row({ ...numbered, ksef_number_at: ago(KSEF_LATE_WINDOW_DAYS + 1) }), c), null)
  assert.equal(notEmailed(row(numbered), ctx({ emailsExpected: false })), null)
  assert.equal(notEmailed(row(numbered), ctx({ notEmailedAfterHours: 0 })), null)
  assert.equal(watchOf(row(numbered), c)?.kind, "not_emailed")
  assert.equal(watchOf(row(numbered), null), null)
  assert.equal(remoteEmailed("SENT", null), true)
  assert.equal(remoteEmailed(null, "2026-10-30T10:00:00Z"), true)
  assert.equal(remoteEmailed("not_sent", null), false)
})

test("the service filters say what the rules say, row by row", () => {
  const numbered = { gov_status: "ok", gov_id: "1234563218-20261030-ABCDEF", ksef_number_at: ago(2), remote_email_checked_at: ago(0.01) }
  const rows = [
    row(),
    row({ gov_status: "processing", buyer_type: "person" }),
    row({ gov_status: "send_error" }),
    row({ buyer_type: "person" }),
    row({ issued_at: ago(2) }),
    row({ issued_at: ago(61) }),
    row({ kind: "receipt" }),
    row({ error_code: "remote_missing" }),
    row({ gov_status: "not_applicable" }),
    row({ status: "needs_correction", gov_status: "offline" }),
    row({ fakturownia_id: null }),
    row(numbered),
    row({ ...numbered, remote_email_status: "sent" }),
    row({ ...numbered, remote_email_status: "not_sent" }),
    row({ ...numbered, remote_sent_at: ago(1) }),
    row({ ...numbered, emailed_at: ago(1) }),
    row({ ...numbered, remote_email_checked_at: null }),
    row({ ...numbered, ksef_number_at: ago(0.5) }),
    row({ ...numbered, kind: "proforma" }),
  ]
  for (const c of [ctx(), ctx({ ksefActive: false }), ctx({ emailsExpected: false }), ctx({ ksefStuckAfterDays: 7, notEmailedAfterHours: 72 })]) {
    const or = watchFilters(c)
    rows.forEach((r, i) => {
      assert.equal(or.some((f) => matches(r, f)), watchOf(r, c) !== null, `row ${i} ${JSON.stringify(c).slice(0, 80)}`)
      assert.equal(matches(r, documentFilters("attention", false, c)), watchOf(r, c) !== null || r.status === "needs_correction", `attention row ${i}`)
    })
  }
  assert.deepEqual(watchFilters(ctx({ ksefStuckAfterDays: 0, notEmailedAfterHours: 0 })), [])
  assert.equal(matches(row(), documentFilters("attention", false)), false, "without the watch the list is as in 0.3")
  for (const r of rows.filter((x) => expectsKsefNumber(x))) assert.equal(r.gov_id, null)
})

test("late reads: past the 14 day window up to 60 days, at most once an hour; numbered ones for 2 days while Fakturownia was never seen e-mailing", () => {
  const c = ctx()
  const [stuck, numbered] = lateReadFilters(false, c)
  assert.equal(matches(row({ issued_at: ago(20), gov_checked_at: ago(1) }), stuck), true)
  assert.equal(matches(row({ issued_at: ago(10) }), stuck), false, "the window reads it already")
  assert.equal(matches(row({ issued_at: ago(20), gov_checked_at: new Date(NOW.getTime() - 10 * 60_000) }), stuck), false, "read ten minutes ago")
  assert.equal(matches(row({ issued_at: ago(61) }), stuck), false)
  const n = { gov_status: "ok", gov_id: "X", ksef_number_at: ago(10), gov_checked_at: ago(1) }
  assert.equal(matches(row(n), numbered), true)
  assert.equal(matches(row({ ...n, remote_email_status: "sent" }), numbered), false)
  assert.equal(matches(row({ ...n, emailed_at: ago(1) }), numbered), false)
  const [probe] = lateReadFilters(false, ctx({ ksefActive: false, emailsExpected: false }))
  assert.equal(matches(row(n), probe), false, "10 days old: past the probe")
  assert.equal(matches(row({ ...n, ksef_number_at: ago(1) }), probe), true)
  assert.deepEqual(lateReadFilters(false, ctx({ ksefStuckAfterDays: 0, notEmailedAfterHours: 0 })), [])
})

test("the reminder gate: both must say unpaid; the amount is what Fakturownia has left to pay", () => {
  const base = { medusaUnpaid: true, recordedGross: 143 }
  assert.deepEqual(reminderGate({ ...base, remote: { gross: 143, paid: 0 } }), { send: true, outstanding: 143, basis: "fakturownia", gross: 143, paid: 0 })
  assert.deepEqual(reminderGate({ ...base, remote: { gross: 143, paid: 100 } }), { send: true, outstanding: 43, basis: "fakturownia", gross: 143, paid: 100 })
  assert.deepEqual(reminderGate({ ...base, remote: { gross: 938.1, paid: 922.61 } }), { send: true, outstanding: 15.49, basis: "fakturownia", gross: 938.1, paid: 922.61 })
  const paidThere = reminderGate({ ...base, remote: { gross: 143, paid: 143 } })
  assert.deepEqual(paidThere, { send: false, reason: "paid_in_fakturownia", gross: 143, paid: 143 })
  assert.equal(reminderGate({ ...base, remote: { gross: 143, paid: 142.996 } }).send, false, "half a grosz is paid")
  assert.equal((reminderGate({ ...base, remote: null }) as { reason: string }).reason, "fakturownia_unreachable")
  assert.equal((reminderGate({ medusaUnpaid: false, recordedGross: 143, remote: { gross: 143, paid: 0 } }) as { reason: string }).reason, "paid_in_medusa")
  assert.deepEqual(reminderGate({ ...base, remote: { gross: null, paid: null } }), { send: true, outstanding: 143, basis: "record", gross: null, paid: null })
  if (!paidThere.send) assert.match(reminderRefusalText(paidThere, "PLN"), /Fakturownia has this document paid \(143\.00 PLN of 143\.00 PLN\)/)
})

/* ------------------------------------------------------------------ */
/* The flows                                                           */
/* ------------------------------------------------------------------ */

interface FakeRes {
  statusCode: number
  body: any
  status(code: number): FakeRes
  json(body: unknown): FakeRes
}

function response(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code
      return res
    },
    json(body) {
      res.body = body
      return res
    },
  }
  return res
}

const req = (s: Setup, args: { params?: Row; query?: Row; body?: Row } = {}) =>
  ({ scope: s.container, params: args.params ?? {}, query: args.query ?? {}, body: args.body ?? {}, headers: {}, auth_context: { actor_id: "user_1", actor_type: "user" } }) as never

async function attention(s: Setup): Promise<Row[]> {
  const res = response()
  await documentsRoute(req(s, { query: { filter: "attention", limit: "100" } }), res as never)
  return res.body.documents as Row[]
}

async function issuedLive(options = LIVE, o: Row = order()): Promise<{ s: Setup; fake: FakeFakturownia; doc: Row }> {
  const s = setup(options, [o])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, o.id, options.trigger === "order_placed" ? "order_placed" : "payment_captured")
  await issueDue(s.container, "schedule")
  return { s, fake, doc: s.documents.rows[0] }
}

test("a VAT invoice stuck without a number shows its state in Needs attention, is read past the window and clears itself when the number comes", async () => {
  const { s, fake, doc } = await issuedLive()
  /* Another document of the account was numbered: KSeF is on. */
  s.documents.rows.push({ ...doc, id: "fkdoc_other", order_id: "order_other", gov_status: "ok", gov_id: "1111111111-20261001-AAAAAA", ksef_number_at: new Date(), email_status: null })
  doc.buyer_type = "company"
  assert.deepEqual((await attention(s)).map((d) => d.id), [], "fresh: not yet")

  /* Twenty days later, a KSeF error. */
  doc.issued_at = new Date(Date.now() - 20 * DAY)
  doc.gov_checked_at = new Date(Date.now() - 2 * 3600_000)
  Object.assign(fake.docs[0], { gov_status: "send_error", gov_error_messages: ["Telefon klienta - pole jest za długie"] })
  const before = fake.calls.length
  const pass = await refreshStatuses(s.container, "manual")
  assert.equal(pass?.late, 1, "read past the 14 day window")
  assert.ok(fake.calls.slice(before).some((c) => c.path === `/invoices/${fake.docs[0].id}.json`))
  const listed = await attention(s)
  assert.deepEqual(listed.map((d) => d.id), [doc.id])
  assert.deepEqual([listed[0].watch.kind, listed[0].watch.state, listed[0].watch.errors], ["ksef_stuck", "error", ["Telefon klienta - pole jest za długie"]])

  /* Read again at most once an hour. */
  const quiet = await refreshStatuses(s.container, "manual")
  assert.equal(quiet?.late, 0)

  /* The number comes late: the item goes away by itself. */
  doc.gov_checked_at = new Date(Date.now() - 2 * 3600_000)
  Object.assign(fake.docs[0], { gov_status: "ok", gov_id: "1234563218-20261030-ABCDEF", gov_error_messages: null, email_status: "sent", sent_time: new Date().toISOString() })
  await refreshStatuses(s.container, "manual")
  assert.equal(doc.gov_id, "1234563218-20261030-ABCDEF")
  assert.ok(doc.ksef_number_at instanceof Date, "the moment the number was seen")
  assert.deepEqual([doc.remote_email_status, doc.remote_sent_at instanceof Date], ["sent", true])
  assert.deepEqual(await attention(s), [])
})

test("numbered, Fakturownia did not e-mail it and the plugin did not either: Needs attention with Send by e-mail; sending clears it", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, sendByEmail: false })
  /* Fakturownia e-mailed another document of the account: the buyer is meant to get it by e-mail. */
  s.documents.rows.push({ ...doc, id: "fkdoc_other", order_id: "order_other", remote_email_status: "sent", gov_status: "ok", gov_id: "1111111111-20261001-AAAAAA", ksef_number_at: new Date() })
  Object.assign(fake.docs[0], { gov_status: "ok", gov_id: "1234563218-20261030-ABCDEF", email_status: null, sent_time: null })
  await refreshStatuses(s.container, "manual")
  assert.ok(doc.remote_email_checked_at instanceof Date)
  assert.deepEqual(await attention(s), [], "less than 24 h")

  doc.ksef_number_at = new Date(Date.now() - 30 * 3600_000)
  const listed = await attention(s)
  assert.deepEqual(listed.map((d) => [d.id, d.watch?.kind, d.actions.email]), [[doc.id, "not_emailed", true]])

  await s.planStore.setSetting(writerSettingKey("emails", false), { on: true }, "user_1")
  const res = response()
  await emailRoute(req(s, { params: { id: doc.id }, body: { kind: "manual" } }), res as never)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(await attention(s), [])
})

test("an account that never e-mails through Fakturownia gets no not_emailed noise", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, sendByEmail: false })
  Object.assign(fake.docs[0], { gov_status: "ok", gov_id: "1234563218-20261030-ABCDEF" })
  await refreshStatuses(s.container, "manual")
  doc.ksef_number_at = new Date(Date.now() - 30 * 3600_000)
  assert.deepEqual(await attention(s), [])
})

const armEmails = (s: Setup) => s.planStore.setSetting(writerSettingKey("emails", false), { on: true }, "user_1")

test("a reminder goes out only when Fakturownia says unpaid too, with what is left to pay there", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, trigger: "order_placed" }, unpaid())
  await armEmails(s)
  fake.docs[0].paid = "100.00"
  const res = response()
  await emailRoute(req(s, { params: { id: doc.id }, body: { kind: "reminder" } }), res as never)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.outstanding, 43)
  assert.deepEqual([s.emails.rows.at(-1)?.status, s.emails.rows.at(-1)?.amount], ["sent", 43])
})

test("Fakturownia paid while Medusa is not: no reminder, the reason in the answer, the history and the reminders list", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, trigger: "order_placed" }, unpaid())
  await armEmails(s)
  doc.issue_date = "2026-10-01"
  fake.docs[0].paid = fake.docs[0].price_gross
  const res = response()
  await emailRoute(req(s, { params: { id: doc.id }, body: { kind: "reminder" } }), res as never)
  assert.equal(res.statusCode, 409)
  assert.equal(res.body.reason, "paid_in_fakturownia")
  assert.match(res.body.message, /Fakturownia has this document paid/)
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length, 0)
  assert.deepEqual([s.emails.rows.at(-1)?.status, s.emails.rows.at(-1)?.reason], ["refused", "paid_in_fakturownia"])
  assert.equal(doc.reminder_at ?? null, null, "the daily claim was not taken")

  const list = response()
  await remindersRoute(req(s), list as never)
  const item = (list.body.documents as Row[]).find((r) => r.document.id === doc.id)
  assert.equal(item?.lastRefusal?.reason, "paid_in_fakturownia")
  assert.equal(item?.canRemind, true)
})

test("Fakturownia unreachable, or Medusa has the payment: no reminder", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, trigger: "order_placed" }, unpaid())
  await armEmails(s)
  fake.docs.length = 0
  await assert.rejects(sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" }), (e: unknown) => e instanceof ReminderGateError && e.reason === "fakturownia_unreachable")

  const paid = await issuedLive({ ...LIVE, trigger: "order_placed", markPaidOnCapture: false }, order())
  await armEmails(paid.s)
  paid.doc.paid = false
  await assert.rejects(sendDocumentEmail(paid.s.container, paid.doc.id, { kind: "reminder", actorId: "user_1" }), (e: unknown) => e instanceof ReminderGateError && e.reason === "paid_in_medusa")
})

test("demo: the simulated reminder carries the recorded amount", async () => {
  const s = setup({ demo: true, trigger: "order_placed" }, [unpaid()])
  globalThis.fetch = (async () => {
    throw new Error("demo mode must not call the network")
  }) as typeof fetch
  await enqueueDue(s.container, unpaid().id, "order_placed")
  await issueDue(s.container, "schedule")
  const doc = s.documents.rows[0]
  await s.planStore.setSetting(writerSettingKey("emails", true), { on: true }, "user_1")
  const r = await sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" })
  assert.deepEqual([r.outcome, r.outstanding], ["sent", 143])
})
