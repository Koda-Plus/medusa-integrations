/**
 * DEMO MODE, VERSION 0.2.0: the simulated account shows everything new on
 * the first visit, once per store (a setting claimed atomically).
 *
 *   KSeF         one VAT invoice with a history of a rejection, a "send
 *                again" and the acceptance; one rejected right now, so the
 *                evaluator can send it again (with the KSeF writer on)
 *   corrections  plans from the demo store's own returns, refunds and edits
 *                when it has any (nothing is created in Medusa); otherwise a
 *                simulated return on one invoice, marked as simulated
 *   reminders    a few unpaid invoices moved one to five weeks back (with
 *                numbers of that month), so the reminder list and the
 *                monthly summary have something to show
 *   e-mails      none: the simulated mailbox fills when someone sends one
 *
 * Every row stays flagged `demo`. Nothing leaves Medusa.
 */

import { addDays, warsawDate } from "../../modules/fakturownia/lib/dates"
import { correctionReasonText, simulatedReturn, totalsOf } from "../../modules/fakturownia/lib/corrections"
import { DEMO_BACKDATE_DAYS, DEMO_KSEF_REJECTION, demoGovId, demoNumber, encodeDemoId } from "../../modules/fakturownia/lib/demo"
import type { DocumentRow } from "../../modules/fakturownia/lib/dto"
import { planCorrections } from "./corrections"
import { ensureDemoDocuments } from "./documents"
import { recordKsefEvent } from "./ksef"
import { exclusive, fakturowniaService, isRunning, listDocuments, patchDocument, planStoreFor, type Scope } from "./runtime"

export const DEMO_SEED_KEY = "demo:seeded:0.2.0"

/**
 * Demo mode: everything the simulated account shows, prepared once (the
 * documents of the newest orders, then the KSeF histories, a plan and the
 * reminders). Called by the issue job and by `POST /admin/fakturownia/demo/seed`,
 * never by a GET. Idempotent and quiet in live mode.
 */
export async function prepareDemo(scope: Scope): Promise<void> {
  const svc = fakturowniaService(scope)
  if (!svc.isDemo()) return
  await ensureDemoDocuments(scope)
  await ensureDemoExtras(scope)
}

function at(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000)
}

/** Runs once per store in demo mode, after the first backfill. Never throws. */
export async function ensureDemoExtras(scope: Scope): Promise<void> {
  const svc = fakturowniaService(scope)
  if (!svc.isDemo() || isRunning("demo-extras")) return
  await exclusive("demo-extras", async () => {
    try {
      const vat = await listDocuments(svc, { demo: true, kind: "vat", status: "issued", fakturownia_id: { $ne: null } }, { take: 50, order: { issued_at: "ASC" } })
      if (vat.length < 3) return
      if (!(await planStoreFor(scope).claimSetting(DEMO_SEED_KEY, { at: new Date().toISOString() }))) return
      const [resolved, rejected, ...rest] = vat
      await ksefStories(scope, resolved, rejected)
      const simulatedOn = await corrections(scope, rest)
      await backdate(
        scope,
        rest.filter((r) => r.id !== simulatedOn),
      )
      svc.getLogger().info("[fakturownia] demo: KSeF histories, correction plans and reminders seeded (0.2.0).")
    } catch (err) {
      svc.getLogger().warn(`[fakturownia] demo seed 0.2.0: ${svc.mask((err as Error)?.message ?? String(err))}`)
    }
  })
}

/** Whether a document has a KSeF history already (documents of 0.2.0 get their "issue" line when they are issued). */
async function hasHistory(scope: Scope, documentId: string): Promise<boolean> {
  const svc = fakturowniaService(scope)
  const rows = (await svc.listFakturowniaKsefEvents({ document_id: documentId } as never, { take: 1, select: ["id"] } as never)) as unknown as unknown[]
  return rows.length > 0
}

/** One rejection resolved by "send again" (history), one rejection waiting for it (now). */
async function ksefStories(scope: Scope, resolved: DocumentRow, rejected: DocumentRow): Promise<void> {
  const svc = fakturowniaService(scope)
  const t0 = resolved.issued_at ? new Date(resolved.issued_at) : new Date(Date.now() - 3600_000)
  const govId = demoGovId(resolved.order_id, resolved.issue_date ?? warsawDate(t0))
  await patchDocument(svc, resolved.id, { gov_status: "ok", gov_id: govId, gov_error: null, gov_errors: null, gov_send_date: at(t0, 12), ksef_resend_at: at(t0, 11), gov_checked_at: at(t0, 15) })
  if (!(await hasHistory(scope, resolved.id))) await recordKsefEvent(scope, resolved, { source: "issue", govStatus: "processing", at: t0 })
  await recordKsefEvent(scope, resolved, { source: "refresh", govStatus: "send_error", errors: [DEMO_KSEF_REJECTION], at: at(t0, 2) })
  await recordKsefEvent(scope, resolved, { source: "resend", govStatus: "processing", requestedBy: "system", note: "Simulated: sent to the simulated KSeF again after the buyer's phone number was fixed in Fakturownia.", at: at(t0, 11) })
  await recordKsefEvent(scope, resolved, { source: "refresh", govStatus: "ok", govId, at: at(t0, 15) })

  const t1 = rejected.issued_at ? new Date(rejected.issued_at) : new Date(Date.now() - 1800_000)
  await patchDocument(svc, rejected.id, { gov_status: "send_error", gov_id: null, gov_error: DEMO_KSEF_REJECTION, gov_errors: [DEMO_KSEF_REJECTION], gov_send_date: at(t1, 1), gov_checked_at: at(t1, 3) })
  if (!(await hasHistory(scope, rejected.id))) await recordKsefEvent(scope, rejected, { source: "issue", govStatus: "processing", at: t1 })
  await recordKsefEvent(scope, rejected, { source: "refresh", govStatus: "send_error", errors: [DEMO_KSEF_REJECTION], at: at(t1, 3) })
}

/** Plans from the store's own changes; a simulated return when there are none. Returns the id of the simulated document. */
async function corrections(scope: Scope, candidates: readonly DocumentRow[]): Promise<string | null> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  if (o.corrections === "off") return null
  let planned = 0
  for (const doc of await listDocuments(svc, { demo: true, kind: ["vat", "receipt"], status: ["issued", "needs_correction"] }, { take: 100 })) {
    const r = await planCorrections(scope, doc.order_id, null).catch(() => null)
    if (r?.result === "created") planned += 1
  }
  if (planned > 0) return null
  const target = [...candidates].reverse().find((d) => simulatedReturn(Array.isArray(d.positions) ? (d.positions as Array<Record<string, unknown>>) : []))
  if (!target) return null
  const positions = simulatedReturn(target.positions as Array<Record<string, unknown>>) ?? []
  const totals = totalsOf(positions)
  const now = new Date()
  await planStoreFor(scope).insertOpen({
    order_id: target.order_id,
    display_id: target.display_id,
    document_id: target.id,
    document_kind: target.kind,
    document_number: target.number,
    demo: true,
    status: "draft",
    manual_reason: null,
    sources: [{ type: "demo", id: "simulated_return", at: now.toISOString() }],
    reasons: ["return"],
    reason: correctionReasonText(["return"], o.lang, target.oid ?? (target.display_id ? String(target.display_id) : null)),
    positions,
    notes: [],
    currency: target.currency,
    delta_net: totals.net,
    delta_vat: totals.vat,
    delta_gross: totals.gross,
    simulated: true,
    computed_at: now,
  })
  return target.id
}

/** A few unpaid invoices one to five weeks back, renumbered for their month (the simulated id carries the number). */
async function backdate(scope: Scope, candidates: readonly DocumentRow[]): Promise<void> {
  const svc = fakturowniaService(scope)
  const free = candidates.filter((d) => !d.paid)
  /* A demo store whose orders are all paid still shows the reminders: two invoices are simulated as unpaid. */
  const chosen = (free.length >= 2 ? free : [...free, ...candidates.filter((d) => d.paid)]).slice(0, DEMO_BACKDATE_DAYS.length)
  const given = await listDocuments(svc, { demo: true, fakturownia_id: { $ne: null } }, { take: null, select: ["id", "fakturownia_id", "kind", "issue_date"] })
  const taken = new Set(given.map((r) => String(r.fakturownia_id)))
  const today = warsawDate(new Date())
  for (const [i, doc] of chosen.entries()) {
    const days = DEMO_BACKDATE_DAYS[i]
    const date = addDays(today, -days)
    let seq = 1 + given.filter((r) => r.kind === doc.kind && r.id !== doc.id && (r.issue_date ?? "").startsWith(date.slice(0, 7))).length
    while (taken.has(encodeDemoId(doc.kind, date, seq))) seq += 1
    const id = encodeDemoId(doc.kind, date, seq)
    taken.add(id)
    given.push({ ...doc, issue_date: date, fakturownia_id: id })
    await patchDocument(svc, doc.id, {
      issue_date: date,
      issued_at: new Date(Date.now() - days * 86_400_000),
      fakturownia_id: id,
      number: demoNumber(doc.kind, seq, date),
      paid: false,
      paid_at: null,
      ...(doc.gov_status === "ok" ? { gov_id: demoGovId(doc.order_id, date) } : {}),
    })
  }
}
