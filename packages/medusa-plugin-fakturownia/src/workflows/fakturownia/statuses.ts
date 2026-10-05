/**
 * WHAT CHANGES AFTER ISSUE, EVERY 15 MINUTES. Read only towards Fakturownia,
 * except the e-mails and the proforma rejections that had to wait.
 *
 *   KSeF      VAT invoices of the last 14 days whose `gov_status` is not
 *             final are read (`GET /invoices/{id}.json` limited by
 *             `fields[invoice]=`), the least recently checked first, 40 per
 *             pass: `processing` becomes `ok` with the KSeF number, or a
 *             problem with its message. A payment recorded in Fakturownia
 *             (a bank import) is picked up on the way.
 *   e-mails   documents whose e-mail waits for the KSeF number.
 *   cancels   proformas of canceled orders whose rejection failed earlier.
 *   backlog   proforma flow: issued proformas whose order was fulfilled
 *             without the event reaching the plugin get their final document.
 *
 * Quiet when nothing changed: a pass every 15 minutes would otherwise bury
 * the history in empty runs.
 */

import { FINALS_PER_PASS, FINALS_WINDOW_DAYS, STATUS_WINDOW_DAYS, STATUSES_PER_PASS } from "../../modules/fakturownia/lib/constants"
import type { RunTrigger } from "../../modules/fakturownia/lib/contract"
import { toDate, type DocumentRow } from "../../modules/fakturownia/lib/dto"
import { describeError, FakturowniaApiError } from "../../modules/fakturownia/lib/errors"
import { toRemoteDocument } from "../../modules/fakturownia/lib/exactly-once"
import { canIssue } from "../../modules/fakturownia/lib/options"
import { goesToKsef, isGovFinal } from "../../modules/fakturownia/lib/status"
import { enqueueDue, kickIssue } from "./documents"
import { rejectProforma, sendEmailFor } from "./followups"
import { demoKsefNext, govPatch, ksefChanged, recordKsefEvent } from "./ksef"
import { clientFor, exclusive, fakturowniaService, listDocuments, patchDocument, queryOf, recordRun, type Scope } from "./runtime"

export interface StatusesStats {
  candidates: number
  read: number
  changed: number
  accepted: number
  problems: number
  missing: number
  emailsSent: number
  emailsWaiting: number
  emailsFailed: number
  rejected: number
  finalsQueued: number
  errors: string[]
}

function emptyStats(): StatusesStats {
  return { candidates: 0, read: 0, changed: 0, accepted: 0, problems: 0, missing: 0, emailsSent: 0, emailsWaiting: 0, emailsFailed: 0, rejected: 0, finalsQueued: 0, errors: [] }
}

function ms(v: Date | string | null | undefined): number {
  return toDate(v)?.getTime() ?? 0
}

/** What the status read asks for (KSeF.md, "Sprawdzanie statusu wysyłki"), and the payment on the way. */
export const GOV_FIELDS = [
  "id",
  "number",
  "kind",
  "price_gross",
  "paid",
  "status",
  "gov_status",
  "gov_id",
  "gov_send_date",
  "gov_error_messages",
  "gov_verification_link",
  "gov_link",
  "gov_corrected_invoice_number",
] as const

/** Reads the KSeF status of one document (simulated in demo mode), stores what changed and keeps it in the history. */
async function refreshOne(scope: Scope, row: DocumentRow, stats: StatusesStats, now: Date): Promise<void> {
  const svc = fakturowniaService(scope)
  if (svc.isDemo()) {
    stats.read += 1
    const next = demoKsefNext(row, now)
    if (next) {
      stats.changed += 1
      if (next.govStatus === "ok") stats.accepted += 1
      await patchDocument(svc, row.id, { gov_status: next.govStatus, gov_id: next.govId, gov_error: null, gov_errors: null, gov_checked_at: now })
      await recordKsefEvent(scope, row, { source: "refresh", govStatus: next.govStatus, govId: next.govId })
    } else {
      await patchDocument(svc, row.id, { gov_checked_at: now })
    }
    return
  }
  if (!row.fakturownia_id) return
  try {
    const doc = toRemoteDocument(await clientFor(svc).getInvoice(row.fakturownia_id, GOV_FIELDS))
    stats.read += 1
    if (!doc) return
    const patch = govPatch(doc, (t) => svc.mask(t), now)
    const paidThere = doc.paid !== null && doc.gross !== null && doc.gross > 0 && doc.paid + 0.005 >= doc.gross
    const ksef = ksefChanged(row, { govStatus: doc.govStatus, govId: doc.govId, govError: patch.gov_error ?? null })
    if (ksef || (paidThere && !row.paid)) {
      stats.changed += 1
      if (doc.govStatus === "ok" && row.gov_status !== "ok") stats.accepted += 1
    }
    if (patch.gov_error) stats.problems += 1
    await patchDocument(svc, row.id, {
      ...patch,
      ...(paidThere && !row.paid ? { paid: true, paid_at: now, pay_requested_at: null } : {}),
    })
    if (ksef) await recordKsefEvent(scope, row, { source: "refresh", govStatus: doc.govStatus, govId: doc.govId, errors: doc.govErrorList })
  } catch (err) {
    if (err instanceof FakturowniaApiError && err.status === 404) {
      stats.missing += 1
      await patchDocument(svc, row.id, {
        gov_checked_at: now,
        error: "This document is no longer in Fakturownia (deleted there?).",
        error_code: "remote_missing",
      })
      return
    }
    if (stats.errors.length < 10) stats.errors.push(`#${row.display_id ?? row.order_id}: ${svc.mask(describeError(err).message)}`)
    throw err
  }
}

/** Proforma flow: fulfilled orders whose final document was never queued (the event did not arrive). */
async function queueMissedFinals(scope: Scope, stats: StatusesStats, now: Date): Promise<void> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  if (o.documentFlow !== "proforma_then_vat") return
  const since = new Date(now.getTime() - FINALS_WINDOW_DAYS * 24 * 3600 * 1000)
  const proformas = await listDocuments(svc, { demo: o.demo, kind: "proforma", status: "issued", issued_at: { $gte: since } }, { take: 500, select: ["order_id"] })
  const orderIds = [...new Set(proformas.map((p) => p.order_id))]
  if (orderIds.length === 0) return
  const finals = await listDocuments(svc, { demo: o.demo, order_id: orderIds, kind: ["vat", "receipt"] }, { take: null, select: ["order_id"] })
  const withFinal = new Set(finals.map((f) => f.order_id))
  const open = orderIds.filter((id) => !withFinal.has(id)).slice(0, FINALS_PER_PASS)
  if (open.length === 0) return
  const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "status", "fulfillments.id", "fulfillments.canceled_at"], filters: { id: open } })
  for (const order of data as Array<{ id: string; status?: string | null; fulfillments?: Array<{ canceled_at?: unknown }> | null }>) {
    const fulfilled = (order.fulfillments ?? []).some((f) => f && !f.canceled_at)
    if (!fulfilled || order.status === "canceled") continue
    const { inserted } = await enqueueDue(scope, order.id, "backlog")
    stats.finalsQueued += inserted.length
  }
}

/** One status pass. Null when a pass already runs in this process. */
export async function refreshStatuses(scope: Scope, trigger: RunTrigger): Promise<StatusesStats | null> {
  return exclusive("statuses", async () => {
    const svc = fakturowniaService(scope)
    const o = svc.getOptions()
    const stats = emptyStats()
    if (!canIssue(o)) return stats
    const startedAt = new Date()
    const now = new Date()

    /* KSeF */
    const since = new Date(now.getTime() - STATUS_WINDOW_DAYS * 24 * 3600 * 1000)
    const recent = await listDocuments(svc, { demo: o.demo, status: ["issued", "needs_correction"], kind: ["vat", "correction"], issued_at: { $gte: since } }, { take: 500 })
    const candidates = recent
      .filter((r) => goesToKsef(r.kind) && !isGovFinal(r.gov_status))
      .sort((a, b) => ms(a.gov_checked_at) - ms(b.gov_checked_at))
      .slice(0, STATUSES_PER_PASS)
    stats.candidates = candidates.length
    for (const row of candidates) {
      try {
        await refreshOne(scope, row, stats, now)
      } catch (err) {
        /* Fakturownia is not answering: the rest would only wait for the same timeout. */
        const code = describeError(err).code
        if (code === "ERROR_NETWORK" || code === "ERROR_TIMEOUT" || code.startsWith("HTTP_5")) break
      }
    }

    /* E-mails waiting for a KSeF number (or for Fakturownia to be back) */
    const emails = await listDocuments(svc, { demo: o.demo, status: "issued", email_status: "pending" }, { take: 20, order: { issued_at: "ASC" } })
    for (const row of emails) {
      const r = await sendEmailFor(scope, row)
      if (r === "sent") stats.emailsSent += 1
      else if (r === "waiting") stats.emailsWaiting += 1
      else if (r === "failed") stats.emailsFailed += 1
    }

    /* Proformas of canceled orders whose rejection has to be tried again */
    const cancels = await listDocuments(svc, { demo: o.demo, status: "issued", kind: "proforma", cancel_requested_at: { $ne: null } }, { take: 20 })
    for (const row of cancels) if (await rejectProforma(scope, row)) stats.rejected += 1

    /* Final documents the fulfillment event did not queue */
    try {
      await queueMissedFinals(scope, stats, now)
      if (stats.finalsQueued > 0) kickIssue(scope, "auto")
    } catch (err) {
      if (stats.errors.length < 10) stats.errors.push(`backlog: ${svc.mask(describeError(err).message)}`)
    }

    const worthARun = stats.changed + stats.emailsSent + stats.emailsFailed + stats.rejected + stats.finalsQueued + stats.missing > 0 || stats.errors.length > 0 || trigger === "manual"
    if (worthARun && !(o.demo && trigger === "auto")) {
      const failedAll = stats.candidates > 0 && stats.read === 0 && stats.errors.length > 0
      await recordRun(svc, {
        kind: "statuses",
        trigger,
        status: failedAll ? "error" : stats.errors.length > 0 ? "partial" : "ok",
        complete: stats.errors.length === 0,
        startedAt,
        counts: { ...stats },
        message:
          stats.errors.length > 0
            ? stats.errors.slice(0, 3).join("; ")
            : `${stats.read} read, ${stats.accepted} accepted by KSeF, ${stats.emailsSent} e-mailed, ${stats.finalsQueued} final document(s) queued.`,
      })
    }
    return stats
  })
}

/* ------------------------------------------------------------------ */
/* Demo: let KSeF accept while someone watches                         */
/* ------------------------------------------------------------------ */

const DEMO_REFRESH_KEY = Symbol.for("koda.fakturownia.demoRefresh")
const DEMO_REFRESH_MS = 20_000

/**
 * Demo mode only: the simulated KSeF statuses are read again when the admin
 * looks at documents, at most every 20 seconds per process. In-process and
 * cheap, so an evaluator sees "processing" become "accepted" without waiting
 * for the 15 minute job. Such refreshes record no run.
 */
export async function refreshDemoStatuses(scope: Scope): Promise<void> {
  const svc = fakturowniaService(scope)
  if (!svc.isDemo()) return
  const holder = globalThis as typeof globalThis & { [DEMO_REFRESH_KEY]?: number }
  const last = holder[DEMO_REFRESH_KEY] ?? 0
  if (Date.now() - last < DEMO_REFRESH_MS) return
  holder[DEMO_REFRESH_KEY] = Date.now()
  await refreshStatuses(scope, "auto").catch(() => null)
}
