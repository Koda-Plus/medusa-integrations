/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. Types only, zero imports: the
 * admin bundle imports them and Vite never sees server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET OR FOR BUYER DATA. The token stays on
 * the server (the admin learns only whether it is set), and the tables keep
 * no names or addresses.
 */

export type FakturowniaMode = "demo" | "live"
export type DocumentKind = "vat" | "proforma" | "receipt"
export type DocumentStatus = "pending" | "issuing" | "issued" | "failed" | "unknown" | "canceled" | "needs_correction"
/** Filters of the documents table. `attention`: failed, unknown or needing a correction. */
export type DocumentFilter = "all" | "pending" | "issued" | "attention" | "unpaid" | "ksef" | "canceled"
export type GovState = "none" | "processing" | "accepted" | "problem" | "not_applicable" | "offline"
export type EmailStatus = "pending" | "sent" | "failed"
export type RunKind = "issue" | "payments" | "statuses"
export type RunSource = "api" | "demo"
export type RunTrigger = "schedule" | "manual" | "auto"
export type RunStatus = "ok" | "partial" | "error"

export interface RunDto {
  id: string
  kind: RunKind
  source: RunSource
  trigger: RunTrigger
  status: RunStatus
  complete: boolean
  counts: Record<string, unknown>
  message: string | null
  durationMs: number
  startedAt: string
  finishedAt: string | null
}

export interface DocumentPositionDto {
  name: string
  code: string | null
  quantity: number
  unit: string
  gross: number
  tax: string
}

export interface DocumentDto {
  id: string
  orderId: string
  displayId: number | null
  kind: DocumentKind
  status: DocumentStatus
  fakturowniaId: string | null
  number: string | null
  oid: string | null
  issueDate: string | null
  currency: string | null
  totalGross: number | null
  positions: DocumentPositionDto[]
  buyerType: "company" | "person" | null
  fromFakturowniaId: string | null
  paid: boolean
  paidAt: string | null
  govStatus: string | null
  govState: GovState
  govId: string | null
  govError: string | null
  govCheckedAt: string | null
  error: string | null
  errorCode: string | null
  attempts: number
  nextAttemptAt: string | null
  issuedAt: string | null
  cancelRequestedAt: string | null
  emailStatus: EmailStatus | null
  emailedAt: string | null
  emailError: string | null
  demo: boolean
  createdAt: string | null
  updatedAt: string | null
  /** The document in the Fakturownia panel (live mode, issued documents only). */
  fakturowniaUrl: string | null
  actions: {
    retry: boolean
    reconcile: boolean
    issueAgain: boolean
    markIssued: boolean
    pdf: boolean
  }
}

export interface CheckResult {
  ok: boolean
  mode: FakturowniaMode
  error: string | null
  checkedAt: string
  departments: Array<{ id: string; name: string }>
  /** Whether `departmentId` exists on the account; null when the option is not set. */
  departmentFound: boolean | null
  departmentName: string | null
  /** Whether `categoryId` exists on the account; null when the option is not set. */
  categoryFound: boolean | null
  categoryName: string | null
}

export interface StatusResponse {
  mode: FakturowniaMode
  /** Why demo mode is on: the option, or no token. */
  demoReason: "option" | "no_token" | null
  /** Live mode: the token and a valid account are set. Always true in demo mode. */
  configured: boolean
  missing: string[]
  tokenSet: boolean
  account: string | null
  accountUrl: string | null
  options: {
    documentFlow: "vat" | "proforma_then_vat"
    trigger: "payment_captured" | "order_placed"
    receiptForConsumers: boolean
    receiptKind: string
    defaultVatRate: string
    lang: string
    issuePlace: string | null
    departmentId: number | null
    categoryId: number | null
    shippingPositionName: string
    quantityUnit: string
    paymentTermDays: number
    markPaidOnCapture: boolean
    sendByEmail: boolean
    cancelOnOrderCanceled: boolean
    oidPrefix: string | null
    requestsPerMinute: number
  }
  counts: {
    total: number
    issued24h: number
    pending: number
    issued: number
    failed: number
    unknown: number
    needsCorrection: number
    canceled: number
    attention: number
    unpaid: number
    ksefProblems: number
  }
  lastRuns: Partial<Record<RunKind, RunDto>>
  lastCheck: CheckResult | null
  running: string[]
  schedules: { issue: string; payments: string; statuses: string }
}

export interface DocumentsResponse {
  documents: DocumentDto[]
  count: number
  limit: number
  offset: number
}

export interface OrderDocumentsResponse {
  mode: FakturowniaMode
  configured: boolean
  /** "Issue now" is possible: configured, the order is not canceled, no document is waiting. */
  canIssue: boolean
  /** The kind "Issue now" would issue. */
  nextKind: DocumentKind | null
  /** What the first document waits for when the order has none yet. */
  waitingFor: "payment_captured" | "order_placed" | null
  documents: DocumentDto[]
}

export interface RunsResponse {
  runs: RunDto[]
}

export interface SyncResponse {
  started: boolean
  alreadyRunning: boolean
  mode: FakturowniaMode
  what: "issue" | "statuses" | "payments"
}

export interface CheckResponse {
  result: CheckResult
  status: StatusResponse
}

export interface DocumentResponse {
  document: DocumentDto
  /** What the action found, for the toast: adopted, waiting, conflict, absent... */
  outcome?: string | null
}
