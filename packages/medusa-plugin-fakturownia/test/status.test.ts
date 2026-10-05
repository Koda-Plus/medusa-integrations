import { test } from "node:test"
import assert from "node:assert/strict"
import { toDocumentDto, toRunDto, type DocumentRow } from "../src/modules/fakturownia/lib/dto.ts"
import { baseGovStatus, goesToKsef, govState, isGovFinal, isWaitingForKsef } from "../src/modules/fakturownia/lib/status.ts"

test("KSeF status: every documented value, the demo_ twins, and unknown values as problems", () => {
  assert.equal(govState("ok"), "accepted")
  assert.equal(govState("demo_ok"), "accepted")
  assert.equal(govState("processing"), "processing")
  assert.equal(govState("offline"), "offline")
  assert.equal(govState("not_applicable"), "not_applicable")
  for (const s of ["send_error", "server_error", "status_check_error", "offline_error", "duplicate_error", "blocked_403_error", "not_connected", "demo_send_error"]) {
    assert.equal(govState(s), "problem", s)
  }
  assert.equal(govState("something_new"), "problem", "a value this version does not know: a person should look")
  assert.equal(govState(null), "none")
  assert.equal(govState(""), "none")
  assert.equal(baseGovStatus("DEMO_OK"), "ok")
})

test("the refresh stops at accepted and not applicable; only VAT invoices go to KSeF", () => {
  assert.deepEqual(["ok", "demo_ok", "not_applicable", "processing", "send_error", null].map(isGovFinal), [true, true, true, false, false, false])
  assert.deepEqual(["vat", "proforma", "receipt"].map(goesToKsef), [true, false, false])
})

test("an e-mail refused for a missing KSeF number waits; other refusals do not", () => {
  assert.equal(isWaitingForKsef("Fakturownia send_by_email: API_ERROR Faktura nie może zostać wysłana - brak numeru KSeF"), true)
  assert.equal(isWaitingForKsef("HTTP_404 not found"), false)
})

function row(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: "fkdoc_1",
    order_id: "order_1",
    display_id: 1042,
    kind: "vat",
    status: "issued",
    demo: false,
    fakturownia_id: "600000001",
    number: "FV 1/10/2026",
    oid: "1042",
    issue_date: "2026-10-05",
    currency: "PLN",
    total_gross: "143.00",
    positions: [{ name: "Krem", code: "KREM-50", quantity: 2, unit: "szt.", gross: 123, tax: "23" }],
    buyer_type: "person",
    from_fakturownia_id: null,
    paid: true,
    paid_at: new Date("2026-10-05T10:00:00Z"),
    pay_requested_at: null,
    gov_status: "processing",
    gov_id: null,
    gov_error: null,
    gov_checked_at: null,
    error: null,
    error_code: null,
    attempts: 1,
    next_attempt_at: null,
    claim_token: "secret-claim",
    claimed_at: null,
    lease_until: null,
    issued_at: new Date("2026-10-05T10:00:00Z"),
    cancel_requested_at: null,
    email_status: null,
    emailed_at: null,
    email_error: null,
    created_at: "2026-10-05T09:59:00Z",
    updated_at: "2026-10-05T10:00:00Z",
    ...over,
  }
}

test("DTO: amounts from the numeric column, positions, the KSeF state, no claim token", () => {
  const dto = toDocumentDto(row(), "https://mojafirma.fakturownia.pl")
  assert.equal(dto.totalGross, 143)
  assert.equal(dto.govState, "processing")
  assert.equal(dto.positions[0].gross, 123)
  assert.equal(dto.issuedAt, "2026-10-05T10:00:00.000Z")
  assert.ok(!JSON.stringify(dto).includes("secret-claim"))
  assert.equal(dto.fakturowniaUrl, "https://mojafirma.fakturownia.pl/invoices/600000001")
  assert.deepEqual(dto.actions, { retry: false, reconcile: false, issueAgain: false, markIssued: false, pdf: true, email: true, ksefResend: false, ksefFiles: false })
})

test("DTO: the panel link only in live mode; the PDF for every document that exists (demo ones are generated)", () => {
  assert.equal(toDocumentDto(row(), null).fakturowniaUrl, null, "demo mode has no account url")
  assert.equal(toDocumentDto(row({ demo: true }), "https://mojafirma.fakturownia.pl").actions.pdf, true)
  assert.equal(toDocumentDto(row({ demo: true }), "https://mojafirma.fakturownia.pl").fakturowniaUrl, null)
  assert.equal(toDocumentDto(row({ status: "pending", fakturownia_id: null }), "https://mojafirma.fakturownia.pl").fakturowniaUrl, null)
  assert.equal(toDocumentDto(row({ fakturownia_id: "../x" }), "https://mojafirma.fakturownia.pl").fakturowniaUrl, null)
})

test("DTO: the actions follow the state; unknown values fall back safely", () => {
  assert.deepEqual(toDocumentDto(row({ status: "failed", fakturownia_id: null }), null).actions, {
    retry: true,
    reconcile: false,
    issueAgain: false,
    markIssued: true,
    pdf: false,
    email: false,
    ksefResend: false,
    ksefFiles: false,
  })
  assert.deepEqual(toDocumentDto(row({ status: "unknown", fakturownia_id: null }), "https://x.fakturownia.pl").actions, {
    retry: false,
    reconcile: true,
    issueAgain: true,
    markIssued: true,
    pdf: false,
    email: false,
    ksefResend: false,
    ksefFiles: false,
  })
  const odd = toDocumentDto(row({ status: "weird", kind: "weird", email_status: "weird", total_gross: null, positions: "not json" }), null)
  assert.deepEqual([odd.status, odd.kind, odd.emailStatus, odd.totalGross, odd.positions], ["pending", "vat", null, null, []])
})

test("runs: kinds, sources, triggers and statuses map to the contract", () => {
  const dto = toRunDto({ id: "r", kind: "payments", source: "demo", trigger: "auto", status: "partial", complete: true, counts: { marked: 1 }, message: null, duration_ms: 5, started_at: "2026-10-05T10:00:00Z", finished_at: null })
  assert.deepEqual([dto.kind, dto.source, dto.trigger, dto.status, dto.durationMs], ["payments", "demo", "auto", "partial", 5])
  const odd = toRunDto({ id: "r", kind: "x", source: "x", trigger: "x", status: "x", complete: false, counts: null, message: null, duration_ms: 0, started_at: "bad", finished_at: null })
  assert.deepEqual([odd.kind, odd.source, odd.trigger, odd.status, odd.startedAt], ["issue", "api", "manual", "error", "1970-01-01T00:00:00.000Z"])
})
