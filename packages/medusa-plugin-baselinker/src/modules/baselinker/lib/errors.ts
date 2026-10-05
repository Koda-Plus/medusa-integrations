/**
 * ERRORS, CLASSIFIED ONCE. Zero runtime imports beyond the barrier error, so
 * the unit tests load it without a build.
 *
 * BaseLinker answers HTTP 200 also when an operation failed: the truth sits
 * in the body, `status: "ERROR"` plus `error_code`. Every failure becomes a
 * `BaseLinkerApiError` with `transient`, and the outbox only reads that flag.
 *
 * A third state exists only for methods that CREATE: `BaseLinkerUnknownResultError`
 * means "we did not get an answer", not "it failed". A timeout, a 502 from a
 * proxy or broken JSON after `addOrder` may hide an order BaseLinker already
 * created, so the reaction is never "send again", it is "scan for the marker
 * before writing anything".
 */

import { BaseLinkerWriteBlockedError } from "./security"

export class BaseLinkerApiError extends Error {
  /** BaseLinker `error_code`, or `HTTP_502`, `ERROR_NETWORK`, `ERROR_JSON`... */
  readonly code: string
  readonly method: string
  /** Worth another attempt later: network, 5xx, rate limit, a temporary BaseLinker error. */
  readonly transient: boolean
  /** HTTP status, 0 when BaseLinker was not reached at all. */
  readonly status: number

  constructor(args: { code: string; method: string; message: string; transient: boolean; status?: number }) {
    super(`BaseLinker ${args.method}: ${args.code}${args.message ? ` ${args.message}` : ""}`)
    this.name = "BaseLinkerApiError"
    this.code = args.code
    this.method = args.method
    this.transient = args.transient
    this.status = args.status ?? 0
  }
}

export class BaseLinkerUnknownResultError extends Error {
  readonly method: string
  readonly reason: string

  constructor(method: string, reason: unknown) {
    const text = reason instanceof Error ? reason.message : String(reason)
    super(`BaseLinker ${method}: unknown result (${text}). The next attempt scans for the order marker before writing anything.`)
    this.name = "BaseLinkerUnknownResultError"
    this.method = method
    this.reason = text
  }
}

/**
 * Error codes in the BaseLinker body that are worth a retry. The rest is
 * permanent: a wrong token does not fix itself in a minute and bad
 * parameters never do without a change in data or code. Exact matches, so
 * `ERROR_UNKNOWN_METHOD` is permanent while `ERROR_UNKNOWN` is not.
 */
export const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "ERROR_RATE_LIMIT",
  "ERROR_LIMIT_EXCEEDED",
  "ERROR_TOO_MANY_REQUESTS",
  "ERROR_INTERNAL",
  "ERROR_TEMPORARY",
  "ERROR_UNKNOWN",
  "ERROR_NETWORK",
  "ERROR_JSON",
])

/**
 * Codes after which BaseLinker REFUSED to take the request, so nothing was
 * created. The one transient case in which a creating method may be repeated
 * right away.
 */
export const REFUSED_CODES: ReadonlySet<string> = new Set([
  "ERROR_RATE_LIMIT",
  "ERROR_LIMIT_EXCEEDED",
  "ERROR_TOO_MANY_REQUESTS",
  "HTTP_429",
])

export function isTransient(err: unknown): boolean {
  return err instanceof BaseLinkerApiError && err.transient
}

export function isRefused(err: unknown): boolean {
  return err instanceof BaseLinkerApiError && REFUSED_CODES.has(err.code)
}

/**
 * One answer of connector.php into data or an error. Pure: the client calls
 * it with the HTTP status and the raw text, tests call it with fixtures.
 *
 * The body is read as text first: a 502 from a gateway brings HTML, and
 * parsing it as JSON would throw a SyntaxError that says nothing about the
 * outage.
 */
export function interpretResponse(args: {
  method: string
  httpStatus: number
  text: string
  mask: (text: string) => string
}): Record<string, unknown> {
  const { method, httpStatus, text, mask } = args
  if (httpStatus < 200 || httpStatus >= 300) {
    return fail(
      new BaseLinkerApiError({
        code: `HTTP_${httpStatus}`,
        method,
        message: mask(text.replace(/\s+/g, " ").trim().slice(0, 300)),
        transient: httpStatus >= 500 || httpStatus === 429,
        status: httpStatus,
      }),
    )
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return fail(
      new BaseLinkerApiError({
        code: "ERROR_JSON",
        method,
        message: mask(`not JSON: ${text.replace(/\s+/g, " ").trim().slice(0, 120)}`),
        transient: true,
        status: httpStatus,
      }),
    )
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return fail(new BaseLinkerApiError({ code: "ERROR_JSON", method, message: "the answer is not an object", transient: true, status: httpStatus }))
  }
  const body = json as Record<string, unknown>
  if (body.status === "ERROR") {
    const code = String(body.error_code ?? "ERROR").trim() || "ERROR"
    return fail(
      new BaseLinkerApiError({
        code,
        method,
        message: mask(String(body.error_message ?? "")),
        transient: TRANSIENT_CODES.has(code),
        status: httpStatus,
      }),
    )
  }
  return body
}

function fail(err: Error): never {
  throw err
}

/** Medusa error types that do not get better by waiting (bad data, a refused action, a missing record). */
const PERMANENT_MEDUSA_TYPES: ReadonlySet<string> = new Set(["invalid_data", "not_allowed", "not_found", "duplicate_error", "invalid_argument", "conflict"])

/**
 * `describeError` for errors that may come from Medusa itself (the order
 * workflows of the import): a MedusaError carries a `type`, and invalid data,
 * a refused action (not enough stock, for example) or a missing record are
 * permanent, so the row waits for a person instead of retrying for days.
 */
export function describeAnyError(err: unknown): { code: string; message: string; retryable: boolean } {
  const d = describeError(err)
  const type = (err as { type?: unknown } | null)?.type
  if (typeof type === "string" && type) {
    return { code: d.code === "internal" ? type : d.code, message: d.message, retryable: !PERMANENT_MEDUSA_TYPES.has(type) }
  }
  return d
}

/** Short, safe description of any error for the outbox, the runs and the admin. */
export function describeError(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof BaseLinkerWriteBlockedError) return { code: "write_blocked", message: err.message, retryable: false }
  if (err instanceof BaseLinkerUnknownResultError) return { code: "unknown_result", message: err.message, retryable: true }
  if (err instanceof BaseLinkerApiError) return { code: err.code, message: err.message, retryable: err.transient }
  const e = err as { code?: unknown; message?: unknown; retryable?: unknown } | null
  const message = typeof e?.message === "string" ? e.message : String(err)
  return {
    code: typeof e?.code === "string" && e.code ? e.code : "internal",
    message: message.length > 1000 ? `${message.slice(0, 1000)}...` : message,
    retryable: typeof e?.retryable === "boolean" ? e.retryable : true,
  }
}
