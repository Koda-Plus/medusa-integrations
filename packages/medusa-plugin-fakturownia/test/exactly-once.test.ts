import { test } from "node:test"
import assert from "node:assert/strict"
import { DocumentConflictError, FakturowniaApiError, FakturowniaUnknownResultError } from "../src/modules/fakturownia/lib/errors.ts"
import {
  createOnce,
  lookupExisting,
  matchCandidates,
  reconcile,
  toRemoteDocument,
  type MatchOutcome,
  type MatchSpec,
  type RemoteDocument,
} from "../src/modules/fakturownia/lib/exactly-once.ts"

function doc(over: Partial<RemoteDocument> = {}): RemoteDocument {
  return {
    id: "600000001",
    number: "FV 1/10/2026",
    kind: "vat",
    oid: "1042",
    gross: 143,
    currency: "PLN",
    issueDate: "2026-10-05",
    paid: 143,
    status: "paid",
    govStatus: "processing",
    govId: null,
    govErrors: null,
    fromInvoiceId: null,
    ...over,
  }
}

const spec: MatchSpec = { oid: "1042", kind: "vat", totalGross: 143, currency: "PLN", notBefore: "2026-09-28", fromInvoiceId: null }

test("documents of the API answer: ids as text, amounts as numbers, KSeF errors joined", () => {
  const d = toRemoteDocument({
    id: 600000001,
    number: "FV 1/10/2026",
    kind: "VAT",
    oid: 1042,
    price_gross: "143.0",
    currency: "pln",
    issue_date: "2026-10-05",
    paid: "0.0",
    gov_status: "send_error",
    gov_error_messages: ["Telefon klienta - pole jest za długie", "x"],
    from_invoice_id: 501,
  })
  assert.deepEqual(d, {
    id: "600000001",
    number: "FV 1/10/2026",
    kind: "vat",
    oid: "1042",
    gross: 143,
    currency: "PLN",
    issueDate: "2026-10-05",
    paid: 0,
    status: null,
    govStatus: "send_error",
    govId: null,
    govErrors: "Telefon klienta - pole jest za długie; x",
    fromInvoiceId: "501",
    invoiceId: null,
    internalNote: null,
    govErrorList: ["Telefon klienta - pole jest za długie", "x"],
    govSendDate: null,
    govVerificationLink: null,
    govLink: null,
    govCorrectedNumber: null,
  })
  assert.equal(toRemoteDocument({ number: "x" }), null)
  assert.equal(toRemoteDocument(null), null)
})

test("matching: the exact order number and kind; another kind or an older shop's document is not ours", () => {
  assert.equal(matchCandidates([doc()], spec).kind, "match")
  assert.equal(matchCandidates([doc({ kind: "proforma" })], spec).kind, "none", "the proforma of the same order is not the VAT invoice")
  assert.equal(matchCandidates([doc({ oid: "10420" })], spec).kind, "none", "a longer number is another order")
  assert.equal(matchCandidates([doc({ issueDate: "2024-03-01", gross: 99 })], spec).kind, "none", "an earlier shop numbered orders the same way")
  assert.equal(matchCandidates([], spec).kind, "none")
})

test("matching: the same number with another amount is a conflict, never adopted", () => {
  const out = matchCandidates([doc({ gross: 99, number: "FV 7/10/2026" })], spec)
  assert.equal(out.kind, "conflict")
  assert.ok(out.kind === "conflict" && out.reason.includes("FV 7/10/2026") && out.reason.includes("99"))
  assert.equal(matchCandidates([doc({ currency: "EUR" })], spec).kind, "conflict", "another currency is another document")
  assert.equal(matchCandidates([doc({ gross: 143.004 })], spec).kind, "match", "a rounding cent is the same amount")
})

test("matching: the newest matching document wins; with no known total any match is taken", () => {
  const out = matchCandidates([doc({ id: "600000001" }), doc({ id: "600000009", number: "FV 9/10/2026" })], spec)
  assert.equal(out.kind === "match" && out.doc.number, "FV 9/10/2026")
  assert.equal(matchCandidates([doc({ gross: 5 })], { ...spec, totalGross: null }).kind, "match")
})

test("matching: a final document is also found by the proforma it was made from", () => {
  const out = matchCandidates([doc({ oid: "edited by a person", fromInvoiceId: "501" })], { ...spec, fromInvoiceId: "501" })
  assert.equal(out.kind, "match")
})

test("lookup: by order number and kind in the window, plus documents made from the proforma", async () => {
  const seen: unknown[] = []
  const out = await lookupExisting(
    {
      findByOid: async (args) => {
        seen.push(args)
        return []
      },
      findGeneratedFrom: async (id) => {
        seen.push(id)
        return [doc({ oid: "1042", fromInvoiceId: id })]
      },
    },
    { ...spec, fromInvoiceId: "501" },
    { dateFrom: "2026-09-28", dateTo: "2026-10-06" },
  )
  assert.equal(out.kind, "match")
  assert.deepEqual(seen, [{ oid: "1042", kind: "vat", dateFrom: "2026-09-28", dateTo: "2026-10-06" }, "501"])
})

test("createOnce: a document that is already there is adopted, nothing is created", async () => {
  let created = 0
  const res = await createOnce({
    lookup: async () => ({ kind: "match", doc: doc() }),
    create: async () => {
      created += 1
      return doc()
    },
  })
  assert.equal(res.adopted, true)
  assert.equal(created, 0)
})

test("createOnce: a conflict stops before the create", async () => {
  let created = 0
  await assert.rejects(
    createOnce({
      lookup: async () => ({ kind: "conflict", doc: doc(), reason: "another amount" }),
      create: async () => {
        created += 1
        return doc()
      },
    }),
    DocumentConflictError,
  )
  assert.equal(created, 0)
})

test("createOnce: a lookup that fails stops before the create (could not look is never 'not there')", async () => {
  let created = 0
  await assert.rejects(
    createOnce({
      lookup: async () => {
        throw new FakturowniaApiError({ code: "HTTP_503", operation: "list", message: "", transient: true })
      },
      create: async () => {
        created += 1
        return doc()
      },
    }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "HTTP_503",
  )
  assert.equal(created, 0)
})

test("createOnce: a lost answer is settled by a second look, not a second create", async () => {
  const outcomes: MatchOutcome[] = [{ kind: "none" }, { kind: "match", doc: doc() }]
  let created = 0
  const sleeps: number[] = []
  const res = await createOnce({
    lookup: async () => outcomes.shift() ?? { kind: "none" },
    create: async () => {
      created += 1
      throw new FakturowniaUnknownResultError("create", "timeout")
    },
    sleep: async (ms) => void sleeps.push(ms),
  })
  assert.deepEqual([res.adopted, created], [true, 1])
  assert.deepEqual(sleeps, [3000])
})

test("createOnce: still not visible after the second look, the unknown result goes up; other errors go up at once", async () => {
  let looks = 0
  await assert.rejects(
    createOnce({
      lookup: async () => {
        looks += 1
        return { kind: "none" }
      },
      create: async () => {
        throw new FakturowniaUnknownResultError("create", "timeout")
      },
      sleep: async () => undefined,
    }),
    FakturowniaUnknownResultError,
  )
  assert.equal(looks, 2)
  looks = 0
  await assert.rejects(
    createOnce({
      lookup: async () => {
        looks += 1
        return { kind: "none" }
      },
      create: async () => {
        throw new FakturowniaApiError({ code: "HTTP_422", operation: "create", message: "bad", transient: false, refused: true })
      },
      sleep: async () => undefined,
    }),
    (e: unknown) => e instanceof FakturowniaApiError && e.code === "HTTP_422",
  )
  assert.equal(looks, 1, "a refusal needs no second look")
})

test("reconcile: adopt at once, a conflict for a person, a 'not found' trusted only after the grace period", async () => {
  const now = new Date("2026-10-05T10:00:00Z")
  const justNow = new Date("2026-10-05T09:59:30Z")
  const longAgo = new Date("2026-10-05T09:50:00Z")
  assert.equal((await reconcile({ lookup: async () => ({ kind: "match", doc: doc() }), lastAttemptAt: justNow, now })).action, "adopt")
  assert.equal((await reconcile({ lookup: async () => ({ kind: "conflict", doc: doc(), reason: "x" }), lastAttemptAt: justNow, now })).action, "conflict")
  assert.equal((await reconcile({ lookup: async () => ({ kind: "none" }), lastAttemptAt: justNow, now })).action, "wait")
  assert.equal((await reconcile({ lookup: async () => ({ kind: "none" }), lastAttemptAt: longAgo, now })).action, "absent")
  assert.equal((await reconcile({ lookup: async () => ({ kind: "none" }), lastAttemptAt: null, now })).action, "absent")
})
