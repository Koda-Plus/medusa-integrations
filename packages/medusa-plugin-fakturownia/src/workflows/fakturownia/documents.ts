/**
 * THE DOCUMENT OUTBOX: Medusa orders to Fakturownia documents, exactly once.
 *
 * ORDER OF OPERATIONS IS THE WHOLE MECHANISM:
 *   1. an event (order placed, payment captured, fulfillment created) asks
 *      which documents are due and INSERTS their rows (`pending`); an insert
 *      that meets the unique indexes is ignored, so a repeated event, two
 *      processes or a click racing the subscriber end with one row;
 *   2. the job claims each due row with one atomic UPDATE (pending to
 *      issuing, a claim token, a ten minute lease);
 *   3. the document is built from the order at that moment, and what is
 *      about to be sent (order number, total, positions, never the buyer) is
 *      written to the row BEFORE the request;
 *   4. `createOnce` looks the document up in Fakturownia, adopts it when it
 *      is there, otherwise sends ONE create request;
 *   5. only the claim's owner writes the result: `issued` with the number,
 *      a retry with backoff for a refusal that may pass, `failed` for one
 *      that will not, `unknown` for a lost answer;
 *   6. an `unknown` row is reconciled by a lookup (after a grace period)
 *      before anything is sent again: found means adopted, certainly absent
 *      means queued again, and the next attempt looks first anyway.
 *
 * A row with a Fakturownia id is never sent again by any road.
 */

import { randomUUID } from "node:crypto"
import type FakturowniaModuleService from "../../modules/fakturownia/service"
import {
  CORRECTIONS_PER_PASS,
  DEMO_BACKFILL_ORDERS,
  DOCUMENTS_PER_PASS,
  LOOKUP_DAYS_BEFORE,
  MAX_ATTEMPTS,
  PLUGIN_EVENTS,
  RECONCILE_PER_PASS,
  claimLeaseMs,
  reconcileGraceMs,
} from "../../modules/fakturownia/lib/constants"
import type { RunTrigger } from "../../modules/fakturownia/lib/contract"
import { buildFinalFromProforma } from "../../modules/fakturownia/lib/conversion"
import { addDays, warsawDate } from "../../modules/fakturownia/lib/dates"
import { DEMO_FAILURE, demoFailingOrder, demoGovId, demoGovStatus, demoNumber, demoPaid, encodeDemoId } from "../../modules/fakturownia/lib/demo"
import { documentEvent } from "../../modules/fakturownia/lib/events"
import { mapBuyer } from "../../modules/fakturownia/lib/buyer"
import {
  apiKind,
  buildDocument,
  dueKinds,
  finalKind,
  isFulfilled,
  manualKind,
  paymentFacts,
  type BuiltDocument,
  type DocumentKind,
  type DocumentSummary,
  type FinalKind,
  type OrderRecord,
} from "../../modules/fakturownia/lib/document"
import { toDate, type DocumentRow } from "../../modules/fakturownia/lib/dto"
import { ClaimLostError, FakturowniaApiError, FakturowniaUnknownResultError, PayloadError } from "../../modules/fakturownia/lib/errors"
import {
  createOnce,
  lookupExisting,
  reconcile,
  toRemoteDocument,
  type LookupDeps,
  type MatchSpec,
  type RemoteDocument,
} from "../../modules/fakturownia/lib/exactly-once"
import type { FakturowniaClient } from "../../modules/fakturownia/lib/client"
import { money, toNumberOrNull } from "../../modules/fakturownia/lib/numbers"
import { canIssue, type ResolvedFakturowniaOptions } from "../../modules/fakturownia/lib/options"
import { planAfterFailure } from "../../modules/fakturownia/lib/outbox"
import { goesToKsef } from "../../modules/fakturownia/lib/status"
import type { DocumentPatch } from "../../modules/fakturownia/lib/store"
import { applyCancelRule, sendEmailFor } from "./followups"
import { correctionLookup, onCorrectionIssued, prepareCorrection } from "./corrections"
import { recordKsefEvent } from "./ksef"
import {
  ActionError,
  clientFor,
  documentsOfOrder,
  emitEvent,
  exclusive,
  fakturowniaService,
  getDocument,
  inBackground,
  isArmed,
  isRunning,
  listDocuments,
  loadOrder,
  patchDocument,
  queryOf,
  recordRun,
  storeFor,
  type Scope,
} from "./runtime"

/* ------------------------------------------------------------------ */
/* What an order needs                                                 */
/* ------------------------------------------------------------------ */

export interface OrderFacts {
  canceled: boolean
  capturedInFull: boolean
  fulfilled: boolean
  finalKind: FinalKind
}

export function orderFacts(order: OrderRecord, o: ResolvedFakturowniaOptions): OrderFacts {
  const total = money(order.total)
  const payment = paymentFacts(order.payment_collections ?? [], total, o.codProviders)
  return {
    canceled: order.status === "canceled",
    capturedInFull: payment.captured,
    fulfilled: isFulfilled(order),
    finalKind: finalKind(o, mapBuyer(order, o.nipSources).type),
  }
}

export type EnqueueSource = "order_placed" | "payment_captured" | "fulfillment" | "manual" | "backfill" | "backlog" | "workflow"

export interface EnqueueResult {
  inserted: DocumentRow[]
  kinds: DocumentKind[]
  reason: "not_configured" | "order_not_found" | "order_canceled" | "not_due" | null
}

/**
 * Inserts the rows of the documents an order needs now. Safe to call for
 * every event and twice: an existing row is never touched, and the unique
 * indexes turn a racing insert into a no-op.
 *
 * `kinds` overrides the decision (the demo backfill); `force` is "Issue now":
 * the document of the trigger without waiting for the trigger.
 */
export async function enqueueDue(scope: Scope, orderId: string, source: EnqueueSource, opts: { force?: boolean; kinds?: DocumentKind[] } = {}): Promise<EnqueueResult> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  if (!canIssue(o)) return { inserted: [], kinds: [], reason: "not_configured" }
  const order = await loadOrder(scope, orderId)
  if (!order) return { inserted: [], kinds: [], reason: "order_not_found" }
  const facts = orderFacts(order, o)
  if (facts.canceled) return { inserted: [], kinds: [], reason: "order_canceled" }

  const rows = await documentsOfOrder(svc, orderId)
  const hasProforma = rows.some((r) => r.kind === "proforma" && r.status !== "canceled")
  const hasFinal = rows.some((r) => r.kind === "vat" || r.kind === "receipt")
  const kinds =
    opts.kinds ??
    (opts.force
      ? [manualKind({ flow: o.documentFlow, fulfilled: facts.fulfilled, finalKind: facts.finalKind })]
      : dueKinds({ flow: o.documentFlow, trigger: o.trigger, ...facts, hasProforma }))

  const store = storeFor(scope)
  const inserted: DocumentRow[] = []
  for (const kind of kinds) {
    if (kind === "proforma" && hasFinal) continue
    if (rows.some((r) => r.kind === kind)) continue
    const row = await store.insertIgnore({ order_id: orderId, display_id: order.display_id ?? null, kind, demo: o.demo, next_attempt_at: new Date() })
    if (row) {
      inserted.push(row)
      svc.getLogger().info(`[fakturownia] #${order.display_id ?? orderId}: ${kind} queued (${source})`)
    }
  }
  return { inserted, kinds, reason: kinds.length === 0 ? "not_due" : null }
}

/* ------------------------------------------------------------------ */
/* Building and looking up                                             */
/* ------------------------------------------------------------------ */

type Prepared = { built: BuiltDocument; wait?: undefined } | { built?: undefined; wait: string; code?: string }

/** The document of a row: from the order, or (a final document after a proforma) from the proforma. */
async function prepareDocument(scope: Scope, row: DocumentRow, order: OrderRecord): Promise<Prepared> {
  if (row.kind === "correction") return prepareCorrection(scope, row)
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const today = warsawDate(new Date())
  const kind = row.kind as DocumentKind
  if ((kind === "vat" || kind === "receipt") && o.documentFlow === "proforma_then_vat") {
    const proforma = (await documentsOfOrder(svc, row.order_id)).find((r) => r.kind === "proforma")
    if (proforma && (proforma.status === "pending" || proforma.status === "issuing" || proforma.status === "unknown")) {
      return { wait: `Waiting for the proforma of this order (${proforma.status}).` }
    }
    if (proforma && proforma.status === "issued" && proforma.fakturownia_id) {
      if (o.demo) {
        const built = buildDocument(order, o, { kind, today, oidUnique: false })
        built.invoice.from_invoice_id = Number(proforma.fakturownia_id)
        built.summary.fromInvoiceId = proforma.fakturownia_id
        return { built }
      }
      const remote = await clientFor(svc).getInvoice(proforma.fakturownia_id)
      const facts = orderFacts(order, o)
      return {
        built: buildFinalFromProforma(remote, {
          kind,
          receiptKind: o.receiptKind,
          today,
          capturedInFull: facts.capturedInFull,
          paymentTermDays: o.paymentTermDays,
          fallback: { issuePlace: o.issuePlace, lang: o.lang },
        }),
      }
    }
    /* A proforma that failed for good, or none: the final document comes from the order, unlinked. */
  }
  return { built: buildDocument(order, o, { kind, today, oidUnique: true }) }
}

/** What is about to be sent, without the buyer: written before the request, so a lost answer can be looked up. */
function summaryPatch(s: DocumentSummary): DocumentPatch {
  return {
    oid: s.oid,
    issue_date: s.issueDate,
    currency: s.currency,
    total_gross: s.totalGross,
    positions: s.positions,
    buyer_type: s.buyerType,
    from_fakturownia_id: s.fromInvoiceId,
    order_version: s.orderVersion,
    buyer_warning: s.buyerWarning,
  }
}

function lookupDeps(client: FakturowniaClient): LookupDeps {
  const docs = (rows: Array<Record<string, unknown>>) => rows.map(toRemoteDocument).filter((d): d is RemoteDocument => d !== null)
  return {
    findByOid: async ({ oid, kind, dateFrom, dateTo }) => docs(await client.findInvoices({ oid, kind, dateFrom: dateFrom ?? undefined, dateTo: dateTo ?? undefined })),
    findGeneratedFrom: async (id) => docs(await client.findInvoices({ fromInvoiceId: id })),
  }
}

interface LookupPlan {
  spec: MatchSpec
  window: { dateFrom: string | null; dateTo: string | null }
}

interface LookupSource {
  oid: string | null
  apiKind: string
  totalGross: number | null
  currency: string | null
  fromInvoiceId: string | null
}

/** The lookup of a row: by its order number and kind, issued from a week before the row existed until tomorrow. */
function lookupPlan(row: DocumentRow, s: LookupSource, now: Date): LookupPlan {
  const created = toDate(row.created_at) ?? now
  const notBefore = addDays(warsawDate(created), -LOOKUP_DAYS_BEFORE)
  return {
    spec: { oid: s.oid, kind: s.apiKind, totalGross: s.totalGross, currency: s.currency, notBefore, fromInvoiceId: s.fromInvoiceId },
    window: { dateFrom: notBefore, dateTo: addDays(warsawDate(now), 1) },
  }
}

/** The summary of an unknown row, from what was written before its request. */
function storedSummary(row: DocumentRow, o: ResolvedFakturowniaOptions): LookupSource {
  return {
    oid: row.oid,
    apiKind: apiKind(row.kind as DocumentKind, o.receiptKind),
    totalGross: toNumberOrNull(row.total_gross),
    currency: row.currency,
    fromInvoiceId: row.from_fakturownia_id,
  }
}

/* ------------------------------------------------------------------ */
/* The simulated account                                               */
/* ------------------------------------------------------------------ */

async function demoCreate(svc: FakturowniaModuleService, row: DocumentRow, order: OrderRecord, built: BuiltDocument, now: Date): Promise<RemoteDocument> {
  const given = await listDocuments(svc, { demo: true, fakturownia_id: { $ne: null } }, { take: null, select: ["fakturownia_id", "kind", "issue_date"] })
  const taken = new Set(given.map((r) => String(r.fakturownia_id)))
  const s = built.summary
  const month = s.issueDate.slice(0, 7)
  let sequence = 1 + given.filter((r) => r.kind === row.kind && (r.issue_date ?? "").startsWith(month)).length
  /* The id carries the kind, the month and the sequence (`encodeDemoId`); a racing twin takes the next one. */
  while (taken.has(encodeDemoId(row.kind, s.issueDate, sequence))) sequence += 1
  const paid = row.kind === "correction" ? false : demoPaid(order.id, s.paid)
  const gov = demoGovStatus({ kind: row.kind, orderId: order.id, issuedAt: now, now })
  return {
    id: encodeDemoId(row.kind, s.issueDate, sequence),
    number: demoNumber(row.kind, sequence, s.issueDate),
    kind: s.apiKind,
    oid: s.oid,
    gross: s.totalGross,
    currency: s.currency,
    issueDate: s.issueDate,
    paid: paid ? s.totalGross : 0,
    status: paid ? "paid" : "issued",
    govStatus: gov,
    govId: gov === "ok" ? demoGovId(row.kind === "correction" ? `${order.id}#${row.id}` : order.id, s.issueDate) : null,
    govErrors: null,
    fromInvoiceId: s.fromInvoiceId,
    invoiceId: row.kind === "correction" ? s.fromInvoiceId : null,
    internalNote: null,
    govErrorList: [],
    govSendDate: gov === "processing" || gov === "ok" ? now.toISOString() : null,
    govVerificationLink: null,
    govLink: null,
    govCorrectedNumber: null,
  }
}

/* ------------------------------------------------------------------ */
/* Issued                                                              */
/* ------------------------------------------------------------------ */

function issuedPatch(args: {
  doc: RemoteDocument
  summary: { issueDate: string | null; totalGross: number | null; paid: boolean }
  adopted: boolean
  sendByEmail: boolean
  mask: (t: string) => string
  now: Date
}): DocumentPatch {
  const { doc, summary, adopted, now } = args
  const paid = doc.paid !== null && doc.gross !== null && doc.gross > 0 ? doc.paid + 0.005 >= doc.gross : summary.paid
  /* An adopted document Fakturownia already reports as e-mailed ("sent") is not e-mailed twice. */
  const email = args.sendByEmail && !(adopted && doc.status === "sent")
  return {
    status: "issued",
    fakturownia_id: doc.id,
    number: doc.number,
    issue_date: doc.issueDate ?? summary.issueDate,
    total_gross: doc.gross ?? summary.totalGross,
    paid,
    paid_at: paid ? now : null,
    ...(paid ? { pay_requested_at: null } : {}),
    gov_status: doc.govStatus,
    gov_id: doc.govId,
    gov_error: doc.govErrors ? args.mask(doc.govErrors).slice(0, 1000) : null,
    gov_errors: doc.govErrorList.length > 0 ? doc.govErrorList.map((e) => args.mask(e).slice(0, 500)) : null,
    gov_send_date: doc.govSendDate ? new Date(doc.govSendDate) : null,
    gov_verification_link: doc.govVerificationLink,
    gov_link: doc.govLink,
    gov_corrected_number: doc.govCorrectedNumber,
    gov_checked_at: now,
    issued_at: now,
    next_attempt_at: null,
    error: adopted ? "Adopted: the document was already in Fakturownia, nothing was sent again." : null,
    error_code: adopted ? "adopted" : null,
    email_status: email ? "pending" : null,
  }
}

/**
 * The events of a row that just became issued: the contract event
 * (`fakturownia.document.issued`, or `.corrected` for a correction) and the
 * 0.1.0 event `fakturownia.document_issued` (not for corrections, which 0.1.0
 * did not know). Called once per row: only by the caller whose atomic write
 * moved the row to `issued`.
 */
export async function announceIssued(scope: Scope, row: DocumentRow, adopted: boolean): Promise<void> {
  if (row.kind !== "correction") {
    await emitEvent(scope, PLUGIN_EVENTS.documentIssued, {
      order_id: row.order_id,
      display_id: row.display_id,
      document_id: row.id,
      kind: row.kind,
      fakturownia_id: row.fakturownia_id,
      number: row.number,
      adopted,
      paid: Boolean(row.paid),
      demo: Boolean(row.demo),
    })
  }
  const event = documentEvent(row)
  if (event) await emitEvent(scope, event.name, { ...event.data })
}

/**
 * A final document made from a proforma: the proforma is converted
 * (`converted_at`), so it is no longer money to collect (`lib/unpaid.ts`).
 */
export async function markProformaConverted(scope: Scope, row: DocumentRow): Promise<void> {
  if ((row.kind !== "vat" && row.kind !== "receipt") || !row.from_fakturownia_id) return
  const svc = fakturowniaService(scope)
  const proformas = await listDocuments(svc, { order_id: row.order_id, demo: Boolean(row.demo), kind: "proforma", fakturownia_id: row.from_fakturownia_id, converted_at: null }, { take: 5 })
  for (const p of proformas) await patchDocument(svc, p.id, { converted_at: new Date() })
}

/** E-mail, event and a cancellation that arrived while the document was on its way. Never throws. */
async function afterIssued(scope: Scope, rowId: string, adopted: boolean): Promise<void> {
  const svc = fakturowniaService(scope)
  try {
    const row = await getDocument(svc, rowId)
    if (!row || row.status !== "issued") return
    await markProformaConverted(scope, row)
    await announceIssued(scope, row, adopted)
    if (goesToKsef(row.kind) && row.gov_status) {
      const errors = Array.isArray(row.gov_errors) ? (row.gov_errors as unknown[]).map(String) : null
      await recordKsefEvent(scope, row, { source: "issue", govStatus: row.gov_status, govId: row.gov_id, errors })
    }
    if (row.kind === "correction") {
      await onCorrectionIssued(scope, row)
      if (row.email_status === "pending") await sendEmailFor(scope, row)
      return
    }
    const order = row.cancel_requested_at ? null : await loadOrder(scope, row.order_id)
    if (row.cancel_requested_at || order?.status === "canceled") {
      await applyCancelRule(scope, row)
      return
    }
    if (row.email_status === "pending") await sendEmailFor(scope, row)
  } catch (err) {
    svc.getLogger().warn(`[fakturownia] after issuing ${rowId}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

/* ------------------------------------------------------------------ */
/* One attempt                                                         */
/* ------------------------------------------------------------------ */

export interface IssueOutcome {
  status: "issued" | "retry" | "failed" | "unknown" | "canceled" | "waiting" | "busy"
  rowId: string
  orderId: string
  number: string | null
  adopted: boolean
  code: string | null
  message: string | null
}

/**
 * One attempt of one row: claim, build, look, create once, write the result.
 * Every Fakturownia failure lands in the row. `demoFailure` makes the
 * simulated account refuse the document (the demo backfill shows that state).
 *
 * THE CLAIM IS PROVEN TWICE. The lease follows `timeoutMs`, and the owner
 * renews it with one conditional UPDATE (by its claim token) when it writes
 * what it is about to send, and again right before the create request
 * leaves, after the queue of the rate limit; that second renewal also stamps
 * `create_sent_at`. When a renewal finds the claim gone (the lease ran out
 * during a slow lookup and another process took the row over), the attempt
 * stops and sends nothing.
 */
export async function issueRow(scope: Scope, row: DocumentRow, opts: { demoFailure?: boolean } = {}): Promise<IssueOutcome> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const store = storeFor(scope)
  const now = new Date()
  const token = randomUUID()
  const leaseMs = claimLeaseMs(o.timeoutMs)
  const leaseFromNow = () => new Date(Date.now() + leaseMs)
  const base = { rowId: row.id, orderId: row.order_id, number: null, adopted: false, code: null, message: null }
  const claimed = await store.claim(row.id, { now, leaseUntil: new Date(now.getTime() + leaseMs), token })
  if (!claimed) return { ...base, status: "busy", code: "busy", message: "Another process is issuing this document." }
  /** Renews the claim; throws `ClaimLostError` (nothing sent) when it is no longer ours. */
  const stillOurs = async (args: { patch?: DocumentPatch; sending?: boolean } = {}) => {
    const ok = await store.renew(claimed.id, token, { leaseUntil: leaseFromNow(), patch: args.patch, createSentAt: args.sending ? new Date() : undefined })
    if (!ok) throw new ClaimLostError(claimed.id)
  }
  const label = `#${claimed.display_id ?? claimed.order_id} ${claimed.kind}`
  let built: BuiltDocument | null = null

  try {
    const order = await loadOrder(scope, claimed.order_id)
    if (!order) throw new PayloadError("order_not_found", `Order ${claimed.order_id} does not exist in Medusa.`)
    if (claimed.kind !== "correction" && (order.status === "canceled" || claimed.cancel_requested_at)) {
      /* A pending row never has a document in Fakturownia (a lost answer goes to unknown, not here). */
      await store.finish(claimed.id, token, {
        status: "canceled",
        next_attempt_at: null,
        error: "The order was canceled before the document was issued.",
        error_code: "order_canceled",
      })
      return { ...base, status: "canceled", code: "order_canceled" }
    }

    const prepared = await prepareDocument(scope, claimed, order)
    if (prepared.wait !== undefined) {
      const code = prepared.code ?? (claimed.kind === "correction" ? "waiting_for_writer" : "waiting_for_proforma")
      await store.finish(claimed.id, token, {
        status: "pending",
        attempts: Math.max(0, claimed.attempts - 1),
        next_attempt_at: new Date(now.getTime() + (code === "waiting_for_ksef" ? 5 * 60_000 : 60_000)),
        error: prepared.wait,
        error_code: code,
      })
      return { ...base, status: "waiting", code, message: prepared.wait }
    }
    const current = prepared.built
    built = current

    /* Before the network: what is about to be sent, so a lost answer can be looked up (only while the claim is ours). */
    await stillOurs({ patch: summaryPatch(current.summary) })

    let doc: RemoteDocument
    let adopted = false
    if (o.demo) {
      if (opts.demoFailure) {
        throw new FakturowniaApiError({ code: DEMO_FAILURE.code, operation: "create", message: DEMO_FAILURE.detail, transient: false, refused: true, status: DEMO_FAILURE.status })
      }
      await stillOurs({ sending: true })
      doc = await demoCreate(svc, claimed, order, current, now)
    } else {
      const client = clientFor(svc)
      const plan = lookupPlan(claimed, current.summary, now)
      const lookup =
        claimed.kind === "correction"
          ? await correctionLookup(scope, { ...claimed, from_fakturownia_id: current.summary.fromInvoiceId, oid: current.summary.oid }, current.summary.totalGross, current.summary.currency)
          : () => lookupExisting(lookupDeps(client), plan.spec, plan.window)
      const result = await createOnce({
        lookup,
        create: async () => {
          /* The last proof of the claim, after the queue of the rate limit: a lost claim sends nothing. */
          const created = toRemoteDocument(await client.createInvoice(current.invoice, { beforeSend: () => stillOurs({ sending: true }) }))
          if (!created) throw new FakturowniaUnknownResultError("create", new Error("an unreadable answer"))
          return created
        },
      })
      doc = result.doc
      adopted = result.adopted
    }

    const written = await store.finish(
      claimed.id,
      token,
      issuedPatch({ doc, summary: current.summary, adopted, sendByEmail: o.sendByEmail && o.writers.emails !== false, mask: (t) => svc.mask(t), now: new Date() }),
    )
    if (!written) {
      /* The lease ran out while we waited; the row is unknown now and its lookup will adopt this document. */
      svc.getLogger().warn(`[fakturownia] ${label}: issued as ${doc.number ?? doc.id}, but the claim had expired; the reconciliation adopts it.`)
    } else {
      svc.getLogger().info(`[fakturownia] ${label} ${adopted ? "was already in Fakturownia as" : "issued as"} ${doc.number ?? doc.id}`)
      await afterIssued(scope, claimed.id, adopted)
    }
    return { ...base, status: "issued", number: doc.number, adopted }
  } catch (err) {
    if (err instanceof ClaimLostError) {
      /* Nothing was sent and the row is someone else's now: no write, no event. */
      svc.getLogger().warn(`[fakturownia] ${label}: the claim ran out before the create request, nothing was sent; the row is handled by another attempt.`)
      return { ...base, status: "busy", code: err.code, message: err.message }
    }
    const plan = planAfterFailure(err, { attempts: claimed.attempts, now: new Date() })
    const message = svc.mask(plan.message).slice(0, 2000)
    await store
      .finish(claimed.id, token, {
        status: plan.status,
        next_attempt_at: plan.nextAttemptAt,
        error: message,
        error_code: plan.code,
        ...(built ? summaryPatch(built.summary) : {}),
      })
      .catch(() => false)
    if (plan.status === "failed") {
      svc.getLogger().warn(`[fakturownia] ${label} failed after ${claimed.attempts} attempt(s): [${plan.code}] ${message}`)
      await emitEvent(scope, PLUGIN_EVENTS.documentFailed, {
        order_id: claimed.order_id,
        display_id: claimed.display_id,
        document_id: claimed.id,
        kind: claimed.kind,
        code: plan.code,
        message,
        attempts: claimed.attempts,
        demo: o.demo,
      })
    } else if (plan.status === "unknown") {
      svc.getLogger().warn(`[fakturownia] ${label}: ${message}`)
      await emitEvent(scope, PLUGIN_EVENTS.documentNeedsAttention, {
        order_id: claimed.order_id,
        display_id: claimed.display_id,
        document_id: claimed.id,
        kind: claimed.kind,
        status: "unknown",
        message,
        demo: o.demo,
      })
    } else {
      svc.getLogger().info(`[fakturownia] ${label}: attempt ${claimed.attempts} failed [${plan.code}], next at ${plan.nextAttemptAt?.toISOString()}`)
    }
    return { ...base, status: plan.status === "pending" ? "retry" : plan.status, code: plan.code, message }
  }
}

/* ------------------------------------------------------------------ */
/* Reconciliation of unknown rows                                      */
/* ------------------------------------------------------------------ */

export type ReconcileOutcome = "adopted" | "waiting" | "conflict" | "absent" | "canceled" | "gave_up" | "error" | "skipped"

/** Looks an unknown row up in Fakturownia and moves it on. Read only towards Fakturownia. */
export async function reconcileRow(scope: Scope, row: DocumentRow): Promise<{ outcome: ReconcileOutcome; message: string | null }> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const store = storeFor(scope)
  const now = new Date()
  if (row.status !== "unknown") return { outcome: "skipped", message: null }

  if (o.demo) {
    await store.transition(row.id, ["unknown"], { status: "pending", next_attempt_at: now })
    return { outcome: "absent", message: null }
  }
  const summary = storedSummary(row, o)
  if (!summary.oid && !summary.fromInvoiceId) {
    const message = "This document has no order number to look for. Check Fakturownia, then mark it as issued or issue it again."
    await store.transition(row.id, ["unknown"], { error: message, next_attempt_at: null })
    return { outcome: "error", message }
  }

  const client = clientFor(svc)
  const plan = lookupPlan(row, summary, now)
  /*
   * The grace counts from the create request itself (`create_sent_at`, since
   * 0.3.0), never from the claim: a slow lookup before the create must not
   * shorten it. Rows of 0.2.x have no stamp and count from the claim. The
   * request may take `timeoutMs` to reach Fakturownia, so the grace adds it.
   */
  const lastAttemptAt = toDate(row.create_sent_at) ?? toDate(row.claimed_at) ?? toDate(row.updated_at)
  const graceMs = reconcileGraceMs(o.timeoutMs)
  try {
    const lookup =
      row.kind === "correction"
        ? await correctionLookup(scope, row, summary.totalGross, summary.currency)
        : () => lookupExisting(lookupDeps(client), plan.spec, plan.window)
    const verdict = await reconcile({ lookup, lastAttemptAt, now, graceMs })
    if (verdict.action === "adopt") {
      const moved = await store.transition(
        row.id,
        ["unknown"],
        issuedPatch({
          doc: verdict.doc,
          summary: { issueDate: row.issue_date, totalGross: summary.totalGross, paid: Boolean(row.paid) },
          adopted: true,
          sendByEmail: o.sendByEmail && o.writers.emails !== false,
          mask: (t) => svc.mask(t),
          now,
        }),
      )
      if (moved) await afterIssued(scope, row.id, true)
      return { outcome: "adopted", message: verdict.doc.number }
    }
    if (verdict.action === "conflict") {
      const message = svc.mask(verdict.reason).slice(0, 2000)
      await store.transition(row.id, ["unknown"], { status: "failed", error: message, error_code: "conflict", next_attempt_at: null })
      await emitEvent(scope, PLUGIN_EVENTS.documentFailed, {
        order_id: row.order_id,
        display_id: row.display_id,
        document_id: row.id,
        kind: row.kind,
        code: "conflict",
        message,
        attempts: row.attempts,
        demo: false,
      })
      return { outcome: "conflict", message }
    }
    if (verdict.action === "wait") {
      const until = new Date((lastAttemptAt ?? now).getTime() + graceMs)
      await store.transition(row.id, ["unknown"], { next_attempt_at: until > now ? until : now })
      return { outcome: "waiting", message: null }
    }
    /* Certainly not in Fakturownia. */
    const order = await loadOrder(scope, row.order_id)
    if (row.kind !== "correction" && (!order || order.status === "canceled" || row.cancel_requested_at)) {
      await store.transition(row.id, ["unknown"], {
        status: "canceled",
        next_attempt_at: null,
        error: "Not in Fakturownia, and the order was canceled: nothing to issue.",
        error_code: "order_canceled",
      })
      return { outcome: "canceled", message: null }
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      const message = `Not in Fakturownia after ${row.attempts} attempts; the plugin stopped. Retry when Fakturownia answers again.`
      await store.transition(row.id, ["unknown"], { status: "failed", next_attempt_at: null, error: message, error_code: "gave_up" })
      return { outcome: "gave_up", message }
    }
    await store.transition(row.id, ["unknown"], {
      status: "pending",
      next_attempt_at: now,
      error: "Not in Fakturownia after the lost answer: queued again (the attempt looks first).",
      error_code: "absent_after_unknown",
    })
    return { outcome: "absent", message: null }
  } catch (err) {
    const message = svc.mask((err as Error)?.message ?? String(err)).slice(0, 1000)
    await store.transition(row.id, ["unknown"], {
      next_attempt_at: new Date(now.getTime() + 5 * 60_000),
      error: `The answer to the create request was lost, and the lookup failed too (tried again in 5 minutes): ${message}`,
    })
    return { outcome: "error", message }
  }
}

/* ------------------------------------------------------------------ */
/* The pass over due rows                                              */
/* ------------------------------------------------------------------ */

export interface IssueStats {
  expired: number
  reconciled: number
  adopted: number
  processed: number
  issued: number
  retry: number
  failed: number
  unknown: number
  canceled: number
  waiting: number
  busy: number
}

/** Codes meaning "Fakturownia is not reachable", not "this document is wrong": the rest of the pass would only wait for the same timeout. */
const CONNECTIVITY = new Set(["ERROR_NETWORK", "ERROR_TIMEOUT", "HTTP_502", "HTTP_503", "HTTP_504", "unknown_result"])

/** Expired leases, the reconciliation of unknown rows, then the due rows. One pass per process at a time; null when one runs. */
export async function issueDue(scope: Scope, trigger: RunTrigger): Promise<IssueStats | null> {
  return exclusive("issue", async () => {
    const svc = fakturowniaService(scope)
    const o = svc.getOptions()
    const stats: IssueStats = { expired: 0, reconciled: 0, adopted: 0, processed: 0, issued: 0, retry: 0, failed: 0, unknown: 0, canceled: 0, waiting: 0, busy: 0 }
    if (!canIssue(o)) return stats
    const store = storeFor(scope)
    const startedAt = new Date()

    stats.expired = await store.expireLeases(startedAt, o.demo)

    const unknown = await listDocuments(svc, { status: "unknown", demo: o.demo, next_attempt_at: { $lte: startedAt } }, {
      take: RECONCILE_PER_PASS,
      order: { next_attempt_at: "ASC" },
    })
    for (const row of unknown) {
      const r = await reconcileRow(scope, row)
      if (r.outcome === "skipped" || r.outcome === "waiting") continue
      stats.reconciled += 1
      if (r.outcome === "adopted") stats.adopted += 1
    }

    const due = await listDocuments(svc, { status: "pending", demo: o.demo, kind: { $ne: "correction" }, next_attempt_at: { $lte: new Date() } }, {
      take: DOCUMENTS_PER_PASS,
      order: { next_attempt_at: "ASC" },
    })
    /* Approved corrections: only while the corrections writer is armed, at most CORRECTIONS_PER_PASS per pass. */
    if (await isArmed(svc, "corrections")) {
      due.push(
        ...(await listDocuments(svc, { status: "pending", demo: o.demo, kind: "correction", next_attempt_at: { $lte: new Date() } }, {
          take: CORRECTIONS_PER_PASS,
          order: { next_attempt_at: "ASC" },
        })),
      )
    }
    for (const row of due) {
      const outcome = await issueRow(scope, row)
      if (outcome.status === "busy") {
        stats.busy += 1
        continue
      }
      stats.processed += 1
      if (outcome.status === "issued") {
        stats.issued += 1
        if (outcome.adopted) stats.adopted += 1
      } else if (outcome.status === "retry") stats.retry += 1
      else if (outcome.status === "failed") stats.failed += 1
      else if (outcome.status === "unknown") stats.unknown += 1
      else if (outcome.status === "canceled") stats.canceled += 1
      else if (outcome.status === "waiting") stats.waiting += 1
      if ((outcome.status === "retry" || outcome.status === "unknown") && outcome.code && CONNECTIVITY.has(outcome.code)) break
    }

    const worthARun = stats.processed + stats.reconciled + stats.expired > 0 || trigger === "manual"
    if (worthARun) {
      const trouble = stats.failed + stats.unknown + stats.retry
      await recordRun(svc, {
        kind: "issue",
        trigger,
        status: stats.processed > 0 && stats.issued === 0 && trouble > 0 ? "error" : trouble > 0 ? "partial" : "ok",
        complete: true,
        startedAt,
        counts: { ...stats },
        message:
          trouble > 0
            ? `${stats.issued} issued, ${stats.retry} to retry, ${stats.unknown} unknown, ${stats.failed} need attention.`
            : `${stats.issued} issued${stats.adopted > 0 ? `, ${stats.adopted} adopted` : ""}.`,
      })
    }
    return stats
  })
}

/**
 * Starts a pass in the background (subscribers, admin actions). When a pass
 * already runs it may have listed the due rows before this one was written,
 * so the kick tries again a few seconds later, up to three times.
 */
export function kickIssue(scope: Scope, trigger: RunTrigger, tries = 3): void {
  inBackground(scope, "issue pass", async () => {
    const stats = await issueDue(scope, trigger)
    if (stats === null && tries > 1) setTimeout(() => kickIssue(scope, trigger, tries - 1), 5000).unref?.()
  })
}

/* ------------------------------------------------------------------ */
/* What a person can do                                                */
/* ------------------------------------------------------------------ */

/** "Retry": a failed row back to the queue, attempts reset. */
export async function retryDocument(scope: Scope, id: string): Promise<DocumentRow | null> {
  const moved = await storeFor(scope).transition(id, ["failed"], { status: "pending", attempts: 0, next_attempt_at: new Date(), error: null, error_code: null })
  if (moved) kickIssue(scope, "manual")
  return moved
}

/** "Issue again": a person checked Fakturownia and the document is not there. The attempt still looks first. */
export async function issueAgain(scope: Scope, id: string): Promise<DocumentRow | null> {
  const moved = await storeFor(scope).transition(id, ["unknown"], {
    status: "pending",
    next_attempt_at: new Date(),
    error: "Issued again by a person after checking Fakturownia (the attempt looks there first).",
    error_code: "issue_again",
  })
  if (moved) kickIssue(scope, "manual")
  return moved
}

/** "Check in Fakturownia": the reconciliation of one unknown row, now. */
export async function checkDocument(scope: Scope, id: string): Promise<{ outcome: ReconcileOutcome; message: string | null; row: DocumentRow | null }> {
  const svc = fakturowniaService(scope)
  const row = await getDocument(svc, id)
  if (!row) return { outcome: "skipped", message: "Document not found.", row: null }
  const result = await reconcileRow(scope, row)
  return { ...result, row: await getDocument(svc, id) }
}

/* ActionError lives in runtime.ts (shared with the correction flows); re-exported here for 0.1.0 imports. */
export { ActionError }

/**
 * "Mark as issued": a person found (or issued) the document in Fakturownia.
 * With its Fakturownia id (live mode) the document is read and its number,
 * its kind and its order number must match, so a typo cannot link the order
 * to someone else's invoice; and one Fakturownia document belongs to one row
 * only (other plugins hear of it as this order's document).
 */
export async function markIssued(scope: Scope, id: string, input: { number: string; fakturowniaId?: string | null }): Promise<DocumentRow> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const number = String(input.number ?? "").trim().slice(0, 100)
  const remoteId = String(input.fakturowniaId ?? "").trim()
  if (!number) throw new ActionError(400, "Give the document number, as Fakturownia shows it.")
  if (remoteId && !/^\d{1,15}$/.test(remoteId)) throw new ActionError(400, "The Fakturownia id is the number in the document address, like 123456789.")
  const row = await getDocument(svc, id)
  if (!row || Boolean(row.demo) !== svc.isDemo()) throw new ActionError(404, "Document not found.")
  if (remoteId) {
    const twin = (await listDocuments(svc, { demo: Boolean(row.demo), fakturownia_id: remoteId, id: { $ne: row.id } }, { take: 1 }))[0]
    if (twin) throw new ActionError(409, `Fakturownia document ${remoteId} is already the document of order #${twin.display_id ?? twin.order_id} in the plugin.`)
  }
  const now = new Date()
  const patch: DocumentPatch = {
    status: "issued",
    number,
    fakturownia_id: remoteId || null,
    issued_at: now,
    next_attempt_at: null,
    error: "Marked as issued by a person.",
    error_code: "marked_by_person",
  }
  if (remoteId && !svc.isDemo()) {
    let doc: RemoteDocument | null
    try {
      doc = toRemoteDocument(await clientFor(svc).getInvoice(remoteId, ["id", "number", "kind", "oid", "price_gross", "paid", "status", "gov_status", "gov_id"]))
    } catch (err) {
      throw new ActionError(err instanceof FakturowniaApiError && err.status === 404 ? 404 : 502, svc.mask((err as Error).message))
    }
    if (!doc) throw new ActionError(404, `Fakturownia has no document ${remoteId}.`)
    if (doc.number && doc.number.replace(/\s+/g, "") !== number.replace(/\s+/g, "")) {
      throw new ActionError(409, `Fakturownia document ${remoteId} is ${doc.number}, not ${number}.`)
    }
    const kind = apiKind(row.kind as DocumentKind, o.receiptKind)
    if (doc.kind && doc.kind !== kind) throw new ActionError(409, `Fakturownia document ${remoteId} is of kind ${doc.kind}, not ${kind}.`)
    if (row.oid && doc.oid && doc.oid !== row.oid) throw new ActionError(409, `Fakturownia document ${remoteId} carries order number ${doc.oid}, not ${row.oid}.`)
    Object.assign(patch, {
      number: doc.number ?? number,
      total_gross: doc.gross,
      paid: doc.paid !== null && doc.gross !== null && doc.gross > 0 && doc.paid + 0.005 >= doc.gross,
      gov_status: doc.govStatus,
      gov_id: doc.govId,
      gov_checked_at: now,
    })
  }
  const moved = await storeFor(scope).transition(id, ["unknown", "failed"], patch)
  if (!moved) throw new ActionError(409, "Only a document that failed or whose result is unknown can be marked as issued.")
  /* With its Fakturownia id the document is as good as issued by the plugin: other plugins hear of it (once: the transition above happens once). */
  await markProformaConverted(scope, moved)
  if (moved.fakturownia_id) await announceIssued(scope, moved, true)
  if (moved.kind === "correction") await onCorrectionIssued(scope, moved)
  return moved
}

/**
 * "Issue now" on the order page: the document of the trigger is queued
 * without waiting for the trigger, and the pass starts. A document that is
 * already there (or failed) is not queued twice.
 */
export async function issueOrderNow(scope: Scope, orderId: string): Promise<EnqueueResult> {
  const result = await enqueueDue(scope, orderId, "manual", { force: true })
  if (result.inserted.length > 0) kickIssue(scope, "manual")
  return result
}

/* ------------------------------------------------------------------ */
/* Demo: the first visit                                               */
/* ------------------------------------------------------------------ */

/**
 * Demo mode, first visit: the newest orders get documents from the
 * simulated account right away, so the page opens with data. Runs once
 * (when no demo document exists yet). One of them is refused on purpose, to
 * show a failed document.
 */
export async function ensureDemoDocuments(scope: Scope): Promise<void> {
  const svc = fakturowniaService(scope)
  if (!svc.isDemo() || isRunning("backfill")) return
  await exclusive("backfill", async () => {
    const [, existing] = await svc.listAndCountFakturowniaDocuments({ demo: true } as never, { take: 1, select: ["id"] } as never)
    if (existing > 0) return
    const o = svc.getOptions()
    const { data } = await queryOf(scope).graph({
      entity: "order",
      fields: ["id", "display_id", "status", "created_at", "fulfillments.id", "fulfillments.canceled_at"],
      pagination: { take: DEMO_BACKFILL_ORDERS, order: { created_at: "DESC" } },
    })
    const recent = (data as Array<{ id: string; status?: string | null; fulfillments?: Array<{ canceled_at?: unknown }> | null }>).filter(
      (r) => r.status !== "canceled",
    )
    if (recent.length === 0) return
    const failing = demoFailingOrder(recent.map((r) => r.id))
    for (const r of [...recent].reverse()) {
      try {
        const order = await loadOrder(scope, r.id)
        if (!order) continue
        const facts = orderFacts(order, o)
        const kinds: DocumentKind[] =
          o.documentFlow === "proforma_then_vat" ? (facts.fulfilled ? ["proforma", facts.finalKind] : ["proforma"]) : [facts.finalKind]
        const { inserted } = await enqueueDue(scope, r.id, "backfill", { kinds })
        for (const row of inserted) await issueRow(scope, row, { demoFailure: r.id === failing && row.kind !== "proforma" })
      } catch (err) {
        svc.getLogger().warn(`[fakturownia] demo backfill ${r.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
      }
    }
  })
}
