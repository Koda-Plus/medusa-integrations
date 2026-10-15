/**
 * App mode history: the e-mails of the store's own provider read from
 * Medusa's notification table (lib/medusa-history.ts). The rows as the log
 * shows them, the data a subject may read, and the SQL with its bindings.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { historyCounts, historyStatus, listAppLog, maskRecipients, subjectData, unionRowToMessage, type HistoryQuery, type SqlRaw } from "../src/modules/emails/lib/medusa-history.ts"

const NOW = new Date("2026-10-14T12:00:00Z")

function fakePg(answers: Array<Array<Record<string, unknown>>>): SqlRaw & { calls: Array<{ sql: string; bindings: unknown[] }> } {
  const calls: Array<{ sql: string; bindings: unknown[] }> = []
  let i = 0
  return {
    calls,
    async raw(sql: string, bindings: unknown[] = []) {
      calls.push({ sql, bindings })
      return { rows: answers[i++] ?? [] }
    },
  }
}

const BASE: HistoryQuery = { filter: "all", limit: 20, offset: 0 }

test("Medusa's statuses read as the log's", () => {
  assert.equal(historyStatus("success"), "sent")
  assert.equal(historyStatus("failure"), "failed")
  assert.equal(historyStatus("pending"), "sending")
})

test("every address of a notification is masked", () => {
  assert.equal(maskRecipients("anna.nowak@example.com, biuro@example.com"), "a***@e***.com, b***@e***.com")
  assert.equal(maskRecipients("not an address"), "***")
  assert.equal(maskRecipients(""), null)
})

test("a subject reads scalars only, never links, tokens or attachments", () => {
  const d = subjectData({
    display_id: 1234,
    first_name: "Anna",
    reset_url: "https://shop.test/reset?token=abc",
    token: "abc",
    guest_token: "def",
    attachment_pdf_base64: "JVBERi0xLjQK",
    items: [{ title: "Krem" }],
    note: "x".repeat(400),
    link_text: "plain",
    homepage: "https://shop.test",
  })
  assert.deepEqual(d, { display_id: 1234, first_name: "Anna" })
})

test("a history row is masked, has no body, cannot be retried and takes the template's subject", () => {
  const m = unionRowToMessage(
    {
      source: "medusa",
      id: "noti_01",
      template: "order-confirmation",
      locale: "pl",
      status: "failure",
      recipient: "anna.nowak@example.com",
      order_id: "order_01ABC",
      customer_id: "cus_01XYZ",
      external_id: null,
      created_at: NOW,
      updated_at: NOW,
      data: { display_id: 1234, token: "abc" },
    },
    (template, data, locale) => `${template} #${String(data.display_id)} ${locale} ${"token" in data ? "LEAK" : "ok"}`,
  )
  assert.equal(m.source, "medusa")
  assert.equal(m.kind, "medusa")
  assert.equal(m.status, "failed")
  assert.equal(m.error_code, "PROVIDER_ERROR")
  assert.equal(m.recipient, "a***@e***.com")
  assert.equal(m.subject, "order-confirmation #1234 pl ok")
  assert.equal(m.order_id, "order_01ABC")
  assert.equal(m.customer_id, "cus_01XYZ")
  assert.equal(m.retryable, false)
  assert.equal(m.body_html, null)
  assert.equal(m.notification_id, "noti_01")
})

test("a plugin row of the union stays as stored, and a subject that throws is no subject", () => {
  const own = unionRowToMessage({ source: "plugin", id: "emsg_1", key: "k", template: "welcome", kind: "app", status: "sent", recipient: "a***@e***.com", subject: "Witaj", created_at: NOW, updated_at: NOW }, () => "never")
  assert.equal(own.source, "plugin")
  assert.equal(own.kind, "app")
  assert.equal(own.subject, "Witaj")
  const throwing = unionRowToMessage({ source: "medusa", id: "noti_2", template: "welcome", status: "success", recipient: "a@example.com", created_at: NOW, updated_at: NOW }, () => {
    throw new Error("bad template")
  })
  assert.equal(throwing.subject, null)
  assert.equal(throwing.status, "sent")
})

test("an order id that is not one is dropped", () => {
  const m = unionRowToMessage({ source: "medusa", id: "noti_3", template: "x", status: "success", order_id: "1234", created_at: NOW, updated_at: NOW }, () => null)
  assert.equal(m.order_id, null)
})

test("before the migrations the log is the history alone", async () => {
  const pg = fakePg([[{ ok: false }], [{ source: "medusa", id: "noti_1", template: "welcome", status: "success", recipient: "a@example.com", created_at: NOW, updated_at: NOW }], [{ n: 1 }]])
  const r = await listAppLog(pg, { ...BASE, template: "welcome", since: NOW }, () => null)
  assert.equal(r.ownTable, false)
  assert.equal(r.count, 1)
  assert.equal(r.rows[0].source, "medusa")
  const page = pg.calls[1]
  assert.ok(!page.sql.includes("emails_message"), "no own table, no own rows and no dedupe against it")
  assert.ok(page.sql.includes(`from "notification" n`))
  assert.deepEqual(page.bindings, ["welcome", NOW, 20, 0])
  assert.deepEqual(pg.calls[2].bindings, ["welcome", NOW])
})

test("with the migrations the plugin's rows join and a reported notification is listed once", async () => {
  const pg = fakePg([[{ ok: true }], [], [{ n: 0 }]])
  await listAppLog(pg, { ...BASE, orderId: "order_01ABC", limit: 10, offset: 30 }, () => null)
  const page = pg.calls[1]
  assert.ok(page.sql.includes(`from "emails_message" m where`))
  assert.ok(page.sql.includes("union all"))
  assert.ok(page.sql.includes("not exists (select 1 from \"emails_message\" m2 where m2.notification_id = n.id"))
  assert.deepEqual(page.bindings, ["order_01ABC", "order_01ABC", 10, 30])
})

test("skips, tests and refusals come from the plugin's rows only", async () => {
  for (const filter of ["skipped", "test", "bounced"] as const) {
    const pg = fakePg([[{ ok: true }], [], [{ n: 0 }]])
    await listAppLog(pg, { ...BASE, filter }, () => null)
    assert.ok(!pg.calls[1].sql.includes(`from "notification" n where`), filter)
  }
  const none = fakePg([[{ ok: false }]])
  const r = await listAppLog(none, { ...BASE, filter: "test" }, () => null)
  assert.deepEqual(r, { rows: [], count: 0, ownTable: false })
  assert.equal(none.calls.length, 1)
})

test("showAddresses: part of an address is searched in both sources and shown in full", async () => {
  const pg = fakePg([[{ ok: true }], [{ source: "medusa", id: "noti_1", template: "order-placed", status: "success", recipient: "Jonik.Agnieszka@gmail.com", recipient_full: "Jonik.Agnieszka@gmail.com", created_at: new Date() }], [{ n: 1 }]])
  const r = await listAppLog(pg, { ...BASE, text: "jonik", addresses: true }, () => null)
  assert.ok(pg.calls[1].sql.includes(`n."to" ilike ?`))
  assert.ok(pg.calls[1].sql.includes(`n4."to" ilike ?`))
  assert.equal(pg.calls[1].bindings.filter((b: unknown) => b === "%jonik%").length, 6)
  assert.equal(r.rows[0].recipient, "jonik.agnieszka@gmail.com")
  const masked = await listAppLog(fakePg([[{ ok: true }], [{ source: "medusa", id: "noti_1", template: "x", status: "success", recipient: "jonik.agnieszka@gmail.com", recipient_full: "jonik.agnieszka@gmail.com", created_at: new Date() }], [{ n: 1 }]]), { ...BASE }, () => null)
  assert.notEqual(masked.rows[0].recipient, "jonik.agnieszka@gmail.com")
})

test("bounced with Resend data: suppressed addresses and bounced ids in both sources", async () => {
  const pg = fakePg([[{ ok: true }], [], [{ n: 0 }]])
  await listAppLog(pg, { ...BASE, filter: "bounced", bounced: { emails: ["a@gmial.com"], ids: ["id-1"] } }, () => null)
  const sql = pg.calls[1].sql
  assert.ok(sql.includes(`from "notification" n where`), "history is read for bounced when Resend data is there")
  assert.ok(sql.includes("n.external_id in (?)"))
  assert.ok(sql.includes("m.external_id in (?)"))
  assert.equal(pg.calls[1].bindings.filter((b: unknown) => b === "a@gmial.com").length, 2)
  const none = fakePg([[{ ok: true }], [], [{ n: 0 }]])
  await listAppLog(none, { ...BASE, filter: "bounced" }, () => null)
  assert.ok(!none.calls[1].sql.includes(`from "notification" n where`), "without Resend data history has no bounces")
})

test("an address search matches the hash of the plugin's rows and the address in Medusa's", async () => {
  const pg = fakePg([[{ ok: true }], [], [{ n: 0 }]])
  await listAppLog(pg, { ...BASE, email: "Anna@Example.com", emailHash: "h1" }, () => null)
  assert.deepEqual(pg.calls[1].bindings, ["h1", "anna@example.com", 20, 0])
})

test("a text search escapes the wildcards and also finds an order number", async () => {
  const pg = fakePg([[{ ok: false }], [], [{ n: 0 }]])
  await listAppLog(pg, { ...BASE, text: "#12_34%" }, () => null)
  assert.deepEqual(pg.calls[1].bindings.slice(0, 5), ["%#12\\_34\\%%", "#12_34%", "#12_34%", "#12_34%", "12_34%"])
})

test("the board numbers leave out what the plugin's rows already count", async () => {
  const pg = fakePg([
    [{ sent24h: 2, sent30d: 40, failed30d: 3, total: 500, first_at: "2026-03-29T00:00:00Z" }],
    [{ template: "welcome", status: "success", count: 4, last_at: NOW }],
  ])
  const c = await historyCounts(pg, NOW, true)
  assert.equal(c.total, 500)
  assert.equal(c.firstAt, "2026-03-29T00:00:00.000Z")
  assert.deepEqual(c.byTemplate, [{ template: "welcome", status: "sent", count: 4, last_at: NOW }])
  assert.ok(pg.calls.every((call) => call.sql.includes("m2.notification_id = n.id")))
  const plain = fakePg([[{ total: 0 }], []])
  await historyCounts(plain, NOW, false)
  assert.ok(plain.calls.every((call) => !call.sql.includes("emails_message")))
})
