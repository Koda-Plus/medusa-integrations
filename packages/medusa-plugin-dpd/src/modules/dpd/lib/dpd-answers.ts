import type { CourierRangeDto, ProblemDto } from "./contract"
import type { DpdHttpAnswer, GeneratePackagesNumbersRequest, GenerateProtocolRequest } from "./dpdservices"
import { courierRangesOf } from "./courier"
import { clip } from "./text"

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
 *
 * Stage 4 adds the answers of generateProtocol, courierOrderAvailability and
 * packagesPickupCall (POST, PATCH, DELETE), with their own codes
 * (COURIER_ERROR_CODES) and outcomes. The courier choices that only the
 * OpenAPI shows [NZ] live in their classifiers and nowhere else (spec
 * section 8).
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

/** Codes of the protocol and courier answers, next to DPD_ERROR_CODES (kept apart: codes.test requires DPD_ERROR_CODES to be shipment codes). */
export const COURIER_ERROR_CODES = [
  /* refused */
  "protocol_not_found", "session_type", "pickup_fid", "pickup_address", "parcel_limit",
  "postal_code_not_found", "range_not_found", "postal_pattern", "country_not_found",
  "order_closed", "checksum", "pickup_time", "order_not_found", "order_number", "order_status",
  /* unclear */
  "service_unavailable", "no_order_number",
] as const
export type CourierErrorCode = (typeof COURIER_ERROR_CODES)[number]
export type DispatchAnswerCode = DpdErrorCode | CourierErrorCode

/** Problem codes built from a protocol or courier answer (source "dpd"). */
export const DISPATCH_PROBLEM_SOURCE_CODES = ["dpd_courier", "dpd_protocol_not_found"] as const
export type DispatchProblemSourceCode = (typeof DISPATCH_PROBLEM_SOURCE_CODES)[number]

export type DispatchRefused = {
  kind: "refused"
  code: DispatchAnswerCode
  /** One masked sentence, at most 1000 characters, for `dpd_dispatch.error`. */
  message: string
  /** dpd_courier (each errorDetails entry), dpd_protocol_not_found (detail: the reference). */
  problems: ProblemDto[]
  traceId: string | null
  httpStatus: number
}

export type DispatchUnclear = {
  kind: "unclear"
  code: DispatchAnswerCode
  message: string
  traceId: string | null
  httpStatus: number
}

export type ProtocolOutcome =
  | {
      kind: "ok"
      /** base64 of a PDF, never logged or masked. */
      pdfBase64: string
      documentId: string | null
      /** session.packages[].reference with status OK, in DPD's order. */
      references: string[]
      traceId: string | null
      httpStatus: number
    }
  | DispatchRefused
  | DispatchUnclear

export type AvailabilityOutcome =
  | { kind: "ok"; ranges: CourierRangeDto[]; traceId: string | null; httpStatus: number }
  | DispatchRefused
  | DispatchUnclear

/** POST packagesPickupCall: ok only with an orderNumber and a checkSum that is not empty and not "null" (H10). [NZ] */
export type PickupCallOutcome =
  | { kind: "ok"; orderNumber: string; checkSum: string; traceId: string | null; httpStatus: number }
  | DispatchRefused
  | DispatchUnclear

/** PATCH and DELETE: DPD may leave either value out (DS13); null keeps the stored one. [NZ] */
export type PickupCallChangeOutcome =
  | { kind: "ok"; orderNumber: string | null; checkSum: string | null; traceId: string | null; httpStatus: number }
  | DispatchRefused
  | DispatchUnclear

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
  return s.length > max ? `${clip(s, max - 3)}...` : s
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

/* ------------------------------------------------------------------ */
/* Stage 4: the protocol, the availability and the courier order       */
/* ------------------------------------------------------------------ */

function dispatchRefused(code: DispatchAnswerCode, message: string, answer: DpdHttpAnswer, problems: ProblemDto[] = []): DispatchRefused {
  return { kind: "refused", code, message: cut(message), problems, traceId: answer.traceId, httpStatus: answer.httpStatus }
}

function dispatchUnclear(code: DispatchAnswerCode, message: string, answer: DpdHttpAnswer): DispatchUnclear {
  return { kind: "unclear", code, message: cut(message), traceId: answer.traceId, httpStatus: answer.httpStatus }
}

/** A status DPD gave, cut and cleaned for a sentence. */
function statusWord(status: string): string {
  return cut(cleanDpdText(status), 60)
}

/**
 * HTTP 500 to 599 is unclear whatever the body says (8.1 point 2): a refusal
 * under a server error does not prove that nothing was stored. The status of
 * a readable body only goes into the sentence (12u, 12v).
 */
function serverError(answer: DpdHttpAnswer, what: string, status: string): DispatchUnclear {
  const said = status ? ` (${statusWord(status)})` : ""
  return dispatchUnclear("server_error", `DPD answered HTTP ${answer.httpStatus}${said}; the result of the ${what} is not known.`, answer)
}

/** A status body counts under HTTP 200 or 4xx only. */
function statusReadable(answer: DpdHttpAnswer): boolean {
  return answer.httpStatus === 200 || isClientError(answer)
}

/** session.packages[] not OK as dpd_protocol_not_found problems (detail: the reference). */
export function problemsOfProtocol(body: unknown): ProblemDto[] {
  const out: ProblemDto[] = []
  const seen = new Set<string>()
  for (const p of list(obj(obj(body)?.session)?.packages)) {
    const pkg = obj(p)
    if (text(obj(pkg?.statusInfo)?.status) !== "NOT_FOUND") continue
    const reference = text(pkg?.reference)
    const detail = reference || list(pkg?.parcels)
      .map((x) => obj(x))
      .filter((x) => text(obj(x?.statusInfo)?.status) === "NOT_FOUND")
      .map((x) => text(x?.waybill))
      .filter(Boolean)
      .join(", ")
    if (seen.has(detail)) continue
    seen.add(detail)
    out.push({ code: "dpd_protocol_not_found", field: "session.packages", ...(detail ? { detail } : {}) })
  }
  return out
}

function packageStatuses(session: Obj | null): string[] {
  return list(session?.packages).map((p) => text(obj(obj(p)?.statusInfo)?.status))
}

/** INCORRECT_DATA of a protocol: the session status decides first, then the packages (8.2). */
function protocolRefused(answer: DpdHttpAnswer, body: Obj, sentRefs: readonly string[]): DispatchRefused {
  const session = obj(body.session)
  const info = obj(session?.statusInfo)
  const sessionStatus = text(info?.status)
  const description = cleanDpdText(info?.description)
  const head = `DPD refused the protocol (INCORRECT_DATA, ${sessionStatus ? statusWord(sessionStatus) : "no session status"})`
  const withDescription = `${head}${description ? `: ${description}` : ""}.`
  const notFound = (): DispatchRefused => {
    /* No package listed at all (11p): DPD found none of the sent references, so each of them is missing. */
    const listed = problemsOfProtocol(body)
    const problems: ProblemDto[] = listed.length > 0 || list(session?.packages).length > 0
      ? listed
      : sentRefs.filter(Boolean).map((detail) => ({ code: "dpd_protocol_not_found", field: "session.packages", detail }))
    const missing = problems.map((p) => p.detail).filter(Boolean).join(", ")
    return dispatchRefused("protocol_not_found", `${head}${missing ? `: DPD does not know ${missing}` : ""}.`, answer, problems)
  }
  if (sessionStatus === "NOT_FOUND") return notFound()
  if (sessionStatus === "ACCESS_DENIED_FOR_FID" || sessionStatus === "INCORRECT_PICKUP_ADDRESS_FID") {
    return dispatchRefused("pickup_fid", withDescription, answer, [{ code: "dpd_payer_fid" }])
  }
  if (sessionStatus === "INCORRECT_SESSION_TYPE") return dispatchRefused("session_type", withDescription, answer)
  if (sessionStatus.startsWith("INCORRECT_PICKUP_ADDRESS")) return dispatchRefused("pickup_address", withDescription, answer)
  if (sessionStatus === "PARCEL_LIMIT_EXCEEDED") return dispatchRefused("parcel_limit", withDescription, answer)
  /* NOT_PROCESSED of a package is only the result of STOP_ON_FIRST_ERROR, never a problem. */
  const packages = packageStatuses(session)
  if (packages.includes("NOT_FOUND")) return notFound()
  if (packages.includes("PARCEL_LIMIT_EXCEEDED")) return dispatchRefused("parcel_limit", withDescription, answer)
  return dispatchRefused("incorrect_data", withDescription, answer)
}

/**
 * The only place the [NZ] courier choices live (section 8): StatusInfo
 * refusals count under HTTP 200 or 4xx only; under 5xx the answer is
 * unclear. `sent` checks that DPD printed exactly what was asked for.
 */
export function classifyProtocolAnswer(answer: DpdHttpAnswer, sent: GenerateProtocolRequest): ProtocolOutcome {
  if (answer.httpStatus === 401) return authRefused(answer)
  const body = obj(answer.body)
  if (answer.httpStatus >= 500) return serverError(answer, "protocol", typeof body?.status === "string" ? body.status : "")
  const sentRefs = list(sent?.protocolSearchParams?.session?.packages).map((p) => text(obj(p)?.reference))
  if (body && typeof body.status === "string" && statusReadable(answer)) {
    const status = body.status
    if (status === "OK") {
      if (!isPdfBase64(body.documentData)) return dispatchUnclear("not_pdf", "DPD answered OK with a protocol that is not a PDF.", answer)
      const packages = list(obj(body.session)?.packages).map((p) => obj(p))
      const notOk = packages.some((p) => text(obj(p?.statusInfo)?.status) !== "OK")
      const refs = packages.map((p) => text(p?.reference))
      const everyRef = refs.every(Boolean)
      const same = everyRef
        ? new Set(refs).size === new Set(sentRefs).size && refs.every((r) => sentRefs.includes(r))
        : packages.length === sentRefs.length
      if (notOk || !same) {
        return dispatchUnclear("partial", `DPD answered OK with ${packages.length} packages for ${sentRefs.length} sent, or not every package OK; the protocol is not stored.`, answer)
      }
      return { kind: "ok", pdfBase64: body.documentData, documentId: idOf(body.documentId), references: refs.filter(Boolean), traceId: answer.traceId, httpStatus: answer.httpStatus }
    }
    switch (status) {
      case "INCORRECT_DATA":
        return protocolRefused(answer, body, sentRefs)
      case "DISABLED_API":
        return dispatchRefused("disabled_api", "DPD turned this service off for the account (DISABLED_API).", answer, [{ code: "dpd_disabled_api" }])
      case "UNKNOWN_ERROR":
        return dispatchUnclear("dpd_unknown_error", "DPD reported an unknown error for the protocol (UNKNOWN_ERROR); nothing is printed again by itself.", answer)
      default:
        return dispatchUnclear("unknown_status", `DPD answered the protocol with a status the plugin does not know (${statusWord(status)}).`, answer)
    }
  }
  if (body && Array.isArray(body.errors) && isClientError(answer)) return beanRefused(answer, body, "protocol")
  return byHttp(answer, "protocol")
}

export function classifyAvailabilityAnswer(answer: DpdHttpAnswer): AvailabilityOutcome {
  if (answer.httpStatus === 401) return authRefused(answer)
  const body = obj(answer.body)
  if (answer.httpStatus >= 500) return serverError(answer, "courier availability", typeof body?.status === "string" ? body.status : "")
  if (body && typeof body.status === "string" && statusReadable(answer)) {
    const status = body.status
    switch (status) {
      case "OK": {
        const raw = list(body.ranges)
        if (raw.length === 0) return dispatchRefused("range_not_found", "DPD gave no courier hours for this postal code (OK without ranges).", answer)
        const ranges = courierRangesOf(raw)
        if (ranges.length === 0) return dispatchUnclear("bad_answer", "DPD answered the courier availability with hours the plugin cannot read.", answer)
        return { kind: "ok", ranges, traceId: answer.traceId, httpStatus: answer.httpStatus }
      }
      case "POSTAL_CODE_NOT_FOUND":
        return dispatchRefused("postal_code_not_found", "DPD does not know this postal code for a courier (POSTAL_CODE_NOT_FOUND).", answer)
      case "RANGE_NOT_FOUND":
        return dispatchRefused("range_not_found", "DPD gave no courier hours for this postal code (RANGE_NOT_FOUND).", answer)
      case "WRONG_POSTAL_PATTERN":
        return dispatchRefused("postal_pattern", "DPD refused the postal code format (WRONG_POSTAL_PATTERN).", answer)
      case "COUNTRY_CODE_NOT_FOUND":
        return dispatchRefused("country_not_found", "DPD does not know this country for a courier (COUNTRY_CODE_NOT_FOUND).", answer)
      case "DISABLED_API":
        return dispatchRefused("disabled_api", "DPD turned this service off for the account (DISABLED_API).", answer, [{ code: "dpd_disabled_api" }])
      case "UNKNOWN_ERROR":
        return dispatchUnclear("dpd_unknown_error", "DPD reported an unknown error for the courier availability (UNKNOWN_ERROR).", answer)
      default:
        return dispatchUnclear("unknown_status", `DPD answered the courier availability with a status the plugin does not know (${statusWord(status)}).`, answer)
    }
  }
  if (body && Array.isArray(body.errors) && isClientError(answer)) return beanRefused(answer, body, "courier availability")
  return byHttp(answer, "courier availability")
}

/** status.errorDetails[] as dpd_courier problems (field: the DPD field list joined by ", ", detail: the code and description, masked). */
export function problemsOfPickupCall(body: unknown): ProblemDto[] {
  const info = obj(obj(body)?.status)
  const status = text(info?.status)
  const out: ProblemDto[] = []
  if (status === "DISALLOWED_FID") out.push({ code: "dpd_payer_fid" })
  if (status === "DISABLED_API") out.push({ code: "dpd_disabled_api" })
  for (const d of list(info?.errorDetails)) {
    const entry = obj(d)
    if (!entry) continue
    const code = text(entry.code)
    const description = cleanDpdText(entry.description)
    const field = text(entry.fields).split(";").map((f) => f.trim()).filter(Boolean).join(", ")
    const detail = code && description ? `${code}: ${description}` : code || description
    if (!field && !detail) continue
    out.push({ code: "dpd_courier", ...(field ? { field } : {}), ...(detail ? { detail } : {}) })
  }
  return dedupe(out)
}

/** The code of a VALIDATION_ERROR from its errorDetails codes, the first that matches (8.6); null: the whole answer is unclear. */
const DETAIL_CODES: ReadonlyArray<[string, CourierErrorCode]> = [
  ["ORDER_CLOSED_STATUS", "order_closed"],
  ["INCORRECT_CHECKSUM", "checksum"],
  ["NOT_FOUND", "order_not_found"],
  ["INCORRECT_STATUS", "order_status"],
  ["INCORRECT_PICKUP_TIME", "pickup_time"],
  ["ORDER_NUMBER_ERROR", "order_number"],
]

function validationCode(info: Obj | null): DispatchAnswerCode | null {
  const codes = list(info?.errorDetails).map((d) => text(obj(d)?.code))
  if (codes.includes("SERVICE_UNAVAILABLE")) return null
  return DETAIL_CODES.find(([dpd]) => codes.includes(dpd))?.[1] ?? "validation"
}

/** A Bean refusal of a courier call: checkSum before the pickup time before anything else (8.6). */
function courierBeanRefused(answer: DpdHttpAnswer, body: Obj, what: string): DispatchRefused {
  const problems = problemsOfBean(body)
  const fields = list(body.errors).map((e) => text(obj(e)?.field))
  const code: DispatchAnswerCode = fields.some((f) => f.endsWith("checkSum"))
    ? "checksum"
    : fields.some((f) => f === "pickupDate" || f === "pickupTimeFrom" || f === "pickupTimeTo")
      ? "pickup_time"
      : "validation"
  return dispatchRefused(code, refusedSentence(what, `HTTP ${answer.httpStatus}`, problems), answer, problems)
}

/** A StatusInfo answer of packagesPickupCall other than OK (8.4, 8.5, 8.6). */
function courierStatusOutcome(answer: DpdHttpAnswer, body: Obj, status: string, what: string): DispatchRefused | DispatchUnclear {
  const info = obj(body.status)
  const problems = problemsOfPickupCall(body)
  switch (status) {
    case "UNKNOWN_ERROR":
      return dispatchUnclear("dpd_unknown_error", `DPD reported an unknown error for the ${what} (UNKNOWN_ERROR); the result is not known. Check the DPD panel before trying again.`, answer)
    case "SERVICE_UNAVAILABLE":
      return dispatchUnclear("service_unavailable", `DPD said the courier service is unavailable (SERVICE_UNAVAILABLE); the result of the ${what} is not known.`, answer)
    case "VALIDATION_ERROR": {
      const code = validationCode(info)
      if (code === null) return dispatchUnclear("service_unavailable", `DPD said the courier service is unavailable (VALIDATION_ERROR, SERVICE_UNAVAILABLE); the result of the ${what} is not known.`, answer)
      return dispatchRefused(code, refusedSentence(what, status, problems), answer, problems)
    }
    case "DISALLOWED_FID":
      return dispatchRefused("payer_fid", refusedSentence(what, status, problems.filter((p) => p.code === "dpd_courier")), answer, problems)
    case "DISABLED_API":
      return dispatchRefused("disabled_api", "DPD turned this service off for the account (DISABLED_API).", answer, problems)
    case "NOT_FOUND":
      return dispatchRefused("order_not_found", refusedSentence(what, status, problems), answer, problems)
    default:
      return dispatchUnclear("unknown_status", `DPD answered the ${what} with a status the plugin does not know (${statusWord(status)}).`, answer)
  }
}

/** An orderNumber or checkSum DPD gave: a number as a string, a string trimmed (length and leading zeros kept); null when empty, null or "null". */
function courierValue(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  const s = v.trim()
  return s === "" || s.toLowerCase() === "null" ? null : s
}

/** The StatusInfo status of a courier answer ("" when there is none). */
function courierStatusOf(body: Obj | null): string {
  return text(obj(body?.status)?.status)
}

export function classifyPickupCallAnswer(answer: DpdHttpAnswer): PickupCallOutcome {
  const what = "courier order"
  if (answer.httpStatus === 401) return authRefused(answer)
  const body = obj(answer.body)
  if (answer.httpStatus >= 500) return serverError(answer, what, courierStatusOf(body))
  const status = courierStatusOf(body)
  if (body && status && statusReadable(answer)) {
    if (status === "OK") {
      const orderNumber = courierValue(body.orderNumber)
      const checkSum = courierValue(body.checkSum)
      if (orderNumber === null || checkSum === null) {
        return dispatchUnclear("no_order_number", "DPD answered OK without an order number or a checkSum; the order may exist. Check the DPD panel before ordering again.", answer)
      }
      return { kind: "ok", orderNumber, checkSum, traceId: answer.traceId, httpStatus: answer.httpStatus }
    }
    return courierStatusOutcome(answer, body, status, what)
  }
  if (body && Array.isArray(body.errors) && isClientError(answer)) return courierBeanRefused(answer, body, what)
  return byHttp(answer, what)
}

export function classifyPickupCallChangeAnswer(answer: DpdHttpAnswer, op: "update" | "delete"): PickupCallChangeOutcome {
  const what = op === "update" ? "courier change" : "courier cancellation"
  if (answer.httpStatus === 401) return authRefused(answer)
  const body = obj(answer.body)
  if (answer.httpStatus >= 500) return serverError(answer, what, courierStatusOf(body))
  const status = courierStatusOf(body)
  if (body && status && statusReadable(answer)) {
    if (status === "OK") {
      return { kind: "ok", orderNumber: courierValue(body.orderNumber), checkSum: courierValue(body.checkSum), traceId: answer.traceId, httpStatus: answer.httpStatus }
    }
    return courierStatusOutcome(answer, body, status, what)
  }
  if (body && Array.isArray(body.errors) && isClientError(answer)) return courierBeanRefused(answer, body, what)
  return byHttp(answer, what)
}
