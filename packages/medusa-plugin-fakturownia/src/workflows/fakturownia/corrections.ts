/**
 * CORRECTION INVOICES, FROM A CHANGED ORDER TO FAKTUROWNIA, EXACTLY ONCE.
 *
 *   1. PLAN. An event of an issued order (a return received, a refund, an
 *      order edit, a cancellation), the scan job or a click asks the planner
 *      (`lib/corrections.ts`) what the document should be corrected by. The
 *      answer is ONE open plan per document, updated in place while it waits
 *      (its revision grows when the content changes), closed as "obsolete"
 *      when the order is back to what the document says.
 *   2. APPROVE. A person approves the revision they saw; a plan recomputed in
 *      the meantime is refused. The approval queues a row of kind
 *      `correction` in the document outbox with the business key of the
 *      order's source events: the database refuses a second correction with
 *      the same key for the order.
 *   3. ISSUE. The outbox issues approved corrections only while the
 *      corrections writer is armed (the option allows it AND a person turned
 *      it on), at most ten per pass, with the same claim, lookup before the
 *      create and reconciliation as every document. Before sending, the
 *      corrected invoice is read from Fakturownia: when it no longer holds
 *      what the plugin issued, nothing is sent.
 *   4. SETTLE. An issued correction closes its plan; a document flagged
 *      `needs_correction` (a canceled order) becomes `issued` again once no
 *      plan of it waits.
 *
 * Receipts, claims and exchanges get a `manual` plan: the amounts, and what a
 * person should do (`lib/corrections.ts`).
 */

import { CORRECTIONS_SCAN_PER_PASS, CORRECTIONS_WINDOW_DAYS, LOOKUP_DAYS_BEFORE } from "../../modules/fakturownia/lib/constants"
import type { RunTrigger } from "../../modules/fakturownia/lib/contract"
import {
  buildCorrectionInvoice,
  correctionMarker,
  correctionReasonText,
  matchCorrection,
  mergeSources,
  originalMismatch,
  planCorrection,
  samePlan,
  sourceKey,
  type CorrectionMatchSpec,
  type PlannedPosition,
  type PlanSource,
  type ReasonKind,
} from "../../modules/fakturownia/lib/corrections"
import { addDays, warsawDate } from "../../modules/fakturownia/lib/dates"
import type { BuiltDocument, StoredPosition } from "../../modules/fakturownia/lib/document"
import { toDate, type DocumentRow, type PlanRow } from "../../modules/fakturownia/lib/dto"
import { PayloadError } from "../../modules/fakturownia/lib/errors"
import { toRemoteDocument, type MatchOutcome, type RemoteDocument } from "../../modules/fakturownia/lib/exactly-once"
import { canIssue } from "../../modules/fakturownia/lib/options"
import { DECIDED_PLAN_STATUSES, OPEN_PLAN_STATUSES, type PlanStatus } from "../../modules/fakturownia/lib/plan-store"
import { goesToKsef, govState } from "../../modules/fakturownia/lib/status"
import { Modules } from "@medusajs/framework/utils"
import {
  ActionError,
  clientFor,
  documentsOfOrder,
  exclusive,
  fakturowniaService,
  getDocument,
  getPlan,
  isArmed,
  listDocuments,
  listPlans,
  loadOrder,
  patchDocument,
  planStoreFor,
  recordRun,
  resolveOptional,
  storeFor,
  withLock,
  type Scope,
} from "./runtime"
import { kickIssue } from "./documents"

/* ------------------------------------------------------------------ */
/* Reading stored plans                                                */
/* ------------------------------------------------------------------ */

function list<T>(v: unknown): T[] {
  const raw = typeof v === "string" ? safeJson(v) : v
  return Array.isArray(raw) ? (raw as T[]) : []
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function plannedPositionsOf(v: unknown): PlannedPosition[] {
  return list<PlannedPosition>(v).filter((p) => p && typeof p.key === "string" && p.delta && p.before && p.after)
}

export function sourcesOf(v: unknown): PlanSource[] {
  return list<PlanSource>(v).filter((s) => s && typeof s.type === "string" && typeof s.id === "string")
}

function storedPositionsOf(row: DocumentRow): Array<Record<string, unknown>> {
  return list<Record<string, unknown>>(row.positions)
}

const isOpen = (p: PlanRow) => (OPEN_PLAN_STATUSES as readonly string[]).includes(p.status)
const isDecided = (p: PlanRow) => (DECIDED_PLAN_STATUSES as readonly string[]).includes(p.status)

/** The final document a correction plan is about: an issued VAT invoice or receipt of the order. */
export function correctableDocument(rows: readonly DocumentRow[]): DocumentRow | null {
  return (
    rows.find(
      (r) => (r.kind === "vat" || r.kind === "receipt") && (r.status === "issued" || r.status === "needs_correction") && (Boolean(r.fakturownia_id) || r.demo),
    ) ?? null
  )
}

/* ------------------------------------------------------------------ */
/* Claims and exchanges (the order module, read from outside)         */
/* ------------------------------------------------------------------ */

type ListFn = (filters: Record<string, unknown>, config?: Record<string, unknown>) => Promise<Array<{ canceled_at?: unknown }>>

/** Whether the order has a live claim or exchange. Unknown (no order module) counts as none. */
async function claimsOrExchanges(scope: Scope, orderId: string): Promise<boolean> {
  const orders = resolveOptional<{ listOrderClaims?: ListFn; listOrderExchanges?: ListFn }>(scope, Modules.ORDER)
  if (!orders) return false
  try {
    const [claims, exchanges] = await Promise.all([
      orders.listOrderClaims ? orders.listOrderClaims({ order_id: orderId }, { select: ["id", "canceled_at"], take: 20 }) : Promise.resolve([]),
      orders.listOrderExchanges ? orders.listOrderExchanges({ order_id: orderId }, { select: ["id", "canceled_at"], take: 20 }) : Promise.resolve([]),
    ])
    return [...claims, ...exchanges].some((c) => c && !c.canceled_at)
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 1. Plan                                                             */
/* ------------------------------------------------------------------ */

export interface PlanOutcome {
  orderId: string
  result: "created" | "updated" | "unchanged" | "obsolete" | "none" | "skipped"
  planId: string | null
  reason: string | null
}

/**
 * Plans the correction of an order's issued document now. Safe to call for
 * every event and twice: one open plan per document, updated in place.
 */
export async function planCorrections(scope: Scope, orderId: string, source: PlanSource | null = null, opts: { force?: boolean } = {}): Promise<PlanOutcome> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const base = { orderId, planId: null }
  if (o.corrections === "off") return { ...base, result: "skipped", reason: "corrections_off" }
  if (!canIssue(o)) return { ...base, result: "skipped", reason: "not_configured" }
  return withLock(`plan:${orderId}`, async () => {
    const rows = await documentsOfOrder(svc, orderId)
    const doc = correctableDocument(rows)
    if (!doc) return { ...base, result: "none", reason: "no_issued_document" }
    const plans = await listPlans(svc, { document_id: doc.id }, { take: 200, order: { created_at: "ASC" } })
    if (plans.some((p) => p.simulated)) return { ...base, result: "skipped", reason: "simulated" }
    const order = await loadOrder(scope, orderId)
    if (!order) return { ...base, result: "none", reason: "order_not_found" }
    /* `cancelOnOrderCanceled: false`: the plugin does not react to a cancellation, a plan to zero included. */
    if (order.status === "canceled" && !o.cancelOnOrderCanceled) return { ...base, result: "skipped", reason: "cancel_rule_off" }

    const now = new Date()
    const open = plans.find(isOpen) ?? null
    const decidedSources = new Set(plans.filter((p) => !isOpen(p)).flatMap((p) => sourcesOf(p.sources).map((s) => `${s.type}:${s.id}`)))
    const sources = mergeSources(sourcesOf(open?.sources), source ? [source] : []).filter((s) => !decidedSources.has(`${s.type}:${s.id}`))
    const verdict = planCorrection({
      documentKind: doc.kind,
      documentPositions: storedPositionsOf(doc),
      applied: plans.filter(isDecided).map((p) => plannedPositionsOf(p.positions)),
      order,
      options: o,
      sources,
      orderVersionAtIssue: typeof doc.order_version === "number" ? doc.order_version : null,
      claimsOrExchanges: await claimsOrExchanges(scope, orderId),
      force: opts.force === true,
    })
    await patchDocument(svc, doc.id, { corrections_checked_at: now }).catch(() => null)
    const store = planStoreFor(scope)

    if (verdict.kind === "none") {
      if (open) {
        await store.transition(open.id, OPEN_PLAN_STATUSES, {
          status: "obsolete",
          closed_at: now,
          close_note: "The order is back to what the document says: nothing to correct.",
        })
        return { ...base, result: "obsolete", planId: open.id, reason: null }
      }
      return { ...base, result: "none", reason: "nothing_changed" }
    }

    const label = doc.oid ?? (doc.display_id ? String(doc.display_id) : null)
    const content = {
      status: verdict.kind,
      manual_reason: verdict.manualReason,
      sources,
      reasons: verdict.reasons,
      reason: correctionReasonText(verdict.reasons, o.lang, label),
      positions: verdict.positions,
      notes: verdict.notes,
      currency: doc.currency,
      delta_net: verdict.totals.net,
      delta_vat: verdict.totals.vat,
      delta_gross: verdict.totals.gross,
      document_number: doc.number,
      computed_at: now,
    }
    if (open) {
      const changed = open.status !== verdict.kind || !samePlan(plannedPositionsOf(open.positions), verdict.positions)
      await store.updateOpen(open.id, content, changed)
      return { ...base, result: changed ? "updated" : "unchanged", planId: open.id, reason: null }
    }
    const inserted = await store.insertOpen({
      ...content,
      order_id: orderId,
      display_id: doc.display_id,
      document_id: doc.id,
      document_kind: doc.kind,
      demo: doc.demo,
      status: verdict.kind,
    })
    if (inserted) svc.getLogger().info(`[fakturownia] #${doc.display_id ?? orderId}: correction plan of ${doc.number ?? doc.id} (${verdict.kind}, ${verdict.totals.gross})`)
    return { ...base, result: inserted ? "created" : "unchanged", planId: inserted?.id ?? null, reason: null }
  })
}

/** The entry point of the Medusa events: never throws, Fakturownia is not involved. */
export async function onOrderChanged(scope: Scope, orderId: string, source: PlanSource): Promise<void> {
  try {
    await planCorrections(scope, orderId, source)
  } catch (err) {
    const svc = fakturowniaService(scope)
    svc.getLogger().error(`[fakturownia] correction plan of ${orderId}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

/* ------------------------------------------------------------------ */
/* 2. Decide                                                           */
/* ------------------------------------------------------------------ */

/** The correction row of an approved plan: inserted once (business key), found when it exists, linked to the plan. */
export async function ensureCorrectionDocument(scope: Scope, plan: PlanRow): Promise<DocumentRow | null> {
  const svc = fakturowniaService(scope)
  const key = plan.source_key ?? sourceKey(sourcesOf(plan.sources), plan.id)
  const original = await getDocument(svc, plan.document_id)
  let row = await storeFor(scope).insertIgnore({
    order_id: plan.order_id,
    display_id: plan.display_id,
    kind: "correction",
    demo: Boolean(plan.demo),
    next_attempt_at: new Date(),
    source_key: key,
    corrects_document_id: plan.document_id,
    plan_id: plan.id,
  })
  if (!row) row = (await listDocuments(svc, { order_id: plan.order_id, kind: "correction", source_key: key, demo: Boolean(plan.demo) }, { take: 1 }))[0] ?? null
  if (!row) return null
  if (row.status === "pending" && (row.total_gross === null || row.total_gross === undefined)) {
    /* What is about to be sent, for the admin; the outbox writes it again right before the request. */
    await patchDocument(svc, row.id, {
      oid: original?.oid ?? null,
      currency: plan.currency,
      total_gross: plan.delta_gross === null ? null : Number(plan.delta_gross),
      positions: correctionStoredPositions(plannedPositionsOf(plan.positions)),
      buyer_type: original?.buyer_type ?? null,
      from_fakturownia_id: original?.fakturownia_id ?? null,
    })
  }
  if (plan.correction_document_id !== row.id) await planStoreFor(scope).transition(plan.id, ["approved", "issued"], { correction_document_id: row.id })
  return row
}

/** The positions of a correction as the outbox stores them: the change, and the state before and after. */
export function correctionStoredPositions(positions: readonly PlannedPosition[]): StoredPosition[] {
  return positions.map((p) => ({
    name: p.name,
    code: p.code,
    quantity: p.delta.quantity,
    unit: p.unit,
    gross: p.delta.gross,
    tax: p.tax,
    before: p.before,
    after: p.after,
  }))
}

export interface ApproveInput {
  /** The revision the person saw. */
  revision: number
  /** The reason printed on the correction (at most 256 characters); the plan's suggestion when empty. */
  reason?: string | null
  actorId: string | null
}

/**
 * "Approve": the plan, as the person saw it, becomes a queued correction.
 * Issued right away when the corrections writer is armed; otherwise it waits
 * until a person turns the writer on.
 */
export async function approvePlan(scope: Scope, planId: string, input: ApproveInput): Promise<{ plan: PlanRow; document: DocumentRow | null; armed: boolean }> {
  const svc = fakturowniaService(scope)
  const plan = await getPlan(svc, planId)
  if (!plan || Boolean(plan.demo) !== svc.isDemo()) throw new ActionError(404, "Correction plan not found.")
  if (plan.status === "manual") throw new ActionError(409, "This plan is handled by a person outside the plugin: mark it done when it is.")
  if (plan.status !== "draft") throw new ActionError(409, `Only a plan waiting for a decision can be approved; this one is ${plan.status}.`)
  const original = await getDocument(svc, plan.document_id)
  if (!original || (original.status !== "issued" && original.status !== "needs_correction") || (!original.fakturownia_id && !original.demo)) {
    throw new ActionError(409, "The corrected document is not issued in Fakturownia.")
  }
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new ActionError(400, "Give the revision of the plan you reviewed.")
  const reason = (String(input.reason ?? "").trim() || plan.reason || correctionReasonText(list<ReasonKind>(plan.reasons), svc.getOptions().lang, original.oid)).slice(0, 256)
  const approved = await planStoreFor(scope).approve(planId, {
    revision: input.revision,
    approvedBy: input.actorId,
    reason,
    sourceKey: sourceKey(sourcesOf(plan.sources), plan.id),
    now: new Date(),
  })
  if (!approved) throw new ActionError(409, "The plan changed after you opened it, or someone decided it already. Review it again.")
  const document = await ensureCorrectionDocument(scope, approved)
  const armed = await isArmed(svc, "corrections")
  if (armed) kickIssue(scope, "manual")
  svc.getLogger().info(`[fakturownia] correction plan ${planId} approved${armed ? "" : " (waits for the corrections writer)"}`)
  return { plan: (await getPlan(svc, planId)) ?? approved, document, armed }
}

/**
 * "Dismiss": no correction from the plugin (a person handled it in
 * Fakturownia, or decided none is due). The plan's change counts as decided,
 * so it is not planned again. An approved plan can be dismissed only while
 * its correction certainly does not exist (failed, or still queued).
 */
export async function dismissPlan(scope: Scope, planId: string, input: { note?: string | null; actorId: string | null }): Promise<PlanRow> {
  const svc = fakturowniaService(scope)
  const plan = await getPlan(svc, planId)
  if (!plan || Boolean(plan.demo) !== svc.isDemo()) throw new ActionError(404, "Correction plan not found.")
  const now = new Date()
  const close = { status: "dismissed" as const, closed_by: input.actorId, closed_at: now, close_note: String(input.note ?? "").trim().slice(0, 500) || null }
  let moved: PlanRow | null = null
  if (plan.status === "draft") moved = await planStoreFor(scope).transition(planId, ["draft"], close)
  else if (plan.status === "approved") {
    const row = plan.correction_document_id ? await getDocument(svc, plan.correction_document_id) : null
    if (row && row.status !== "failed" && row.status !== "pending") {
      throw new ActionError(409, `The correction is ${row.status}: it may exist in Fakturownia. Check it first; only a failed or queued correction can be dismissed.`)
    }
    if (row) {
      const canceled = await storeFor(scope).transition(row.id, ["failed", "pending"], {
        status: "canceled",
        next_attempt_at: null,
        error: "The correction plan was dismissed by a person.",
        error_code: "plan_dismissed",
      })
      if (!canceled) throw new ActionError(409, "The correction is being issued right now. Try again in a minute.")
    }
    moved = await planStoreFor(scope).transition(planId, ["approved"], close)
  } else throw new ActionError(409, `A ${plan.status} plan cannot be dismissed.`)
  if (!moved) throw new ActionError(409, "Someone decided this plan already.")
  await settleDocument(scope, plan.document_id)
  return moved
}

/** "Mark as done": a manual plan (a receipt, a claim) a person handled outside the plugin. */
export async function markPlanDone(scope: Scope, planId: string, input: { note?: string | null; actorId: string | null }): Promise<PlanRow> {
  const svc = fakturowniaService(scope)
  const plan = await getPlan(svc, planId)
  if (!plan || Boolean(plan.demo) !== svc.isDemo()) throw new ActionError(404, "Correction plan not found.")
  const moved = await planStoreFor(scope).transition(planId, ["manual"], {
    status: "done",
    closed_by: input.actorId,
    closed_at: new Date(),
    close_note: String(input.note ?? "").trim().slice(0, 500) || null,
  })
  if (!moved) throw new ActionError(409, `Only a plan handled outside the plugin can be marked done; this one is ${plan.status}.`)
  await settleDocument(scope, plan.document_id)
  return moved
}

/**
 * A document flagged `needs_correction` (its order was canceled) becomes
 * `issued` again once no plan of it is open or approved and not issued.
 */
export async function settleDocument(scope: Scope, documentId: string | null | undefined): Promise<void> {
  if (!documentId) return
  const svc = fakturowniaService(scope)
  const doc = await getDocument(svc, documentId)
  if (!doc || doc.status !== "needs_correction") return
  const plans = await listPlans(svc, { document_id: documentId }, { take: 200 })
  if (plans.some((p) => isOpen(p) || p.status === "approved")) return
  const issued = plans.filter((p) => p.status === "issued").length
  await storeFor(scope).transition(documentId, ["needs_correction"], {
    error: issued > 0 ? "Corrected: the correction invoice is issued (see the corrections of this document)." : "A person handled the correction outside the plugin.",
    error_code: issued > 0 ? "corrected" : "correction_handled",
    status: "issued",
  })
}

/* ------------------------------------------------------------------ */
/* 3. Issue (called by the outbox)                                     */
/* ------------------------------------------------------------------ */

export type PreparedCorrection = { built: BuiltDocument; wait?: undefined } | { built?: undefined; wait: string; code?: string }

/** The correction invoice of a claimed outbox row, from its approved plan and the corrected invoice. */
export async function prepareCorrection(scope: Scope, row: DocumentRow): Promise<PreparedCorrection> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const plan = row.plan_id ? await getPlan(svc, row.plan_id) : null
  if (!plan || (plan.status !== "approved" && plan.status !== "issued")) {
    throw new PayloadError("plan_missing", "The approved correction plan of this row is missing or was dismissed.")
  }
  if (!(await isArmed(svc, "corrections"))) return { wait: "Waiting for the corrections writer: turn it on in the admin to issue approved corrections." }
  const original = await getDocument(svc, plan.document_id)
  if (!original || (!original.fakturownia_id && !original.demo)) throw new PayloadError("original_unknown", "The corrected document has no Fakturownia id.")
  /* A correction names the KSeF number of the invoice it corrects: it waits until KSeF accepted that invoice. */
  const ksef = govState(original.gov_status)
  if (goesToKsef(original.kind) && (ksef === "processing" || ksef === "offline" || ksef === "problem")) {
    return {
      wait: `Waiting for KSeF to accept the corrected invoice (${original.gov_status}); the correction is issued once it has its KSeF number.`,
      code: "waiting_for_ksef",
    }
  }
  const positions = plannedPositionsOf(plan.positions)
  const today = warsawDate(new Date())
  const currency = plan.currency ?? original.currency ?? "PLN"
  let remote: Record<string, unknown> | null = null
  if (!o.demo) {
    remote = await clientFor(svc).getInvoice(String(original.fakturownia_id))
    const mismatch = originalMismatch(storedPositionsOf(original), remote.positions)
    if (mismatch) {
      throw new PayloadError(
        "original_changed",
        `The invoice in Fakturownia is not what the plugin issued: ${mismatch} Nothing was sent. Correct it in Fakturownia by hand, then dismiss this plan.`,
      )
    }
  }
  const invoice = buildCorrectionInvoice(remote, positions, {
    originalId: String(original.fakturownia_id ?? "0"),
    today,
    reason: plan.reason ?? correctionReasonText(list<ReasonKind>(plan.reasons), o.lang, original.oid),
    rowId: row.id,
    orderLabel: `#${row.display_id ?? row.order_id}`,
    fallback: { lang: o.lang, issuePlace: o.issuePlace, currency, oid: original.oid },
  })
  const totalGross = plan.delta_gross === null ? positions.reduce((s, p) => s + p.delta.gross, 0) : Number(plan.delta_gross)
  return {
    built: {
      invoice,
      summary: {
        kind: "correction",
        apiKind: "correction",
        oid: original.oid,
        issueDate: today,
        currency,
        totalGross: Math.round(totalGross * 100) / 100,
        positions: correctionStoredPositions(positions),
        buyerType: original.buyer_type === "company" ? "company" : "person",
        paid: false,
        paymentType: typeof invoice.payment_type === "string" ? invoice.payment_type : "transfer",
        fromInvoiceId: original.fakturownia_id,
        buyerWarning: null,
        orderVersion: null,
      },
    },
  }
}

/** The lookup of a correction: the corrections of the corrected invoice, ours by its marker or (alone) by its value. */
export async function correctionLookup(scope: Scope, row: DocumentRow, totalGross: number | null, currency: string | null): Promise<() => Promise<MatchOutcome>> {
  const svc = fakturowniaService(scope)
  const originalId = String(row.from_fakturownia_id ?? "")
  const others = row.corrects_document_id
    ? await listDocuments(svc, { corrects_document_id: row.corrects_document_id, kind: "correction", demo: row.demo }, { take: 200, select: ["id", "fakturownia_id"] })
    : []
  const created = toDate(row.created_at) ?? new Date()
  const notBefore = addDays(warsawDate(created), -LOOKUP_DAYS_BEFORE)
  const spec: CorrectionMatchSpec = {
    originalId,
    marker: correctionMarker(row.id),
    totalGross: totalGross ?? 0,
    currency,
    notBefore,
    excludeIds: others.filter((r) => r.id !== row.id && r.fakturownia_id).map((r) => String(r.fakturownia_id)),
  }
  return async () => {
    if (!/^\d+$/.test(originalId)) return { kind: "none" }
    const client = clientFor(svc)
    const docs = (rows: Array<Record<string, unknown>>) => rows.map(toRemoteDocument).filter((d): d is RemoteDocument => d !== null)
    const candidates = docs(await client.findInvoices({ fromInvoiceId: originalId }))
    if (row.oid) candidates.push(...docs(await client.findInvoices({ oid: row.oid, kind: "correction", dateFrom: notBefore, dateTo: addDays(warsawDate(new Date()), 1) })))
    /*
     * The marker lives in the private note, which the documented list does
     * not promise to return: a correction of this invoice that came without
     * it is read on its own (a few at most), so two corrections of the same
     * value in flight never take each other's document.
     */
    const withoutNote = candidates.filter((c) => c.kind === "correction" && c.internalNote === null && (c.invoiceId === originalId || c.fromInvoiceId === originalId)).slice(0, 10)
    for (const c of withoutNote) {
      const full = toRemoteDocument(await client.getInvoice(c.id, ["id", "internal_note"]))
      if (full?.internalNote) for (const same of candidates) if (same.id === c.id) same.internalNote = full.internalNote
    }
    return matchCorrection(candidates, spec)
  }
}

/** A correction became issued: its plan is issued, and the corrected document may settle. */
export async function onCorrectionIssued(scope: Scope, row: DocumentRow): Promise<void> {
  const svc = fakturowniaService(scope)
  const plan = row.plan_id ? await getPlan(svc, row.plan_id) : null
  if (plan) await planStoreFor(scope).transition(plan.id, ["approved"], { status: "issued", correction_document_id: row.id })
  await settleDocument(scope, row.corrects_document_id ?? plan?.document_id ?? null)
}

/* ------------------------------------------------------------------ */
/* The scan: changes the events missed                                 */
/* ------------------------------------------------------------------ */

export interface ScanStats {
  checked: number
  created: number
  updated: number
  obsolete: number
  repaired: number
}

/**
 * Every 30 minutes: issued documents of the last 90 days, the least recently
 * checked first, are planned again (a missed event is caught here), and an
 * approved plan whose correction row is missing gets it. Reads Medusa only.
 */
export async function scanCorrections(scope: Scope, trigger: RunTrigger): Promise<ScanStats | null> {
  return exclusive("corrections", async () => {
    const svc = fakturowniaService(scope)
    const o = svc.getOptions()
    const stats: ScanStats = { checked: 0, created: 0, updated: 0, obsolete: 0, repaired: 0 }
    if (o.corrections === "off" || !canIssue(o)) return stats
    const startedAt = new Date()
    const since = new Date(startedAt.getTime() - CORRECTIONS_WINDOW_DAYS * 24 * 3600 * 1000)

    const approved = await listPlans(svc, { demo: o.demo, status: "approved", correction_document_id: null }, { take: 20 })
    for (const plan of approved) if (await ensureCorrectionDocument(scope, plan)) stats.repaired += 1

    /* Chosen in the database: never checked first, then the least recently checked, whatever the number of documents. */
    const window = { demo: o.demo, kind: ["vat", "receipt"], status: ["issued", "needs_correction"], issued_at: { $gte: since } }
    const fields = { select: ["id", "order_id", "corrections_checked_at"] }
    const never = await listDocuments(svc, { ...window, corrections_checked_at: null }, { ...fields, take: CORRECTIONS_SCAN_PER_PASS, order: { issued_at: "ASC" } })
    const due =
      never.length >= CORRECTIONS_SCAN_PER_PASS
        ? never
        : [
            ...never,
            ...(await listDocuments(svc, { ...window, corrections_checked_at: { $ne: null } }, {
              ...fields,
              take: CORRECTIONS_SCAN_PER_PASS - never.length,
              order: { corrections_checked_at: "ASC" },
            })),
          ]
    for (const d of due) {
      const r = await planCorrections(scope, d.order_id, null).catch(() => null)
      /* Stamped whatever the outcome, so a document planning skips cannot hold the head of the queue. */
      await patchDocument(svc, d.id, { corrections_checked_at: new Date() }).catch(() => null)
      stats.checked += 1
      if (r?.result === "created") stats.created += 1
      else if (r?.result === "updated") stats.updated += 1
      else if (r?.result === "obsolete") stats.obsolete += 1
    }
    if (stats.created + stats.updated + stats.obsolete + stats.repaired > 0 || trigger === "manual") {
      await recordRun(svc, {
        kind: "corrections",
        trigger,
        status: "ok",
        complete: true,
        startedAt,
        counts: { ...stats },
        message: `${stats.checked} checked, ${stats.created} new plan(s), ${stats.updated} updated, ${stats.obsolete} no longer needed.`,
      })
    }
    return stats
  })
}

/** Plan statuses as the admin filters them. */
export const PLAN_FILTERS: Record<string, readonly PlanStatus[]> = {
  open: ["draft", "manual"],
  approved: ["approved"],
  issued: ["issued"],
  closed: ["dismissed", "done", "obsolete"],
}
