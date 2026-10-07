import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type FakturowniaModuleService from "../../../modules/fakturownia/service"
import { CORRECTIONS_SCHEDULE, ISSUE_SCHEDULE, PAYMENTS_SCHEDULE, STATUSES_SCHEDULE } from "../../../modules/fakturownia/lib/constants"
import type { CorrectionPlanDto, DocumentFilter, RunDto, RunKind, StatusResponse, WritersDto } from "../../../modules/fakturownia/lib/contract"
import { toDocumentDto, toPlanDto, toWriterDto, type DocumentRow, type PlanRow } from "../../../modules/fakturownia/lib/dto"
import { addDays, warsawDate } from "../../../modules/fakturownia/lib/dates"
import { describeNipSource } from "../../../modules/fakturownia/lib/nip"
import { WRITERS } from "../../../modules/fakturownia/lib/writers"
import { describeError, FakturowniaApiError } from "../../../modules/fakturownia/lib/errors"
import { fetchDocumentPdf } from "../../../modules/fakturownia/lib/files"
import { accountUrl } from "../../../modules/fakturownia/lib/options"
import { contentDisposition, pdfFileName, unicodeFileName } from "../../../modules/fakturownia/lib/pdf"
import {
  DOCUMENT_FILTERS,
  GOV_ACCEPTED_VALUES,
  GOV_PROBLEM_VALUES,
  GOV_PROCESSING_VALUES,
  documentFilters,
  withAlternatives,
} from "../../../modules/fakturownia/lib/filters"
import { REMINDER_KINDS, unpaidFilters } from "../../../modules/fakturownia/lib/unpaid"
import { ActionError } from "../../../workflows/fakturownia/documents"
import {
  actorNames,
  clientFor,
  fakturowniaService,
  lastCheck,
  lastRun,
  listDocuments,
  runningKinds,
  writerStates,
  type Scope,
} from "../../../workflows/fakturownia/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { fakturowniaService, ActionError }

export { DOCUMENT_FILTERS, GOV_ACCEPTED_VALUES, GOV_PROBLEM_VALUES, GOV_PROCESSING_VALUES, documentFilters, withAlternatives }

async function count(svc: FakturowniaModuleService, filters: Record<string, unknown>): Promise<number> {
  const [, n] = await svc.listAndCountFakturowniaDocuments(filters as never, { take: 1, select: ["id"] } as never)
  return n
}

async function countPlans(svc: FakturowniaModuleService, filters: Record<string, unknown>): Promise<number> {
  const [, n] = await svc.listAndCountFakturowniaCorrections(filters as never, { take: 1, select: ["id"] } as never)
  return n
}

async function countEmails(svc: FakturowniaModuleService, filters: Record<string, unknown>): Promise<number> {
  const [, n] = await svc.listAndCountFakturowniaEmails(filters as never, { take: 1, select: ["id"] } as never)
  return n
}

/** Unpaid proformas and VAT invoices (`lib/unpaid.ts`) issued at least `reminderAfterDays` days ago (Poland's calendar). */
export function reminderFilters(demo: boolean, afterDays: number, now: Date = new Date()): Record<string, unknown> {
  return { ...unpaidFilters(demo), kind: [...REMINDER_KINDS], issue_date: { $lte: addDays(warsawDate(now), -afterDays) } }
}

/** The user id of an admin request (who approved, who flipped a switch). */
export function actorOf(req: MedusaRequest): string | null {
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } }).auth_context
  return typeof ctx?.actor_id === "string" && ctx.actor_id ? ctx.actor_id : null
}

/** The writers of the current mode for the admin, with the names of who flipped them. */
export async function writersDto(scope: Scope): Promise<WritersDto> {
  const svc = fakturowniaService(scope)
  const states = await writerStates(svc)
  const names = await actorNames(scope, WRITERS.map((w) => states[w].updatedBy))
  const out = {} as WritersDto
  for (const w of WRITERS) out[w] = toWriterDto(states[w], names)
  return out
}

/** Plans for the admin, with their correction rows and the names of who decided them. */
export async function planDtos(scope: Scope, plans: readonly PlanRow[]): Promise<CorrectionPlanDto[]> {
  const svc = fakturowniaService(scope)
  const ids = plans.map((p) => p.correction_document_id).filter((id): id is string => Boolean(id))
  const rows = ids.length > 0 ? await listDocuments(svc, { id: ids }, { take: ids.length }) : []
  const names = await actorNames(scope, plans.flatMap((p) => [p.approved_by, p.closed_by]))
  return plans.map((p) => toPlanDto(p, rows.find((r) => r.id === p.correction_document_id) ?? null, names))
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to
 * Fakturownia while rendering. Going to the network sits behind POST routes
 * and clicks.
 */
export async function buildStatus(scope: Scope): Promise<StatusResponse> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const demo = o.demo
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)

  const ksefKinds = ["vat", "correction"]
  const [total, issued24h, pending, issued, failed, unknown, needsCorrection, canceled, unpaid, ksefProblems, attention, corrections] = await Promise.all([
    count(svc, { demo }),
    count(svc, { demo, status: "issued", issued_at: { $gte: dayAgo } }),
    count(svc, documentFilters("pending", demo)),
    count(svc, documentFilters("issued", demo)),
    count(svc, { demo, status: "failed" }),
    count(svc, { demo, status: "unknown" }),
    count(svc, { demo, status: "needs_correction" }),
    count(svc, documentFilters("canceled", demo)),
    count(svc, documentFilters("unpaid", demo)),
    count(svc, documentFilters("ksef", demo)),
    count(svc, documentFilters("attention", demo)),
    count(svc, documentFilters("corrections", demo)),
  ])
  const [ksefAccepted, ksefProcessing, buyerWarnings, correctionsOpen, correctionsApproved, correctionsIssued, reminders, emails] = await Promise.all([
    count(svc, { demo, kind: ksefKinds, status: ["issued", "needs_correction"], gov_status: [...GOV_ACCEPTED_VALUES] }),
    count(svc, { demo, kind: ksefKinds, status: ["issued", "needs_correction"], gov_status: [...GOV_PROCESSING_VALUES] }),
    count(svc, { demo, buyer_warning: { $ne: null } }),
    countPlans(svc, { demo, status: ["draft", "manual"] }),
    countPlans(svc, { demo, status: "approved" }),
    countPlans(svc, { demo, status: "issued" }),
    count(svc, reminderFilters(demo, o.reminderAfterDays)),
    countEmails(svc, { demo }),
  ])

  const lastRuns: Partial<Record<RunKind, RunDto>> = {}
  for (const kind of ["issue", "payments", "statuses", "corrections"] as RunKind[]) {
    const run = await lastRun(svc, kind)
    if (run) lastRuns[kind] = run
  }

  return {
    mode: demo ? "demo" : "live",
    demoReason: o.demoReason,
    /* Demo mode: the sample documents exist (the page asks for them once with POST /admin/fakturownia/demo/seed). */
    demoPrepared: demo ? total > 0 : true,
    configured: svc.isConfigured(),
    missing: svc.missingOptions(),
    tokenSet: Boolean(o.apiToken),
    account: o.account || null,
    accountUrl: accountUrl(o),
    options: {
      documentFlow: o.documentFlow,
      trigger: o.trigger,
      receiptForConsumers: o.receiptForConsumers,
      receiptKind: o.receiptKind,
      defaultVatRate: String(o.defaultVatRate),
      lang: o.lang,
      issuePlace: o.issuePlace || null,
      departmentId: o.departmentId,
      categoryId: o.categoryId,
      shippingPositionName: o.shippingPositionName,
      quantityUnit: o.quantityUnit,
      paymentTermDays: o.paymentTermDays,
      markPaidOnCapture: o.markPaidOnCapture,
      sendByEmail: o.sendByEmail,
      cancelOnOrderCanceled: o.cancelOnOrderCanceled,
      oidPrefix: o.oidPrefix || null,
      requestsPerMinute: o.requestsPerMinute,
      corrections: o.corrections,
      emailPdf: o.emailPdf,
      reminderAfterDays: o.reminderAfterDays,
      nipSources: o.nipSources.map(describeNipSource),
      departmentsBySalesChannel: o.departmentsBySalesChannel.map(([salesChannelId, departmentId]) => ({ salesChannelId, departmentId })),
    },
    counts: {
      total,
      issued24h,
      pending,
      issued,
      failed,
      unknown,
      needsCorrection,
      canceled,
      attention,
      corrections,
      unpaid,
      ksefProblems,
      ksefAccepted,
      ksefProcessing,
      buyerWarnings,
      correctionsOpen,
      correctionsApproved,
      correctionsIssued,
      reminders,
      emails,
    },
    writers: await writersDto(scope),
    references: o.references,
    lastRuns,
    lastCheck: lastCheck(demo ? "demo" : "live"),
    running: runningKinds(),
    schedules: { issue: ISSUE_SCHEDULE, payments: PAYMENTS_SCHEDULE, statuses: STATUSES_SCHEDULE, corrections: CORRECTIONS_SCHEDULE },
  }
}

/** A row as the admin sees it: no secret, and the panel link only in live mode. */
export function documentDto(svc: FakturowniaModuleService, row: DocumentRow) {
  return toDocumentDto(row, accountUrl(svc.getOptions()))
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function strParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

/** `%q%` for `$ilike`, with the wildcard characters of the search escaped. */
export function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export { pdfFileName }

/** Codes meaning "this store is not connected to Fakturownia now", not "this document is wrong". */
const NOT_CONNECTED_CODES: ReadonlySet<string> = new Set(["NO_TOKEN", "BAD_ACCOUNT", "DEMO_MODE"])

/**
 * Streams the PDF of a document row to the response: generated in demo mode,
 * fetched by the backend in live mode. Maps the failures to readable answers:
 * 409 while Fakturownia has not rendered the PDF yet, 404 for a document
 * Fakturownia does not hold, 503 when the store is not connected (no token),
 * 502 for anything else. The admin reads the masked reason; a shopper
 * (`audience: "store"`) a plain sentence, the reason goes to the server log.
 */
export async function sendDocumentPdf(
  scope: Scope,
  res: MedusaResponse,
  row: DocumentRow,
  disposition: "inline" | "attachment" = "inline",
  audience: "admin" | "store" = "admin",
): Promise<void> {
  const svc = fakturowniaService(scope)
  try {
    const file = await fetchDocumentPdf({
      options: svc.getOptions(),
      client: () => clientFor(svc),
      externalId: String(row.fakturownia_id ?? ""),
      demo: Boolean(row.demo),
      number: row.number,
      kind: row.kind,
      issueDate: row.issue_date,
      total: row.total_gross === null || row.total_gross === undefined ? null : `${Number(row.total_gross).toFixed(2)} ${row.currency ?? ""}`.trim(),
    })
    res.setHeader("Content-Type", file.contentType)
    res.setHeader("Content-Disposition", contentDisposition(disposition, file.filename, unicodeFileName(row.number, `document-${row.fakturownia_id ?? row.id}`)))
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Cache-Control", "private, no-store")
    res.status(200).send(file.data)
  } catch (err) {
    const code = err instanceof FakturowniaApiError ? err.code : ""
    const notReady = code === "PDF_NOT_READY"
    const missing = err instanceof FakturowniaApiError && err.status === 404
    const notConnected = NOT_CONNECTED_CODES.has(code)
    const reason = svc.mask(describeError(err).message)
    if (!notReady && !missing) svc.getLogger().warn(`[fakturownia] PDF of ${row.id} (${audience}): ${reason}`)
    res.status(notReady ? 409 : missing ? 404 : notConnected ? 503 : 502).json({
      message: notReady
        ? "Fakturownia has not rendered this PDF yet (a new document, or a KSeF number still on its way). Try again in a minute."
        : missing
          ? "Fakturownia does not hold this document any more."
          : audience === "store"
            ? "The document cannot be downloaded right now. Try again later."
            : notConnected
              ? "The store is not connected to Fakturownia (no API token or account): the PDF cannot be fetched."
              : reason,
    })
  }
}
