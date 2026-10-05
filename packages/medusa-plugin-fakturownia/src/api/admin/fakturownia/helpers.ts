import type FakturowniaModuleService from "../../../modules/fakturownia/service"
import { ISSUE_SCHEDULE, PAYMENTS_SCHEDULE, STATUSES_SCHEDULE } from "../../../modules/fakturownia/lib/constants"
import type { DocumentFilter, RunDto, RunKind, StatusResponse } from "../../../modules/fakturownia/lib/contract"
import { toDocumentDto, type DocumentRow } from "../../../modules/fakturownia/lib/dto"
import { accountUrl } from "../../../modules/fakturownia/lib/options"
import { GOV_PROBLEMS } from "../../../modules/fakturownia/lib/status"
import { ActionError } from "../../../workflows/fakturownia/documents"
import { fakturowniaService, lastCheck, lastRun, runningKinds } from "../../../workflows/fakturownia/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { fakturowniaService, ActionError }

/** Every KSeF problem status, with the `demo_` twins of the KSeF test environment. */
export const GOV_PROBLEM_VALUES: readonly string[] = [...GOV_PROBLEMS, ...GOV_PROBLEMS.map((s) => `demo_${s}`)]

async function count(svc: FakturowniaModuleService, filters: Record<string, unknown>): Promise<number> {
  const [, n] = await svc.listAndCountFakturowniaDocuments(filters as never, { take: 1, select: ["id"] } as never)
  return n
}

/** The table filter as service filters, in the current mode. */
export function documentFilters(filter: DocumentFilter, demo: boolean): Record<string, unknown> {
  const where: Record<string, unknown> = { demo }
  switch (filter) {
    case "pending":
      where.status = ["pending", "issuing"]
      break
    case "issued":
      where.status = "issued"
      break
    case "attention":
      where.status = ["failed", "unknown", "needs_correction"]
      break
    case "unpaid":
      where.status = "issued"
      where.paid = false
      break
    case "ksef":
      where.kind = "vat"
      where.gov_status = [...GOV_PROBLEM_VALUES]
      break
    case "canceled":
      where.status = "canceled"
      break
  }
  return where
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to
 * Fakturownia while rendering. Going to the network sits behind POST routes
 * and clicks.
 */
export async function buildStatus(svc: FakturowniaModuleService): Promise<StatusResponse> {
  const o = svc.getOptions()
  const demo = o.demo
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)

  const [total, issued24h, pending, issued, failed, unknown, needsCorrection, canceled, unpaid, ksefProblems] = await Promise.all([
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
  ])

  const lastRuns: Partial<Record<RunKind, RunDto>> = {}
  for (const kind of ["issue", "payments", "statuses"] as RunKind[]) {
    const run = await lastRun(svc, kind)
    if (run) lastRuns[kind] = run
  }

  return {
    mode: demo ? "demo" : "live",
    demoReason: o.demoReason,
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
      attention: failed + unknown + needsCorrection,
      unpaid,
      ksefProblems,
    },
    lastRuns,
    lastCheck: lastCheck(demo ? "demo" : "live"),
    running: runningKinds(),
    schedules: { issue: ISSUE_SCHEDULE, payments: PAYMENTS_SCHEDULE, statuses: STATUSES_SCHEDULE },
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

/** A document file name from its number: "FV 12/10/2026" becomes "FV-12-10-2026.pdf". */
export function pdfFileName(number: string | null, fallback: string): string {
  const base = (number ?? "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || fallback
  return `${base}.pdf`
}
