/**
 * THE ONLY HTTP CLIENT FOR FAKTUROWNIA. The account host is built in one
 * place (`accountUrl` below), and that is a rule to check with grep at review
 * time: every call goes through `request()`.
 *
 * AUTHENTICATION: `Authorization: Bearer <token>` on every request. The
 * documented examples also show `?api_token=` in URLs; this client never puts
 * the token in a URL or a body, so no request line, proxy log or error text
 * can carry it (verified: docs/fakturownia-api-notes.md). Redirects are not
 * followed, so the header never travels to another host either.
 *
 * ERROR POLICY
 *   reads (get, list, pdf, departments, categories)
 *                     network, timeout, 5xx and 429: up to 3 attempts,
 *                     pauses of 1 s and 4 s; refusals thrown at once
 *   update paid, change_status
 *                     idempotent (setting the same value twice is harmless):
 *                     retried like reads
 *   create            ONE shot. A refusal (4xx, or a network error before the
 *                     request left) goes up as is: nothing was created. Any
 *                     other failure becomes `FakturowniaUnknownResultError`,
 *                     answered by a lookup, never by a blind retry
 *   send_by_email     one shot (a second call would send a second e-mail)
 *
 * The create call is public but meant for `exactly-once.ts`, which looks the
 * document up before and after it.
 */

import type { Logger } from "@medusajs/framework/types"
import { FAKTUROWNIA_DOMAIN, LOOKUP_MAX_PAGES, LOOKUP_PAGE_SIZE } from "./constants"
import { FakturowniaApiError, FakturowniaUnknownResultError, interpretResponse, isRefused, isTransient, networkError } from "./errors"
import { isValidAccount } from "./options"
import { maskSecrets } from "./security"

const USER_AGENT = "KodaPlus-Medusa-Fakturownia/0.1 (+https://koda.plus)"

export type RemoteRecord = Record<string, unknown>

/** `https://<account>.fakturownia.pl`, only for a valid subdomain. */
export function accountBaseUrl(account: string): string {
  if (!isValidAccount(account)) {
    throw new FakturowniaApiError({ code: "BAD_ACCOUNT", operation: "config", message: "account is not a valid Fakturownia subdomain.", transient: false, refused: true })
  }
  return `https://${account}.${FAKTUROWNIA_DOMAIN}`
}

/** Fakturownia ids are numbers. Anything else never reaches a URL path. */
export function assertDocumentId(id: string | number): string {
  const s = String(id ?? "").trim()
  if (!/^\d{1,15}$/.test(s)) {
    throw new FakturowniaApiError({ code: "BAD_ID", operation: "config", message: `"${s.slice(0, 30)}" is not a Fakturownia document id.`, transient: false, refused: true })
  }
  return s
}

/* ------------------------------------------------------------------ */
/* Rate limiter: one per process, shared by every client instance      */
/* ------------------------------------------------------------------ */

const WINDOW_MS = 60_000
const SPACING_MS = 50
const LIMITER_KEY = Symbol.for("koda.fakturownia.limiter")

export interface Limiter {
  pass(): Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildLimiter(perMinute: number): Limiter {
  const stamps: number[] = []
  let last = 0
  let chain: Promise<void> = Promise.resolve()
  async function take(): Promise<void> {
    for (;;) {
      const now = Date.now()
      while (stamps.length > 0 && now - stamps[0] >= WINDOW_MS) stamps.shift()
      if (stamps.length >= perMinute) {
        await sleep(WINDOW_MS - (now - stamps[0]) + 10)
        continue
      }
      const sinceLast = now - last
      if (last > 0 && sinceLast < SPACING_MS) {
        await sleep(SPACING_MS - sinceLast)
        continue
      }
      last = Date.now()
      stamps.push(last)
      return
    }
  }
  return {
    pass(): Promise<void> {
      const next = chain.then(take)
      /* One failed pass must not break the chain for the next ones. */
      chain = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
  }
}

/** The token's limit is shared by the outbox, the status read and the admin: one limiter per process. */
export function globalLimiter(perMinute: number): Limiter {
  const holder = globalThis as typeof globalThis & { [LIMITER_KEY]?: Limiter }
  if (!holder[LIMITER_KEY]) holder[LIMITER_KEY] = buildLimiter(Math.max(1, Math.floor(perMinute)))
  return holder[LIMITER_KEY] as Limiter
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export interface FakturowniaClientOptions {
  token: string
  account: string
  requestsPerMinute: number
  timeoutMs: number
  logger?: Pick<Logger, "warn">
  /** Tests inject these; production uses the global ones. */
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** `null` turns the limiter off (tests). Default: the process-wide limiter. */
  limiter?: Limiter | null
  maxAttempts?: number
}

type RetryPolicy = "read" | "idempotent" | "once"

interface RequestSpec {
  operation: string
  method: "GET" | "POST" | "PUT"
  path: string
  query?: Record<string, string | number | null | undefined>
  body?: unknown
  retry: RetryPolicy
  binary?: boolean
}

export interface PdfFile {
  bytes: Uint8Array
  contentType: string
}

/** Filters of the documented invoice list (`GET /invoices.json`). */
export interface InvoiceFilter {
  /** Order number: `?oid=` ("Pobranie faktury po Id zamówienia"). */
  oid?: string
  kind?: string
  /** Documents generated from this one: `?from_invoice_id=`. */
  fromInvoiceId?: string
  /** Issue date window, `YYYY-MM-DD` (`period=more` with `date_from` and `date_to`). */
  dateFrom?: string
  dateTo?: string
}

export class FakturowniaClient {
  private readonly o: FakturowniaClientOptions
  private readonly limiter: Limiter | null
  private readonly doFetch: typeof fetch
  private readonly pause: (ms: number) => Promise<void>

  constructor(options: FakturowniaClientOptions) {
    this.o = options
    this.limiter = options.limiter === undefined ? globalLimiter(options.requestsPerMinute) : options.limiter
    this.doFetch = options.fetch ?? fetch
    this.pause = options.sleep ?? sleep
  }

  /** Masks the token and every token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, [this.o.token])
  }

  /* ---- Core: the only place anything leaves for the network -------- */

  private url(path: string, query?: RequestSpec["query"]): string {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") params.set(k, String(v))
    const qs = params.toString()
    return `${accountBaseUrl(this.o.account)}${path}${qs ? `?${qs}` : ""}`
  }

  private async request(spec: RequestSpec): Promise<unknown> {
    if (!this.o.token.trim()) {
      throw new FakturowniaApiError({ code: "NO_TOKEN", operation: spec.operation, message: "apiToken is not set in the plugin options.", transient: false, refused: true })
    }
    const attempts = spec.retry === "once" ? 1 : Math.max(1, this.o.maxAttempts ?? 3)
    let last: unknown = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (this.limiter) await this.limiter.pass()
      try {
        return await this.once(spec)
      } catch (err) {
        last = err
        if (spec.retry === "once") {
          /* The create after anything but a refusal: we do not know, and we say so. */
          if (spec.operation === "create" && isTransient(err) && !isRefused(err)) throw new FakturowniaUnknownResultError("create", err)
          throw err
        }
        if (!isTransient(err) || attempt === attempts) throw err
        const wait = attempt * attempt * 1000
        this.o.logger?.warn(`[fakturownia] ${spec.operation}: attempt ${attempt} failed, retrying in ${wait} ms (${this.mask((err as Error)?.message ?? String(err))})`)
        await this.pause(wait)
      }
    }
    throw last instanceof Error ? last : new FakturowniaApiError({ code: "ERROR", operation: spec.operation, message: "no answer", transient: true })
  }

  /** One HTTP call, no retries. */
  private async once(spec: RequestSpec): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.o.token}`,
      Accept: spec.binary ? "application/pdf" : "application/json",
      "User-Agent": USER_AGENT,
    }
    let body: string | undefined
    if (spec.body !== undefined) {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(spec.body)
    }
    const url = this.url(spec.path, spec.query)
    let res: Response
    try {
      res = await this.doFetch(url, {
        method: spec.method,
        headers,
        body,
        /* Never follow: the Authorization header must not travel to another host. */
        redirect: "manual",
        /* Without a timeout a hanging answer would hold the outbox forever. */
        signal: AbortSignal.timeout(this.o.timeoutMs),
      })
    } catch (err) {
      throw networkError(spec.operation, err, (t) => this.mask(t))
    }

    if (spec.binary && res.status === 200) {
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await res.arrayBuffer())
      } catch (err) {
        throw networkError(spec.operation, err, (t) => this.mask(t))
      }
      if (!isPdf(bytes)) {
        /* A KSeF account shows an HTML page instead of the PDF until the KSeF number arrives. */
        throw new FakturowniaApiError({ code: "PDF_NOT_READY", operation: spec.operation, message: "Fakturownia answered with something else than a PDF.", transient: true, refused: true, status: 200 })
      }
      const file: PdfFile = { bytes, contentType: "application/pdf" }
      return file
    }

    let text: string
    try {
      text = await res.text()
    } catch {
      /* The status arrived, the body did not: for a create, the document may exist. */
      throw new FakturowniaApiError({ code: "ERROR_NETWORK", operation: spec.operation, message: "the answer was cut off", transient: true, refused: false, status: res.status })
    }
    if (spec.binary && (res.status === 422 || (res.status >= 300 && res.status < 400))) {
      throw new FakturowniaApiError({
        code: "PDF_NOT_READY",
        operation: spec.operation,
        message: "the PDF is not ready yet (a new document, or a KSeF number still on its way).",
        transient: true,
        refused: true,
        status: res.status,
      })
    }
    return interpretResponse({ operation: spec.operation, httpStatus: res.status, text, mask: (t) => this.mask(t) })
  }

  /* ---- Reads --------------------------------------------------------- */

  /** `GET /invoices/{id}.json`, optionally limited with `fields[invoice]=`. */
  async getInvoice(id: string | number, fields?: readonly string[]): Promise<RemoteRecord> {
    const data = await this.request({
      operation: "get",
      method: "GET",
      path: `/invoices/${assertDocumentId(id)}.json`,
      query: fields && fields.length > 0 ? { "fields[invoice]": fields.join(",") } : undefined,
      retry: "read",
    })
    return asRecord(data, "get")
  }

  /** One page of `GET /invoices.json`. */
  async listInvoices(query: Record<string, string | number | undefined>): Promise<RemoteRecord[]> {
    const data = await this.request({ operation: "list", method: "GET", path: "/invoices.json", query, retry: "read" })
    return asList(data, "list")
  }

  /**
   * Every document matching the filter, page after page. Hitting the page
   * ceiling THROWS: a silent "not found" there would mean "issue it", which
   * is the duplicate this lookup exists to prevent.
   */
  async findInvoices(filter: InvoiceFilter, maxPages: number = LOOKUP_MAX_PAGES): Promise<RemoteRecord[]> {
    const out: RemoteRecord[] = []
    for (let page = 1; page <= maxPages; page += 1) {
      const rows = await this.listInvoices({
        oid: filter.oid,
        kind: filter.kind,
        from_invoice_id: filter.fromInvoiceId,
        period: filter.dateFrom ? "more" : "all",
        date_from: filter.dateFrom,
        date_to: filter.dateTo,
        per_page: LOOKUP_PAGE_SIZE,
        page,
      })
      out.push(...rows)
      if (rows.length < LOOKUP_PAGE_SIZE) return out
    }
    throw new FakturowniaApiError({
      code: "LOOKUP_CEILING",
      operation: "list",
      message:
        `${maxPages} pages of documents did not settle whether this document already exists in Fakturownia. ` +
        "Nothing was sent. Look for it in Fakturownia before issuing it again.",
      transient: false,
      refused: true,
    })
  }

  /** `GET /invoices/{id}.pdf`, as bytes checked to be a PDF. */
  async downloadPdf(id: string | number): Promise<PdfFile> {
    const data = await this.request({ operation: "pdf", method: "GET", path: `/invoices/${assertDocumentId(id)}.pdf`, retry: "read", binary: true })
    return data as PdfFile
  }

  /** `GET /departments.json`: the companies of the account. Harmless, used by "Check connection". */
  async listDepartments(): Promise<RemoteRecord[]> {
    return asList(await this.request({ operation: "departments", method: "GET", path: "/departments.json", retry: "read" }), "departments")
  }

  /** `GET /categories.json`. */
  async listCategories(): Promise<RemoteRecord[]> {
    return asList(await this.request({ operation: "categories", method: "GET", path: "/categories.json", retry: "read" }), "categories")
  }

  /* ---- Writes -------------------------------------------------------- */

  /**
   * `POST /invoices.json`, ONE shot. A success answer without a document id
   * may still have created the document, so it is an unknown result too.
   * Call it through `createOnce()` (exactly-once.ts).
   */
  async createInvoice(invoice: RemoteRecord): Promise<RemoteRecord> {
    const data = await this.request({ operation: "create", method: "POST", path: "/invoices.json", body: { invoice }, retry: "once" })
    const doc = data && typeof data === "object" && !Array.isArray(data) ? (data as RemoteRecord) : null
    const id = doc ? String(doc.id ?? "").trim() : ""
    if (!doc || !/^\d+$/.test(id)) {
      throw new FakturowniaUnknownResultError("create", new Error("a success answer without a document id"))
    }
    return doc
  }

  /**
   * `PUT /invoices/{id}.json` with `paid` only. Measured in production: `paid`
   * works on proformas too, while `status: "paid"` is refused there (HTTP 422).
   */
  async markPaid(id: string | number, amount: string): Promise<RemoteRecord> {
    const data = await this.request({
      operation: "update",
      method: "PUT",
      path: `/invoices/${assertDocumentId(id)}.json`,
      body: { invoice: { paid: amount } },
      retry: "idempotent",
    })
    return asRecord(data, "update")
  }

  /** `POST /invoices/{id}/change_status.json?status=...` (documented form, token in the header). */
  async changeStatus(id: string | number, status: "issued" | "sent" | "paid" | "partial" | "rejected"): Promise<void> {
    await this.request({
      operation: "change_status",
      method: "POST",
      path: `/invoices/${assertDocumentId(id)}/change_status.json`,
      query: { status },
      retry: "idempotent",
    })
  }

  /**
   * `POST /invoices/{id}/send_by_email.json`: Fakturownia e-mails the document
   * to its `buyer_email`. On a KSeF account a company document waits for its
   * KSeF number; the refusal comes as HTTP 200 with `status: "error"`.
   */
  async sendByEmail(id: string | number): Promise<void> {
    await this.request({ operation: "send_by_email", method: "POST", path: `/invoices/${assertDocumentId(id)}/send_by_email.json`, retry: "once" })
  }
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

function asRecord(data: unknown, operation: string): RemoteRecord {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as RemoteRecord
  throw new FakturowniaApiError({ code: "BAD_ANSWER", operation, message: "the answer is not an object", transient: true, refused: true })
}

function asList(data: unknown, operation: string): RemoteRecord[] {
  if (Array.isArray(data)) return data.filter((x): x is RemoteRecord => Boolean(x) && typeof x === "object")
  throw new FakturowniaApiError({ code: "BAD_ANSWER", operation, message: "the answer is not a list", transient: true, refused: true })
}
