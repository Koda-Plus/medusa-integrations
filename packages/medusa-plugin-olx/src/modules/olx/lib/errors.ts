/**
 * ERRORS OF THE OLX CLIENT, AND WHAT A WRITER MAY DO AFTER EACH ONE. Zero
 * imports: the planners, the apply loops and the unit tests use them as is.
 *
 *   rejected    4xx with a reason (validation, not the owner, wrong status).
 *               Nothing changed on OLX. Counted as an attempt; the item is
 *               quarantined after a few in a row.
 *   unknown     timeout, network error, 5xx or a broken answer AFTER a write
 *               went out. OLX may or may not have applied it: the item is
 *               looked up before anything is sent again.
 *   throttled   429, or the 403 OLX answers for 30 minutes after 4 500
 *               requests in 5 minutes from one IP. Nothing was applied; the
 *               run stops and the item waits, without counting an attempt.
 *   auth        401 after a token refresh. The run stops; the connection
 *               card tells the person what to do.
 *   not_found   404: the advert is gone.
 */

export interface OlxValidationIssue {
  field: string
  title: string
}

export class OlxApiError extends Error {
  readonly status: number
  readonly transient: boolean
  /** True for the 403 OLX sends while an IP is blocked for exceeding the limit. */
  readonly blocked: boolean
  readonly validation: OlxValidationIssue[]
  constructor(
    status: number,
    message: string,
    transient: boolean,
    extra: { blocked?: boolean; validation?: OlxValidationIssue[] } = {},
  ) {
    super(message)
    this.name = "OlxApiError"
    this.status = status
    this.transient = transient
    this.blocked = Boolean(extra.blocked)
    this.validation = extra.validation ?? []
  }
}

/** A write went out and no clear answer came back. */
export class OlxUnknownResultError extends Error {
  readonly operation: string
  constructor(operation: string, cause: unknown) {
    super(`${operation}: no clear answer from OLX (${cause instanceof Error ? cause.message : String(cause)}). It is looked up before anything is sent again.`)
    this.name = "OlxUnknownResultError"
    this.operation = operation
  }
}

/** A write the barrier refused, or a writer that is not armed. */
export class OlxWriteBlockedError extends Error {
  readonly method: string
  readonly url: string
  constructor(method: string, url: string, reason: string) {
    super(reason)
    this.name = "OlxWriteBlockedError"
    this.method = method
    this.url = url
  }
}

export type ErrorClass = "rejected" | "unknown" | "throttled" | "auth" | "not_found" | "blocked_by_plugin" | "transient"

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof OlxUnknownResultError) return "unknown"
  if (err instanceof OlxWriteBlockedError) return "blocked_by_plugin"
  if (err instanceof OlxApiError) {
    if (err.blocked || err.status === 429) return "throttled"
    if (err.status === 401) return "auth"
    if (err.status === 404) return "not_found"
    if (err.status >= 400 && err.status < 500) return "rejected"
    return "transient"
  }
  return "transient"
}

/**
 * The 403 of the IP block comes from the CDN in front of OLX, as an HTML page
 * ("Request blocked", "cloudfront") instead of the usual JSON error.
 */
export function looksLikeIpBlock(status: number, body: string): boolean {
  if (status !== 403) return false
  return /request blocked|cloudfront|request could not be satisfied/i.test(body)
}

/**
 * Validation issues from an OLX error body:
 * `{ error: { status, title, detail, validation: [{ field, title, detail }] } }`,
 * sometimes wrapped in `data`.
 */
export function parseValidation(body: unknown): { detail: string | null; issues: OlxValidationIssue[] } {
  let root: unknown = body
  if (root && typeof root === "object" && "data" in (root as Record<string, unknown>)) {
    const inner = (root as Record<string, unknown>).data
    if (inner && typeof inner === "object" && "error" in (inner as Record<string, unknown>)) root = inner
  }
  const error = root && typeof root === "object" ? (root as Record<string, unknown>).error : null
  if (!error || typeof error !== "object") {
    return { detail: typeof error === "string" ? error : null, issues: [] }
  }
  const e = error as Record<string, unknown>
  const list = Array.isArray(e.validation) ? e.validation : []
  const issues: OlxValidationIssue[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const v = item as Record<string, unknown>
    const field = String(v.field ?? "").trim()
    const title = String(v.title ?? v.detail ?? "").trim()
    if (field || title) issues.push({ field, title })
  }
  const detail = String(e.detail ?? e.title ?? e.message ?? "").trim()
  return { detail: detail || null, issues }
}

/** One line for logs and the admin: "Data validation error occurred: title: Too many capital letters". */
export function describeValidation(detail: string | null, issues: readonly OlxValidationIssue[]): string {
  const parts = issues.map((i) => (i.field ? `${i.field}: ${i.title}` : i.title)).filter(Boolean)
  if (parts.length === 0) return detail ?? "rejected"
  return `${detail ?? "rejected"}: ${parts.join("; ")}`
}
