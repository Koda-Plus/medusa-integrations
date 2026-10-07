/**
 * Exactly once under load (0.3.0): the claim of a slow attempt is proven
 * before anything leaves, the automatic e-mail, the payment reminder and
 * "Send to KSeF again" are taken atomically, and the passes pick their rows
 * in the database, whatever the number of documents.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { claimLeaseMs, reconcileGraceMs, ISSUE_LEASE_MS, RECONCILE_GRACE_MS } from "../src/modules/fakturownia/lib/constants.ts"
import { enqueueDue, issueDue, issueRow } from "../src/workflows/fakturownia/documents.ts"
import { expireEmailClaims, sendAutoEmail, sendDocumentEmail } from "../src/workflows/fakturownia/emails.ts"
import { resendToKsef } from "../src/workflows/fakturownia/ksef.ts"
import { ksefCandidates, refreshStatuses } from "../src/workflows/fakturownia/statuses.ts"
import { markPaidDue } from "../src/workflows/fakturownia/payments.ts"
import { scanCorrections } from "../src/workflows/fakturownia/corrections.ts"
import { ActionError } from "../src/workflows/fakturownia/runtime.ts"
import { writerSettingKey } from "../src/modules/fakturownia/lib/writers.ts"
import { FakeFakturownia, LIVE, order, setup, unpaid, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000)
const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 5))
  assert.ok(ok(), "the condition never came")
}

async function issuedLive(options = LIVE, o: Row = order()): Promise<{ s: Setup; fake: FakeFakturownia; doc: Row }> {
  const s = setup(options, [o])
  const fake = new FakeFakturownia()
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, o.id, options.trigger === "order_placed" ? "order_placed" : "payment_captured")
  await issueDue(s.container, "schedule")
  const doc = s.documents.rows[0]
  assert.equal(doc.status, "issued")
  return { s, fake, doc }
}

async function arm(s: Setup, writer: "emails" | "ksef" | "corrections"): Promise<void> {
  await s.planStore.setSetting(writerSettingKey(writer, false), { on: true }, "user_1")
}

test("the lease follows timeoutMs, and the grace of a lost answer counts from the request plus its timeout", () => {
  assert.equal(claimLeaseMs(30_000), ISSUE_LEASE_MS)
  assert.equal(claimLeaseMs(60_000), 15 * 60_000)
  assert.equal(claimLeaseMs(120_000), 30 * 60_000)
  assert.equal(reconcileGraceMs(30_000), RECONCILE_GRACE_MS + 30_000)
})

test("a slow attempt whose claim ran out sends nothing: the other process issued the document once", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  /* The first lookup (the slow attempt's) answers "nothing there" and then hangs, like a Fakturownia that answers in minutes. */
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let held = false
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (!held && (init?.method ?? "GET") === "GET" && url.pathname === "/invoices.json") {
      held = true
      const answer = await fake.fetch(input, init)
      await gate
      return answer
    }
    return fake.fetch(input, init)
  }) as typeof fetch

  await enqueueDue(s.container, order().id, "payment_captured")
  const row = s.documents.rows[0]
  const slow = issueRow(s.container, { ...row })
  await until(() => held)
  assert.equal(row.status, "issuing")

  /* Meanwhile its lease runs out and another process takes the row over: unknown, nothing found, issued. */
  row.lease_until = ago(1)
  row.claimed_at = ago(30)
  const other = await issueDue(s.container, "schedule")
  assert.equal(other?.expired, 1)
  assert.equal(row.status, "issued")
  assert.equal(fake.creating(), 1)

  release()
  const outcome = await slow
  assert.deepEqual([outcome.status, outcome.code], ["busy", "claim_lost"])
  assert.equal(fake.creating(), 1, "the slow attempt never sent its create request")
  assert.equal(fake.docs.length, 1, "one document in Fakturownia")
  assert.equal(row.status, "issued")
  assert.equal(row.number, "FV 1/10/2026")
  assert.equal(s.events.filter((e) => e.name === "fakturownia.document_failed").length, 0)
  assert.ok(s.logs.some((l) => l.includes("claim ran out")))
})

test("the claim's owner stamps the moment its create request leaves; the next claim clears it", async () => {
  const s = setup(LIVE, [order()])
  const fake = new FakeFakturownia()
  fake.createModes = ["lost_no_commit"]
  globalThis.fetch = fake.fetch
  await enqueueDue(s.container, order().id, "payment_captured")
  const before = Date.now()
  await issueDue(s.container, "schedule")
  const row = s.documents.rows[0]
  assert.equal(row.status, "unknown")
  assert.ok(row.create_sent_at instanceof Date && row.create_sent_at.getTime() >= before, "stamped right before the request")
  assert.ok(row.next_attempt_at.getTime() >= Date.now() + RECONCILE_GRACE_MS - 5_000)
  await s.store.transition(row.id, ["unknown"], { status: "pending", next_attempt_at: new Date(0) })
  const claimed = await s.store.claim(row.id, { now: new Date(), leaseUntil: new Date(Date.now() + 60_000), token: "t2" })
  assert.equal(claimed?.create_sent_at, null)
  assert.equal(await s.store.renew(row.id, "someone-else", { leaseUntil: new Date() }), false, "only the owner renews")
  assert.equal(await s.store.renew(row.id, "t2", { leaseUntil: new Date(Date.now() + 120_000), createSentAt: new Date() }), true)
})

test("the automatic e-mail is taken once: two passes at the same time send it once", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, sendByEmail: true }, order())
  assert.equal(doc.email_status, "sent")
  /* The same e-mail queued again (an adopted document), and two processes see it pending at once. */
  doc.email_status = "pending"
  const sends = () => fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length
  const before = sends()
  const [a, b] = await Promise.all([sendAutoEmail(s.container, { ...doc }, 3), sendAutoEmail(s.container, { ...doc }, 3)])
  assert.deepEqual([a, b].sort(), ["sent", "skipped"])
  assert.equal(sends() - before, 1)
  assert.equal(doc.email_status, "sent")
})

test("an e-mail left half sent by a stopped process fails with a note, and is never sent again", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, sendByEmail: true }, order())
  const sends = fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length
  Object.assign(doc, { email_status: "sending", email_claimed_at: ago(20) })
  assert.equal(await expireEmailClaims(s.container), 1)
  assert.equal(doc.email_status, "failed")
  assert.match(doc.email_error, /may have gone out/)
  assert.equal(await sendAutoEmail(s.container, { ...doc }, 3), "skipped")
  await refreshStatuses(s.container, "manual")
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length, sends)
  /* A fresh claim is not touched. */
  Object.assign(doc, { email_status: "sending", email_claimed_at: ago(1) })
  assert.equal(await expireEmailClaims(s.container), 0)
})

test("two clicks of a reminder send one; a refused reminder may be tried again at once", async () => {
  const { s, fake, doc } = await issuedLive({ ...LIVE, trigger: "order_placed" }, unpaid())
  await arm(s, "emails")
  const results = await Promise.allSettled([
    sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" }),
    sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_2" }),
  ])
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.ok(results.some((r) => r.status === "rejected" && r.reason instanceof ActionError && r.reason.status === 409))
  assert.equal(fake.calls.filter((c) => c.path.endsWith("/send_by_email.json")).length, 1)

  /* A day later Fakturownia refuses it: the slot is given back. */
  s.emails.rows.forEach((e) => (e.created_at = ago(25 * 60)))
  doc.reminder_at = ago(25 * 60)
  fake.emailMode = "ksef_wait"
  const refused = await sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" })
  assert.equal(refused.outcome, "refused")
  assert.equal(doc.reminder_at, null)
  fake.emailMode = "ok"
  assert.equal((await sendDocumentEmail(s.container, doc.id, { kind: "reminder", actorId: "user_1" })).outcome, "sent")
})

test("two clicks of Send to KSeF again send one request", async () => {
  const { s, fake, doc } = await issuedLive()
  await arm(s, "ksef")
  doc.gov_status = "send_error"
  fake.docs[0].gov_status = "send_error"
  const results = await Promise.allSettled([resendToKsef(s.container, doc.id, "user_1"), resendToKsef(s.container, doc.id, "user_2")])
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  assert.ok(results.some((r) => r.status === "rejected" && r.reason instanceof ActionError && /five minutes/.test(r.reason.message)))
  assert.equal(fake.calls.filter((c) => c.query.get("send_to_ksef") === "yes").length, 1)
})

test("KSeF: never checked first, then the least recently checked, chosen in the database beyond 500 documents", async () => {
  const s = setup(LIVE)
  const issuedAt = ago(60)
  for (let i = 0; i < 600; i += 1) {
    s.documents.rows.push({
      id: `fkdoc_k${String(i).padStart(4, "0")}`,
      order_id: `order_k${i}`,
      display_id: 5000 + i,
      kind: "vat",
      status: "issued",
      demo: false,
      fakturownia_id: String(700_000 + i),
      gov_status: i < 550 ? "ok" : "processing",
      gov_checked_at: i < 580 ? ago(10) : null,
      issued_at: issuedAt,
      error_code: null,
      ksef_resend_at: null,
      deleted_at: null,
    })
  }
  /* An old document sent to KSeF again yesterday is read too; one deleted in Fakturownia is not. */
  s.documents.rows.push({ id: "fkdoc_old", order_id: "order_old", kind: "vat", status: "issued", demo: false, fakturownia_id: "1", gov_status: "processing", gov_checked_at: ago(60), issued_at: ago(30 * 24 * 60), ksef_resend_at: ago(24 * 60), error_code: null, deleted_at: null })
  s.documents.rows.push({ id: "fkdoc_gone", order_id: "order_gone", kind: "vat", status: "issued", demo: false, fakturownia_id: "2", gov_status: "processing", gov_checked_at: ago(500), issued_at: ago(60), ksef_resend_at: null, error_code: "remote_missing", deleted_at: null })
  const picked = await ksefCandidates(s.container, new Date(), 40)
  assert.equal(picked.length, 40)
  assert.deepEqual(
    picked.slice(0, 20).map((r) => r.id),
    Array.from({ length: 20 }, (_, i) => `fkdoc_k${String(580 + i).padStart(4, "0")}`),
    "the twenty never checked first",
  )
  assert.ok(picked.every((r) => r.gov_status !== "ok"))
  assert.ok(picked.some((r) => r.id === "fkdoc_old"))
  assert.ok(!picked.some((r) => r.id === "fkdoc_gone"))
})

test("the correction scan picks never checked documents first and stamps every one it checked", async () => {
  const s = setup(LIVE)
  for (let i = 0; i < 30; i += 1) {
    s.documents.rows.push({ id: `fkdoc_c${i}`, order_id: `order_c${i}`, kind: "vat", status: "issued", demo: false, issued_at: ago(60), corrections_checked_at: i < 25 ? ago(30 - i) : null, positions: [], deleted_at: null })
  }
  await scanCorrections(s.container, "manual")
  const stamped = s.documents.rows.filter((r) => r.corrections_checked_at && r.corrections_checked_at > ago(1))
  assert.equal(stamped.length, 20)
  for (const id of ["fkdoc_c25", "fkdoc_c29", "fkdoc_c0"]) assert.ok(stamped.some((r) => r.id === id), id)
})

test("a payment that keeps failing goes to the end of the queue instead of holding its head", async () => {
  const s = setup({ ...LIVE, trigger: "order_placed" }, [unpaid()])
  const fake = new FakeFakturownia()
  let failing = false
  /* Set before the first request: the client keeps the fetch it was built with. */
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    if (failing && new URL(String(input)).pathname.startsWith("/invoices/")) return new Response("<html>503</html>", { status: 503 })
    return fake.fetch(input, init)
  }) as typeof fetch
  await enqueueDue(s.container, unpaid().id, "order_placed")
  await issueDue(s.container, "schedule")
  const doc = s.documents.rows[0]
  assert.deepEqual([doc.status, doc.paid], ["issued", false])
  s.orders.set(doc.order_id, order())
  doc.pay_requested_at = ago(60)
  failing = true
  await markPaidDue(s.container, "manual")
  assert.equal(doc.paid, false)
  assert.ok(doc.pay_requested_at > ago(1), "moved to the end of the queue, still requested")
})
