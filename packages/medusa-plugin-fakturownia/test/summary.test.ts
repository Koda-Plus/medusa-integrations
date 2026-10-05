/**
 * The monthly summary and the list of unpaid documents for reminders.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { monthKey, monthlySummary, type SummaryRow } from "../src/modules/fakturownia/lib/summary.ts"
import { enqueueDue, issueDue } from "../src/workflows/fakturownia/documents.ts"
import { GET as remindersRoute } from "../src/api/admin/fakturownia/reminders/route.ts"
import { GET as summaryRoute } from "../src/api/admin/fakturownia/summary/route.ts"
import { FakeFakturownia, LIVE, setup, unpaid, type Row } from "./helpers.ts"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const NOW = new Date("2026-10-06T12:00:00Z")

function row(over: Partial<SummaryRow> = {}): SummaryRow {
  return { kind: "vat", status: "issued", issue_date: "2026-10-02", total_gross: 143, currency: "PLN", paid: true, gov_status: "ok", fakturownia_id: "1", from_fakturownia_id: null, ...over }
}

test("months newest first, also across a year", () => {
  assert.equal(monthKey(NOW, 0), "2026-10")
  assert.equal(monthKey(NOW, 10), "2025-12")
  const months = monthlySummary([], NOW, 12)
  assert.equal(months.length, 12)
  assert.deepEqual([months[0].month, months[11].month], ["2026-10", "2025-11"])
})

test("counts and values per kind and currency; corrections with their own sign; other states left out", () => {
  const [oct, sep] = monthlySummary(
    [
      row(),
      row({ total_gross: "56.50" }),
      row({ kind: "correction", total_gross: -61.5, gov_status: "processing" }),
      row({ currency: "eur", total_gross: 10 }),
      row({ kind: "receipt", gov_status: "not_applicable" }),
      row({ issue_date: "2026-09-30", status: "needs_correction" }),
      row({ status: "pending" }),
      row({ status: "canceled" }),
      row({ issue_date: "2024-01-01" }),
    ],
    NOW,
  )
  assert.equal(oct.kinds.vat.count, 3)
  assert.deepEqual(oct.kinds.vat.gross, [
    { currency: "PLN", amount: 199.5 },
    { currency: "EUR", amount: 10 },
  ])
  assert.deepEqual([oct.kinds.correction.count, oct.kinds.correction.gross], [1, [{ currency: "PLN", amount: -61.5 }]])
  assert.equal(oct.kinds.receipt.count, 1)
  assert.equal(sep.kinds.vat.count, 1)
})

test("unpaid: documents issued unpaid; a proforma turned into a final document is not counted twice", () => {
  const [oct] = monthlySummary(
    [
      row({ kind: "proforma", paid: false, fakturownia_id: "10", gov_status: "not_applicable" }),
      row({ paid: false, from_fakturownia_id: "10" }),
      row({ kind: "proforma", paid: false, fakturownia_id: "11", total_gross: 50, gov_status: "not_applicable" }),
      row({ kind: "correction", paid: false, total_gross: -20 }),
    ],
    NOW,
  )
  assert.deepEqual([oct.unpaidCount, oct.unpaid], [2, [{ currency: "PLN", amount: 193 }]])
})

test("the KSeF share counts only documents that went to KSeF; none sent means no share", () => {
  const [oct] = monthlySummary([row(), row({ gov_status: "send_error" }), row({ gov_status: "demo_ok" }), row({ gov_status: null }), row({ kind: "receipt", gov_status: "not_applicable" })], NOW)
  assert.deepEqual(oct.ksef, { accepted: 2, total: 3, share: 0.6667 })
  assert.equal(monthlySummary([row({ gov_status: null })], NOW)[0].ksef.share, null)
})

function response() {
  const res = { statusCode: 200, body: undefined as unknown, status: (c: number) => ((res.statusCode = c), res), json: (b: unknown) => ((res.body = b), res) }
  return res
}

test("the routes: twelve months of the current mode, and the unpaid documents older than the option with their reminders", async () => {
  const s = setup({ ...LIVE, trigger: "order_placed", reminderAfterDays: 7 }, [unpaid(), unpaid({ id: "order_2", display_id: 1043 })])
  globalThis.fetch = new FakeFakturownia().fetch
  for (const id of [unpaid().id, "order_2"]) await enqueueDue(s.container, id, "order_placed")
  await issueDue(s.container, "schedule")
  const [old, fresh] = s.documents.rows
  old.issue_date = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)
  s.emails.rows.push({ id: "fkmail_1", document_id: old.id, kind: "reminder", status: "sent", created_at: new Date(Date.now() - 3600_000), deleted_at: null })

  const res = response()
  await remindersRoute({ scope: s.container, query: {} } as never, res as never)
  const body = res.body as { afterDays: number; count: number; documents: Row[] }
  assert.deepEqual([body.afterDays, body.count, body.documents.length], [7, 1, 1])
  assert.deepEqual([body.documents[0].document.id, body.documents[0].ageDays, body.documents[0].reminders, body.documents[0].canRemind], [old.id, 10, 1, false])
  assert.ok(fresh)

  const sum = response()
  await summaryRoute({ scope: s.container, query: {} } as never, sum as never)
  const months = (sum.body as { months: Row[]; capped: boolean }).months
  assert.equal(months.length, 12)
  assert.equal(
    months.reduce((n, m) => n + m.kinds.vat.count, 0),
    2,
  )
})
