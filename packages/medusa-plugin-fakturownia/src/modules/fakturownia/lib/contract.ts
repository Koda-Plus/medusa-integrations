/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN (and the storefront routes).
 * Types only, zero imports: the admin bundle imports them and Vite never sees
 * server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET OR FOR BUYER DATA. The token stays on
 * the server (the admin learns only whether it is set), the tables keep no
 * names or addresses, and e-mail addresses travel masked ("a***@e***.pl").
 */

export type FakturowniaMode = "demo" | "live"
export type DocumentKind = "vat" | "proforma" | "receipt" | "correction"
export type DocumentStatus = "pending" | "issuing" | "issued" | "failed" | "unknown" | "canceled" | "needs_correction"
/** Filters of the documents table. `attention`: failed, unknown or needing a correction. */
export type DocumentFilter = "all" | "pending" | "issued" | "attention" | "unpaid" | "ksef" | "canceled" | "corrections"
export type GovState = "none" | "processing" | "accepted" | "problem" | "not_applicable" | "offline"
export type EmailStatus = "pending" | "sent" | "failed"
export type RunKind = "issue" | "payments" | "statuses" | "corrections"
export type RunSource = "api" | "demo"
export type RunTrigger = "schedule" | "manual" | "auto"
export type RunStatus = "ok" | "partial" | "error"
export type WriterKey = "corrections" | "emails" | "ksef"

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
  /** A correction's position: the state before and after (quantity and gross carry the change). */
  before: { quantity: number; gross: number } | null
  after: { quantity: number; gross: number } | null
}

/** Why a buyer that looks like a company got a consumer document. */
export interface BuyerWarningDto {
  code: "invalid_nip" | "company_without_nip"
  reason: "checksum" | "length" | "shape" | null
  source: string | null
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
  buyerWarning: BuyerWarningDto | null
  fromFakturowniaId: string | null
  /** A correction: the row it corrects. */
  correctsDocumentId: string | null
  paid: boolean
  paidAt: string | null
  govStatus: string | null
  govState: GovState
  govId: string | null
  govError: string | null
  govErrors: string[]
  govSendDate: string | null
  /** The KSeF portal link to verify the document (public, used for the QR code). */
  govVerificationLink: string | null
  govLink: string | null
  /** A correction: the KSeF number of the corrected invoice. */
  govCorrectedNumber: string | null
  govCheckedAt: string | null
  ksefResendAt: string | null
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
    /** E-mail it (the e-mails writer must be armed too). */
    email: boolean
    /** Ask Fakturownia to send it to KSeF again (the KSeF writer must be armed too). */
    ksefResend: boolean
    /** The KSeF XML and the UPO can be downloaded (accepted by KSeF). */
    ksefFiles: boolean
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
  /** `departmentsBySalesChannel`: each mapped department, found on the account or not. */
  channelDepartments: Array<{ salesChannelId: string; departmentId: number; found: boolean; name: string | null }>
}

export interface WriterDto {
  key: WriterKey
  /** The options allow it (`writers.<key>` is not false). */
  allowed: boolean
  /** A person turned it on in the admin. */
  on: boolean
  /** It writes: allowed and on. */
  armed: boolean
  /** Who turned it on or off last (an admin's e-mail, or the user id). */
  updatedBy: string | null
  updatedAt: string | null
}

export type WritersDto = Record<WriterKey, WriterDto>

export interface LocalizedTextDto {
  en: string | null
  pl: string | null
}

export interface ReferenceDto {
  name: string
  /** https. Null only for a store that starts soon and has no address yet. */
  url: string | null
  /** The store starts on Medusa soon: a "Soon" badge, no link. */
  soon: boolean
  /** The store's icon: a data URI or an https URL. */
  icon: string | null
  description: LocalizedTextDto | null
  metrics: Array<{ label: LocalizedTextDto; value: string }>
  links: Array<{ label: LocalizedTextDto; url: string }>
  /** The store's rating of the work and where it was given, e.g. Clutch. */
  review: {
    rating: number
    scale: number
    source: string
    url: string | null
    icon: string | null
    quote: LocalizedTextDto | null
    author: string | null
  } | null
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
    corrections: "plan" | "off"
    emailPdf: boolean
    reminderAfterDays: number
    /** Where the buyer's NIP is looked for, in order. */
    nipSources: string[]
    departmentsBySalesChannel: Array<{ salesChannelId: string; departmentId: number }>
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
    ksefAccepted: number
    ksefProcessing: number
    /** Documents issued for a consumer because of an invalid or missing NIP. */
    buyerWarnings: number
    correctionsOpen: number
    correctionsApproved: number
    correctionsIssued: number
    reminders: number
    emails: number
  }
  writers: WritersDto
  references: ReferenceDto[]
  lastRuns: Partial<Record<RunKind, RunDto>>
  lastCheck: CheckResult | null
  running: string[]
  schedules: { issue: string; payments: string; statuses: string; corrections: string }
}

export interface DocumentsResponse {
  documents: DocumentDto[]
  count: number
  limit: number
  offset: number
}

/* ---- Corrections --------------------------------------------------- */

export type PlanStatus = "draft" | "manual" | "approved" | "issued" | "dismissed" | "done" | "obsolete"
export type PlanFilter = "open" | "approved" | "issued" | "closed" | "all"
export type ReasonKind = "cancel" | "return" | "refund" | "edit"
export type ManualReason = "receipt" | "claim_or_exchange" | "unknown_positions" | "unreadable_order"

export interface PlanPositionDto {
  name: string
  code: string | null
  tax: string
  unit: string
  before: { quantity: number; gross: number }
  after: { quantity: number; gross: number }
  delta: { quantity: number; gross: number; net: number; vat: number }
}

export interface CorrectionPlanDto {
  id: string
  orderId: string
  displayId: number | null
  documentId: string
  documentKind: DocumentKind
  documentNumber: string | null
  status: PlanStatus
  manualReason: ManualReason | null
  revision: number
  sources: Array<{ type: string; id: string; at: string }>
  reasons: ReasonKind[]
  /** The reason printed on the correction (`correction_reason`). */
  reason: string | null
  positions: PlanPositionDto[]
  notes: Array<{ code: string; amount: number | null; detail: string | null }>
  currency: string | null
  totals: { net: number; vat: number; gross: number }
  simulated: boolean
  /** The correction document once the plan is approved. */
  correction: { id: string; status: DocumentStatus; number: string | null; error: string | null; errorCode: string | null } | null
  approvedBy: string | null
  approvedAt: string | null
  closedBy: string | null
  closedAt: string | null
  closeNote: string | null
  computedAt: string | null
  createdAt: string | null
  demo: boolean
  actions: { approve: boolean; dismiss: boolean; done: boolean }
}

export interface CorrectionsResponse {
  plans: CorrectionPlanDto[]
  count: number
  limit: number
  offset: number
}

export interface PlanResponse {
  plan: CorrectionPlanDto
  /** Approve: whether the corrections writer is armed (otherwise the correction waits for it). */
  armed?: boolean
}

/* ---- E-mails and KSeF ---------------------------------------------- */

export type EmailKind = "auto" | "manual" | "reminder"
export type EmailOutcome = "sent" | "failed" | "refused"

export interface EmailDto {
  id: string
  documentId: string
  orderId: string
  kind: EmailKind
  status: EmailOutcome
  /** Masked: "a***@e***.pl". */
  recipient: string | null
  cc: string | null
  withPdf: boolean
  subject: string | null
  error: string | null
  requestedBy: string | null
  createdAt: string | null
  demo: boolean
  /** The document, for lists across documents. */
  documentNumber: string | null
  displayId: number | null
}

export interface EmailsResponse {
  emails: EmailDto[]
  count: number
  limit: number
  offset: number
}

export interface KsefEventDto {
  id: string
  source: "issue" | "refresh" | "resend" | "demo"
  govStatus: string | null
  govState: GovState
  govId: string | null
  errors: string[]
  requestedBy: string | null
  note: string | null
  createdAt: string | null
}

export interface DocumentDetailResponse {
  document: DocumentDto
  ksef: KsefEventDto[]
  emails: EmailDto[]
  /** Corrections of this document, and the document a correction corrects. */
  corrections: DocumentDto[]
  corrected: DocumentDto | null
  plans: CorrectionPlanDto[]
  writers: WritersDto
}

export interface EmailRequest {
  kind?: "manual" | "reminder"
  /** Another address than the buyer's (up to five, comma separated). */
  to?: string
  attachPdf?: boolean
}

export interface ActionResponse {
  document: DocumentDto
  /** What the action found or did, for the toast. */
  outcome: string
  message?: string | null
}

/* ---- Reminders and the summary -------------------------------------- */

export interface ReminderDto {
  document: DocumentDto
  ageDays: number
  reminders: number
  lastReminderAt: string | null
  /** False while the last reminder is younger than a day. */
  canRemind: boolean
}

export interface RemindersResponse {
  documents: ReminderDto[]
  afterDays: number
  count: number
}

export interface MoneyDto {
  currency: string
  amount: number
}

export interface SummaryMonthDto {
  /** `YYYY-MM`. */
  month: string
  kinds: Record<DocumentKind, { count: number; gross: MoneyDto[] }>
  unpaidCount: number
  unpaid: MoneyDto[]
  ksef: { accepted: number; total: number; share: number | null }
}

export interface SummaryResponse {
  months: SummaryMonthDto[]
  /** The row ceiling was hit: older months may be incomplete. */
  capped: boolean
}

/* ---- The order widget ---------------------------------------------- */

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
  plans: CorrectionPlanDto[]
  corrections: "plan" | "off"
  writers: WritersDto
}

export interface RunsResponse {
  runs: RunDto[]
}

export interface SyncResponse {
  started: boolean
  alreadyRunning: boolean
  mode: FakturowniaMode
  what: "issue" | "statuses" | "payments" | "corrections"
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

/* ---- Storefront (a logged-in customer) ----------------------------- */

export interface StoreDocumentDto {
  id: string
  kind: DocumentKind
  number: string | null
  issueDate: string | null
  totalGross: number | null
  currency: string | null
  paid: boolean
  /** The KSeF number once KSeF accepted the document. */
  ksefNumber: string | null
  /** The correction of: the number of the corrected document. */
  corrects: string | null
  /** Relative to the backend: GET it with the customer's session or token. */
  pdfUrl: string
}

export interface StoreDocumentsResponse {
  order_id: string
  documents: StoreDocumentDto[]
}
