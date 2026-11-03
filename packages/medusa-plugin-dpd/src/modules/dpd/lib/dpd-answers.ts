import type { ProblemDto } from "./contract"
import type { DpdHttpAnswer, GeneratePackagesNumbersRequest } from "./dpdservices"

/**
 * WHAT A DPDSERVICES ANSWER MEANS. Pure functions over the raw answer (HTTP
 * status, parsed body), the same for the real client, the fake and the
 * fixtures of the sandbox (docs/sandbox/fakty-sandbox.md):
 *
 *   ok         DPD did it (waybills, or a PDF label)
 *   exists     generatePackagesNumbers: the reference is taken under this
 *              login, so the shipment already exists; it is adopted by a
 *              label call on the package reference, never created twice
 *   not_found  generateSpedLabels: DPD has nothing under the search
 *   refused    DPD clearly did not do it; nothing was created, the
 *              reference stays free (a person fixes and tries again)
 *   unclear    anything that cannot be proven a refusal: the shipment may
 *              exist, so it is looked up before anything is sent again
 *
 * The body is read first, then the HTTP status: a 400 can carry a business
 * answer (INCORRECT_DATA, a duplicate, even waybills) or a Bean Validation
 * answer (errors[]), a 401 has an empty body, a 404 with status NOT_FOUND is
 * a clear "nothing there" and a 404 without it is not.
 *
 * Messages and problem details never carry the values DPD echoes back
 * (validationInfo[].info puts the rejected value in brackets, like
 * "Incorrect receiver postal code: (30-001)"): they are stripped, because the
 * receiver's data is never kept at rest.
 *
 * A DPD Pickup refusal gets the codes of the plan (pudo_not_found,
 * multi_box_not_allowed and the rest of PICKUP_ANSWER_CODES) with source
 * "dpd", so a failed row keeps it next to the plan problems (spec 8.1). The
 * receiver codes DPD adds after a point code (it reads the receiver address
 * from the point) and its "Name or company is required" next to a missing
 * contact are dropped: they say nothing the point code does not.
 */

export const DPD_ERROR_CODES = [
  /* unclear */
  "timeout", "network", "server_error", "bad_answer", "unknown_status", "dpd_unknown_error",
  "not_processed", "no_waybill", "partial", "not_pdf", "http_404",
  /* refused */
  "auth", "payer_fid", "forbidden", "disabled_api", "incorrect_data", "validation",
  "rate_limited", "unsupported", "bad_request", "not_configured", "alternative_number",
] as const
export type DpdErrorCode = (typeof DPD_ERROR_CODES)[number]

/** Problem codes built from a DPD answer (prefix dpd_, kept on a failed row next to the plan problems). */
export const DPD_PROBLEM_CODES = ["dpd_validation", "dpd_cod_currency", "dpd_auth", "dpd_payer_fid", "dpd_disabled_api"] as const
export type DpdProblemCode = (typeof DPD_PROBLEM_CODES)[number]

/** The problems an answer gives for a Pickup package, with the plan's codes. */
export const PICKUP_ANSWER_CODES = [
  "pudo_not_found", "pudo_inactive", "pudo_no_delivery", "pudo_no_cod",
  "multi_box_not_allowed", "pickup_over_limit", "contact_missing",
] as const
export type PickupAnswerCode = (typeof PICKUP_ANSWER_CODES)[number]

/** DPD codes that only follow a point code (fixtures 10c, 10d, 10h, 10i). */
export const SECONDARY_RECEIVER_CODES: readonly string[] = ["INCORRECT_RECEIVER_ADDRESS", "INCORRECT_RECEIVER_CITY", "INCORRECT_RECEIVER_POSTAL_CODE"]

/**
 * The validationInfo codes of a Pickup point (the DPDServices enum; only
 * INCORRECT_PUDO was seen, 10c). SERVICES_NOT_SUPPORTED_BY_PUDO: the only
 * other service sent with DPD_PICKUP is COD.
 */
const POINT_CODES: Readonly<Record<string, PickupAnswerCode>> = {
  INCORRECT_PUDO: "pudo_not_found",
  INACTIVE_PUDO: "pudo_inactive",
  DPD_PICKUP_IS_NOT_AVAILABLE_FOR_PUDO: "pudo_no_delivery",
  SERVICES_NOT_SUPPORTED_BY_PUDO: "pudo_no_cod",
}

export type DpdRefused = {
  kind: "refused"
  code: DpdErrorCode
  /** One masked sentence, at most 1000 characters, for `dpd_shipment.error`. */
  message: string
  problems: ProblemDto[]
  traceId: string | null
  httpStatus: number
}

export type DpdUnclear = {
  kind: "unclear"
  code: DpdErrorCode
  message: string
  traceId: string | null
  httpStatus: number
}

export type NumbersOutcome =
  | {
      kind: "ok"
      sessionId: string | null
      /** In box order: matched by parcel reference, else in DPD's order. */
      parcels: Array<{ reference: string | null; waybill: string }>
      traceId: string | null
      httpStatus: number
    }
  | { kind: "exists"; status: "DUPLICATED_PACKAGE_REFERENCE" | "DUPLICATED_PARCEL_REFERENCE"; traceId: string | null; httpStatus: number }
  | DpdRefused
  | DpdUnclear

export type LabelsOutcome =
  | {
      kind: "ok"
      /** base64 of a PDF, never logged or masked. */
      pdfBase64: string
      /** Every waybill of session.packages[].parcels[], in DPD's order. */
      waybills: string[]
      /** Always null for labels on the demo host; kept when DPD sends one. */
      documentId: string | null
      traceId: string | null
      httpStatus: number
    }
  | { kind: "not_found"; traceId: string | null; httpStatus: number }
  | DpdRefused
  | DpdUnclear

const MESSAGE_MAX = 1000

type Obj = Record<string, unknown>

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** An id DPD gives as a number or a string (sessionId is a number, E3), as a string; null for anything else. */
function idOf(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v === "string" && v.trim() !== "") return v.trim()
  return null
}

function cut(s: string, max = MESSAGE_MAX): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

/**
 * A DPD text without the values it echoes back: "(30-001)" and any other
 * bracket is dropped, so the receiver's data never reaches a message, a
 * problem or the history (E9).
 */
export function cleanDpdText(v: unknown): string {
  return text(v)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[\s:;,]+$/, "")
    .trim()
}

/** "packages[0].receiver.name" as "receiver.name"; "packages[0]" alone as "package". */
function beanField(v: unknown): string {
  const raw = text(v)
  const field = raw.replace(/^packages\[\d+\]\.?/, "")
  return field || (raw ? "package" : "")
}

const COD_CURRENCY_MESSAGE = /COD requires \w+ currency/i

function dedupe(problems: ProblemDto[]): ProblemDto[] {
  const seen = new Set<string>()
  const out: ProblemDto[] = []
  for (const p of problems) {
    const key = `${p.code}\u0000${p.field ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function validationInfos(holder: Obj | null): Array<{ errorCode: string; info: string }> {
  return list(holder?.validationInfo)
    .map((v) => obj(v))
    .filter((v): v is Obj => v !== null)
    .map((v) => ({ errorCode: text(v.errorCode), info: cleanDpdText(v.info) }))
    .filter((v) => v.errorCode !== "" || v.info !== "")
}

/**
 * validationInfo[] of every package and of each parcel, as dpd_validation
 * problems (field = errorCode, detail = info). A point code gives its Pickup
 * problem with source "dpd", and the receiver codes of the same package are
 * dropped (SECONDARY_RECEIVER_CODES, spec 8.1).
 */
export function problemsOfGpn(body: unknown): ProblemDto[] {
  const out: ProblemDto[] = []
  for (const p of list(obj(body)?.packages)) {
    const pkg = obj(p)
    const infos = [...validationInfos(pkg), ...list(pkg?.parcels).flatMap((x) => validationInfos(obj(x)))]
    const pointAnswer = infos.some((i) => POINT_CODES[i.errorCode] !== undefined)
    for (const { errorCode, info } of infos) {
      if (pointAnswer && SECONDARY_RECEIVER_CODES.includes(errorCode)) continue
      const pickup = POINT_CODES[errorCode]
      if (pickup !== undefined) {
        out.push({ code: pickup, field: errorCode, ...(info ? { detail: info } : {}), source: "dpd" })
        continue
      }
      const problem: ProblemDto = { code: errorCode.startsWith("COD_CURRENCY") ? "dpd_cod_currency" : "dpd_validation" }
      if (errorCode) problem.field = errorCode
      if (info) problem.detail = info
      out.push(problem)
      if (errorCode === "INCORRECT_PAYER_FID") out.push({ code: "dpd_payer_fid" })
    }
  }
  return dedupe(out)
}

const SINGLE_PARCEL_MESSAGE = /single parcel/i
const PICKUP_WEIGHT_MESSAGE = /DPD_PICKUP.*\bfrom \d+\s*kg|parcels from \d+\s*kg/i
const CONTACT_MESSAGE = /phone or email is needed/i
const NAME_OR_COMPANY_MESSAGE = /name or company is required/i

/**
 * errors[] of a Bean Validation answer: field without the "packages[0]."
 * prefix, detail = userMessage; a COD currency message becomes
 * dpd_cod_currency. The three Pickup refusals DPD gives on services[0] are
 * known by their text (10b, 10g, 10f) and get the plan's codes with source
 * "dpd"; "Name or company is required" on pudoReceiver next to the contact
 * message is dropped (10f: the name was sent).
 */
export function problemsOfBean(body: unknown): ProblemDto[] {
  const out: ProblemDto[] = []
  const errors = list(obj(body)?.errors).map((e) => obj(e)).filter((e): e is Obj => e !== null)
  const contactAnswer = errors.some((e) => CONTACT_MESSAGE.test(text(e.userMessage)))
  for (const err of errors) {
    const raw = text(err.userMessage)
    const message = cleanDpdText(err.userMessage)
    const field = beanField(err.field)
    if (contactAnswer && field === "pudoReceiver" && NAME_OR_COMPANY_MESSAGE.test(raw)) continue
    let problem: ProblemDto
    if (COD_CURRENCY_MESSAGE.test(raw)) problem = { code: "dpd_cod_currency" }
    else if (SINGLE_PARCEL_MESSAGE.test(raw)) problem = { code: "multi_box_not_allowed", source: "dpd" }
    else if (PICKUP_WEIGHT_MESSAGE.test(raw)) problem = { code: "pickup_over_limit", source: "dpd" }
    else if (CONTACT_MESSAGE.test(raw)) problem = { code: "contact_missing", source: "dpd" }
    else problem = { code: "dpd_validation" }
    if (field) problem.field = field
    const kg = problem.code === "pickup_over_limit" ? /from (\d+(?:[.,]\d+)?)\s*kg/i.exec(raw) : null
    if (kg) problem.detail = `${kg[1]} kg`
    else if (message) problem.detail = message
    out.push(problem)
  }
  return dedupe(out)
}

/** base64 whose first decoded bytes are "%PDF". */
export function isPdfBase64(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 8) return false
  const s = value.replace(/[\r\n]/g, "")
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false
  return Buffer.from(s.slice(0, 8), "base64").toString("latin1").startsWith("%PDF")
}

/** A fetch that threw: abort is "timeout", anything else "network". */
export function transportFailure(aborted: boolean, detail: string, timeoutMs: number): DpdUnclear {
  return aborted
    ? { kind: "unclear", code: "timeout", message: `DPD did not answer within ${timeoutMs} ms; the shipment may exist and is looked up before anything is sent again.`, traceId: null, httpStatus: 0 }
    : { kind: "unclear", code: "network", message: cut(`DPD could not be reached: ${text(detail) || "network error"}.`), traceId: null, httpStatus: 0 }
}

function refused(code: DpdErrorCode, message: string, answer: DpdHttpAnswer, problems: ProblemDto[] = []): DpdRefused {
  return { kind: "refused", code, message: cut(message), problems, traceId: answer.traceId, httpStatus: answer.httpStatus }
}

function unclear(code: DpdErrorCode, message: string, answer: DpdHttpAnswer): DpdUnclear {
  return { kind: "unclear", code, message: cut(message), traceId: answer.traceId, httpStatus: answer.httpStatus }
}

/** "<errorCode>: <info>; ..." of the validation infos, or "<field>: <userMessage>; ..." of the Bean errors. */
function describeProblems(problems: ProblemDto[]): string {
  return problems
    .filter((p) => p.field || p.detail)
    .map((p) => [p.field, p.detail].filter(Boolean).join(": "))
    .join("; ")
}

function refusedSentence(what: string, status: string, problems: ProblemDto[]): string {
  const details = describeProblems(problems)
  return `DPD refused the ${what} (${status})${details ? `: ${details}` : ""}.`
}

/** The answer by its HTTP status alone, once the body said nothing the classifier knows. */
function byHttp(answer: DpdHttpAnswer, what: string): DpdRefused | DpdUnclear {
  const s = answer.httpStatus
  if (s === 403) return refused("forbidden", `DPD refused access to the ${what} (HTTP 403).`, answer)
  if (s === 404) return unclear("http_404", `DPD answered HTTP 404 without saying what is missing.`, answer)
  if (s === 415) return refused("unsupported", `DPD refused the request format (HTTP 415).`, answer)
  if (s === 429) return refused("rate_limited", `DPD asked to slow down (HTTP 429); nothing was created.`, answer)
  if (s >= 400 && s < 500) return refused("bad_request", `DPD refused the request (HTTP ${s}).`, answer)
  if (s >= 500) return unclear("server_error", `DPD answered with a server error (HTTP ${s}); the result is not known.`, answer)
  return unclear("bad_answer", `DPD answered HTTP ${s} with something the plugin cannot read.`, answer)
}

function authRefused(answer: DpdHttpAnswer): DpdRefused {
  return refused("auth", "DPD refused the login (HTTP 401): wrong login or password, or no FID in the header.", answer, [{ code: "dpd_auth" }])
}

/** An errors[] body is a refused validation only with HTTP 400 to 499; under a 5xx it says nothing sure about what DPD stored (byHttp). */
function isClientError(answer: DpdHttpAnswer): boolean {
  return answer.httpStatus >= 400 && answer.httpStatus < 500
}

function beanRefused(answer: DpdHttpAnswer, body: Obj, what: string): DpdRefused {
  const problems = problemsOfBean(body)
  return refused("validation", refusedSentence(what, `HTTP ${answer.httpStatus}`, problems), answer, problems)
}

/** The point id of the DPD_PICKUP service that was sent (attribute PUDO), or null for a courier package. */
function sentPudoId(sent: GeneratePackagesNumbersRequest): string | null {
  for (const pkg of Array.isArray(sent?.packages) ? sent.packages : []) {
    for (const service of Array.isArray(pkg?.services) ? pkg.services : []) {
      if (service?.code !== "DPD_PICKUP" || !Array.isArray(service.attributes)) continue
      const value = text(service.attributes.find((a) => a?.code === "PUDO")?.value)
      if (value) return value
    }
  }
  return null
}

/** E5: a point problem DPD gave names the point that was sent, not DPD's sentence ("Incorrect pudo identifier"). */
function withSentPoint(problems: ProblemDto[], sent: GeneratePackagesNumbersRequest): ProblemDto[] {
  const id = sentPudoId(sent)
  if (id === null) return problems
  return problems.map((p) => (p.source === "dpd" && p.code.startsWith("pudo_") ? { ...p, detail: id } : p))
}

/** The references of the parcels that were sent, in box order. */
function sentParcelReferences(sent: GeneratePackagesNumbersRequest): string[] {
  const packages = list((sent as unknown as Obj | null)?.packages)
  return packages.flatMap((p) => list(obj(p)?.parcels).map((x) => text(obj(x)?.reference)))
}

export function classifyNumbersAnswer(answer: DpdHttpAnswer, sent: GeneratePackagesNumbersRequest): NumbersOutcome {
  if (answer.httpStatus === 401) return authRefused(answer)
  const body = obj(answer.body)
  if (body && typeof body.status === "string") {
    const status = body.status
    const packages = list(body.packages).map((p) => obj(p))
    const parcels = packages.flatMap((p) => list(p?.parcels).map((x) => obj(x)))
    const waybills = parcels.map((p) => text(p?.waybill)).filter(Boolean)
    if (status === "OK") {
      const allOk = packages.length > 0 && packages.every((p) => p !== null && p.status === "OK")
      if (!allOk || parcels.length === 0 || waybills.length !== parcels.length) {
        return unclear("no_waybill", "DPD answered OK without a waybill for every box; the shipment is looked up before anything is sent again.", answer)
      }
      const got = parcels.map((p) => ({ reference: text(p?.reference) || null, waybill: text(p?.waybill) }))
      const refs = sentParcelReferences(sent)
      if (refs.length > 0 && refs.length !== got.length) {
        return unclear("no_waybill", `DPD answered OK with ${got.length} waybills for ${refs.length} boxes; the shipment is looked up before anything is sent again.`, answer)
      }
      /* Box order: every sent reference found exactly once in the answer, else DPD's order. */
      const byRef = refs.map((r) => got.filter((g) => g.reference === r))
      const ordered = refs.length > 0 && byRef.every((m) => m.length === 1) ? byRef.map((m) => m[0]) : got
      return { kind: "ok", sessionId: idOf(body.sessionId), parcels: ordered, traceId: answer.traceId, httpStatus: answer.httpStatus }
    }
    if (status === "DUPLICATED_PACKAGE_REFERENCE" || status === "DUPLICATED_PARCEL_REFERENCE") {
      return { kind: "exists", status, traceId: answer.traceId, httpStatus: answer.httpStatus }
    }
    if (waybills.length > 0) {
      return unclear("partial", `DPD refused the request (${status}) but gave ${waybills.length} waybills; the shipment is looked up before anything is sent again.`, answer)
    }
    const problems = withSentPoint(problemsOfGpn(body), sent)
    switch (status) {
      case "INCORRECT_DATA":
        return refused("incorrect_data", refusedSentence("shipment", status, problems), answer, problems)
      case "DISALLOWED_FID":
      case "ERROR_NO_FID_PERMISSION":
        return refused("payer_fid", `DPD refused the payer FID (${status}): payerFid does not belong to this account.`, answer, dedupe([{ code: "dpd_payer_fid" }, ...problems]))
      case "DISABLED_API":
        return refused("disabled_api", "DPD turned this service off for the account (DISABLED_API).", answer, dedupe([{ code: "dpd_disabled_api" }, ...problems]))
      case "DUPLICATED_ALTERNATIVE_PARCEL_NUMBER":
        return refused("alternative_number", refusedSentence("shipment", status, problems), answer, problems)
      case "NOT_PROCESSED":
        return unclear("not_processed", "DPD did not process the request (NOT_PROCESSED); the result is not known.", answer)
      case "UNKNOWN_ERROR":
        return unclear("dpd_unknown_error", "DPD reported an unknown error (UNKNOWN_ERROR); the result is not known.", answer)
      default:
        return unclear("unknown_status", `DPD answered with a status the plugin does not know (${cut(cleanDpdText(status), 60)}).`, answer)
    }
  }
  if (body && Array.isArray(body.errors) && isClientError(answer)) return beanRefused(answer, body, "shipment")
  return byHttp(answer, "shipment")
}

export function classifyLabelsAnswer(answer: DpdHttpAnswer): LabelsOutcome {
  if (answer.httpStatus === 401) return authRefused(answer)
  const body = obj(answer.body)
  if (body && typeof body.status === "string") {
    const status = body.status
    if (status === "NOT_FOUND") return { kind: "not_found", traceId: answer.traceId, httpStatus: answer.httpStatus }
    if (status === "OK") {
      if (!isPdfBase64(body.documentData)) return unclear("not_pdf", "DPD answered OK with a label that is not a PDF.", answer)
      const session = obj(body.session)
      const waybills = list(session?.packages).flatMap((p) => list(obj(p)?.parcels).map((x) => text(obj(x)?.waybill))).filter(Boolean)
      return { kind: "ok", pdfBase64: body.documentData, waybills, documentId: idOf(body.documentId), traceId: answer.traceId, httpStatus: answer.httpStatus }
    }
    switch (status) {
      case "DISABLED_API":
        return refused("disabled_api", "DPD turned this service off for the account (DISABLED_API).", answer, [{ code: "dpd_disabled_api" }])
      case "NOT_PROCESSED":
        return unclear("not_processed", "DPD did not process the label request (NOT_PROCESSED).", answer)
      case "UNKNOWN_ERROR":
        return unclear("dpd_unknown_error", "DPD reported an unknown error for the label (UNKNOWN_ERROR).", answer)
      default:
        return unclear("unknown_status", `DPD answered the label request with a status the plugin does not know (${cut(cleanDpdText(status), 60)}).`, answer)
    }
  }
  if (body && Array.isArray(body.errors) && isClientError(answer)) return beanRefused(answer, body, "label request")
  return byHttp(answer, "label")
}
