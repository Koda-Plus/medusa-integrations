/**
 * ERRORS, CLASSIFIED ONCE. Zero imports, so the unit tests load it without a
 * build.
 *
 * Every failure of a Fakturownia call becomes a `FakturowniaApiError` with two
 * flags the outbox reads:
 *
 *   transient  worth another attempt later (network, 5xx, 429, timeout);
 *   refused    Fakturownia did NOT act on the request: every 4xx answer, and
 *              network errors that never reached the server (DNS, connection
 *              refused). A refused create created nothing.
 *
 * A third state exists only for the call that CREATES a document:
 * `FakturowniaUnknownResultError` means "we did not get an answer", not "it
 * failed". A timeout, a 502 from a proxy or a broken body after the create
 * request may hide a document Fakturownia already issued, so the reaction is
 * never "send again", it is "look for the document first" (`exactly-once.ts`).
 *
 * Fakturownia also answers HTTP 200 with `{"status": "error", "message": ...}`
 * for some refusals (documented for e-mails blocked by KSeF), so a 2xx body is
 * read before it is trusted.
 */

export class FakturowniaApiError extends Error {
  /** `HTTP_422`, `HTTP_401`, `API_ERROR`, `ERROR_NETWORK`, `ERROR_TIMEOUT`, `ERROR_JSON`, `BAD_ANSWER`... */
  readonly code: string
  /** What was being done: create, get, list, update, change_status, send_by_email, pdf, departments, categories. */
  readonly operation: string
  /** Worth another attempt later. */
  readonly transient: boolean
  /** Fakturownia did not act on the request (nothing was created or changed). */
  readonly refused: boolean
  /** HTTP status, 0 when Fakturownia was not reached at all. */
  readonly status: number

  constructor(args: { code: string; operation: string; message: string; transient: boolean; refused?: boolean; status?: number }) {
    super(`Fakturownia ${args.operation}: ${args.code}${args.message ? ` ${args.message}` : ""}`)
    this.name = "FakturowniaApiError"
    this.code = args.code
    this.operation = args.operation
    this.transient = args.transient
    this.refused = args.refused ?? false
    this.status = args.status ?? 0
  }
}

export class FakturowniaUnknownResultError extends Error {
  readonly operation: string
  readonly reason: string

  constructor(operation: string, reason: unknown) {
    const text = reason instanceof Error ? reason.message : String(reason)
    super(`Fakturownia ${operation}: unknown result (${text}). The document is looked up in Fakturownia before anything is sent again.`)
    this.name = "FakturowniaUnknownResultError"
    this.operation = operation
    this.reason = text
  }
}

/** Order data that cannot become a document. Waiting does not fix it. */
export class PayloadError extends Error {
  readonly code: string
  readonly retryable = false
  constructor(code: string, message: string) {
    super(message)
    this.name = "PayloadError"
    this.code = code
  }
}

/**
 * The claim of a row is no longer the caller's: its lease ran out while the
 * attempt waited (a slow Fakturownia, a long queue of the rate limit), and
 * another process may have taken the row over. Thrown BEFORE the create
 * request leaves, so nothing was sent; the caller stops without writing.
 */
export class ClaimLostError extends Error {
  readonly code = "claim_lost"
  readonly retryable = false
  constructor(rowId: string) {
    super(`The claim of document row ${rowId} ran out before the create request; nothing was sent, another attempt takes it over.`)
    this.name = "ClaimLostError"
  }
}

/**
 * Fakturownia holds a document with this order number and kind that does not
 * match this order (another amount, another shop). Never adopted, never
 * duplicated: a person decides.
 */
export class DocumentConflictError extends Error {
  readonly code = "conflict"
  readonly retryable = false
  readonly remoteId: string
  readonly remoteNumber: string | null
  constructor(args: { remoteId: string; remoteNumber: string | null; message: string }) {
    super(args.message)
    this.name = "DocumentConflictError"
    this.remoteId = args.remoteId
    this.remoteNumber = args.remoteNumber
  }
}

/**
 * Network error codes after which the request certainly never reached
 * Fakturownia: the name did not resolve or nobody accepted the connection.
 * Everything else (reset, socket closed, timeout) may have happened after the
 * request was sent.
 */
export const NOT_SENT_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
])

/** The network error of a failed `fetch` as an API error. `mask` cleans the text. */
export function networkError(operation: string, err: unknown, mask: (text: string) => string): FakturowniaApiError {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } } | null
  const code = e?.cause?.code ?? e?.code ?? ""
  const timeout = e?.name === "TimeoutError" || e?.name === "AbortError" || /timeout/i.test(e?.message ?? "")
  const notSent = NOT_SENT_CODES.has(code)
  const detail = mask(`${e?.name ?? "Error"}: ${e?.message ?? String(err)}${code ? ` (${code})` : ""}`).slice(0, 300)
  return new FakturowniaApiError({
    code: timeout && !notSent ? "ERROR_TIMEOUT" : "ERROR_NETWORK",
    operation,
    message: detail,
    transient: true,
    refused: notSent,
  })
}

function compact(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max)
}

/**
 * The readable part of an error answer: `message` as text, `message` as an
 * object of field errors (`{"buyer_tax_no": ["- nie może być puste"]}`, the
 * documented 422 shape), `error`, or the raw text.
 */
export function errorText(body: unknown, raw: string): string {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>
    const m = b.message ?? b.error ?? b.errors
    if (typeof m === "string" && m.trim()) return compact(m, 500)
    if (m && typeof m === "object") {
      const parts = Object.entries(m as Record<string, unknown>).map(([field, value]) => {
        const list = Array.isArray(value) ? value.map((x) => String(x)).join(", ") : String(value)
        return `${field}: ${list.replace(/^-\s*/, "")}`
      })
      if (parts.length > 0) return compact(parts.join("; "), 500)
    }
  }
  return compact(raw, 300)
}

/**
 * One answer into data or an error. Pure: the client calls it with the HTTP
 * status and the raw text, tests call it with fixtures. The body is read as
 * text first: a 502 from a gateway brings HTML, and parsing it as JSON would
 * throw a SyntaxError that says nothing about the outage.
 */
export function interpretResponse(args: { operation: string; httpStatus: number; text: string; mask: (text: string) => string }): unknown {
  const { operation, httpStatus, text, mask } = args
  let json: unknown = undefined
  try {
    json = text.trim() ? JSON.parse(text) : null
  } catch {
    json = undefined
  }

  if (httpStatus >= 300 && httpStatus < 400) {
    /* Redirects are not followed: an API call that redirects went to a login or error page. */
    throw new FakturowniaApiError({ code: `HTTP_${httpStatus}`, operation, message: "redirected instead of answering", transient: false, refused: true, status: httpStatus })
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new FakturowniaApiError({
      code: `HTTP_${httpStatus}`,
      operation,
      message: mask(errorText(json, text)),
      transient: httpStatus >= 500 || httpStatus === 429 || httpStatus === 408,
      /* A 4xx answer is a refusal: nothing was created or changed. A 5xx may hide work already done. */
      refused: httpStatus < 500,
      status: httpStatus,
    })
  }
  if (json === undefined) {
    throw new FakturowniaApiError({ code: "ERROR_JSON", operation, message: mask(`not JSON: ${compact(text, 120)}`), transient: true, status: httpStatus })
  }
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const b = json as Record<string, unknown>
    if (b.status === "error" || b.code === "error") {
      throw new FakturowniaApiError({ code: "API_ERROR", operation, message: mask(errorText(json, text)), transient: false, refused: true, status: httpStatus })
    }
  }
  return json
}

export function isTransient(err: unknown): boolean {
  return err instanceof FakturowniaApiError && err.transient
}

export function isRefused(err: unknown): boolean {
  return err instanceof FakturowniaApiError && err.refused
}

/** Short, safe description of any error for the outbox, the runs and the admin. */
export function describeError(err: unknown): { code: string; message: string; retryable: boolean } {
  if (err instanceof FakturowniaUnknownResultError) return { code: "unknown_result", message: err.message, retryable: true }
  if (err instanceof DocumentConflictError) return { code: "conflict", message: err.message, retryable: false }
  if (err instanceof PayloadError) return { code: err.code, message: err.message, retryable: false }
  if (err instanceof FakturowniaApiError) return { code: err.code, message: err.message, retryable: err.transient }
  const e = err as { code?: unknown; message?: unknown; retryable?: unknown } | null
  const message = typeof e?.message === "string" ? e.message : String(err)
  return {
    code: typeof e?.code === "string" && e.code ? e.code : "internal",
    message: message.length > 1000 ? `${message.slice(0, 1000)}...` : message,
    retryable: typeof e?.retryable === "boolean" ? e.retryable : true,
  }
}
