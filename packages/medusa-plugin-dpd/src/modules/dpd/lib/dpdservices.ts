import { DEFAULT_REQUESTS_PER_MINUTE, DEFAULT_TIMEOUT_MS, DPDSERVICES_PATHS, LABEL_OUTPUT, PACING_MAX_WAIT_MS, type LabelPage } from "./constants"
import {
  classifyAvailabilityAnswer,
  classifyLabelsAnswer,
  classifyNumbersAnswer,
  classifyPickupCallAnswer,
  classifyPickupCallChangeAnswer,
  classifyProtocolAnswer,
  transportFailure,
  type AvailabilityOutcome,
  type DispatchRefused,
  type DispatchUnclear,
  type DpdRefused,
  type DpdUnclear,
  type LabelsOutcome,
  type NumbersOutcome,
  type PickupCallChangeOutcome,
  type PickupCallOutcome,
  type ProtocolOutcome,
} from "./dpd-answers"
import { KIT_META } from "./kit-meta"
import { maskSecrets } from "./security"

/**
 * THE DPDSERVICES CLIENT: the only code that talks to the DPDServices REST
 * API with the login and the password.
 *
 *   hosts     DPDSERVICES_HOSTS.sandbox (the DPD demo host) and .live
 *   auth      HTTP Basic plus the master FID in `x-dpd-fid`; the password
 *             never appears in a message or a log line
 *   retries   none: generatePackagesNumbers creates parcels and
 *             generateSpedLabels advises them, so each call is sent once;
 *             an answer that never came is reported `unclear`
 *   pacing    a self-imposed limit of requests per minute per process; a
 *             call that would wait for its slot longer than
 *             PACING_MAX_WAIT_MS is not sent at all (refused, rate_limited),
 *             so a claim lease always outlives its calls
 *
 * Every result is an outcome (dpd-answers.ts), never a thrown error, so the
 * flows decide states from one value. Whether a write may happen at all is
 * decided by the flows (the writer must be armed); this file only knows how
 * to send it. The body of an answer is never logged: a label is a base64
 * PDF with the receiver's address on it.
 */

export type DpdSessionType = "DOMESTIC" | "INTERNATIONAL"

/** SenderOrReceiver of DPDServices. Empty optional fields are left out, never sent as "". */
export type DpdAddress = {
  company?: string
  name?: string
  address: string
  city: string
  countryCode: string
  postalCode: string
  phone?: string
  email?: string
}

/** PudoReceiver of DPDServices: who collects at a DPD Pickup point. Empty optional fields are left out. */
export type DpdPudoReceiver = {
  company?: string
  /** Required by the OpenAPI; max 100. */
  name: string
  /** alpha-2 */
  countryCode: string
  phone?: string
  email?: string
}

export type DpdAttribute = { code: string; value: string }
export type DpdServiceItem =
  | { code: "COD"; attributes: DpdAttribute[] }
  | { code: "DPD_PICKUP"; attributes: [{ code: "PUDO"; value: string }] }

export type DpdParcel = {
  reference: string
  /** kg, two decimals, 0.01 to 700 in Poland. */
  weight: number
  sizeX?: number
  sizeY?: number
  sizeZ?: number
  content?: string
}

export type DpdPackage = {
  reference: string
  ref1?: string
  ref2?: string
  sender: DpdAddress
  /** Courier. Exactly one of receiver and pudoReceiver is set. */
  receiver?: DpdAddress
  /** DPD Pickup. */
  pudoReceiver?: DpdPudoReceiver
  payerFID: number
  parcels: DpdParcel[]
  services?: DpdServiceItem[]
}

export type GeneratePackagesNumbersRequest = {
  generationPolicy: "STOP_ON_FIRST_ERROR"
  /** Always exactly one package (DS6). */
  packages: [DpdPackage]
}

export type LabelSearch = { packageReference: string } | { waybills: string[] }

export type GenerateSpedLabelsRequest = {
  labelSearchParams: {
    policy: "STOP_ON_FIRST_ERROR"
    session: {
      type: DpdSessionType
      packages: Array<{ reference?: string; parcels?: Array<{ waybill?: string; reference?: string }> }>
    }
  }
  outputDocFormat: "PDF"
  format: LabelPage
  outputType: "BIC3"
  variant: "STANDARD"
}

/** ProtocolPickupAddress: fid required (H5: payerFid), the rest printed next to the account data. Empty fields left out. */
export type DpdProtocolPickupAddress = {
  fid: number
  company?: string
  name?: string
  address?: string
  city?: string
  countryCode?: string
  postalCode?: string
  phone?: string
  email?: string
}

export type GenerateProtocolRequest = {
  protocolSearchParams: {
    policy: "STOP_ON_FIRST_ERROR"
    session: { type: "DOMESTIC"; packages: Array<{ reference: string }> }
    pickupAddress: DpdProtocolPickupAddress
  }
  outputDocFormat: "PDF"
}

/** PackagesParams of packagesPickupCall: envelopes always 0, never a pallet. */
export type DpdPackagesParams = {
  doxCount: 0
  parcel: { count: number; weight: number; maxWeight: number; maxHeight: number; maxWidth: number; maxDepth: number }
}

export type DpdPickupSender = {
  name: string
  fullName: string
  address: string
  city: string
  /** Five digits; create only (UpdateSender has no postalCode). */
  postalCode: string
  phone: string
}

export type PackagesPickupCallCreateRequest = {
  /** yyyy-MM-dd */
  pickupDate: string
  /** HH:mm */
  pickupTimeFrom: string
  pickupTimeTo: string
  orderType: "DOMESTIC"
  waybillsReady: true
  packagesForCollection: {
    payer: { number: number; name?: string }
    orderer: { name: string; fullName: string; phone: string }
    sender: DpdPickupSender
    packagesParams: DpdPackagesParams
  }
}

export type PackagesPickupCallUpdateRequest = {
  orderNumber: string
  checkSum: string
  updateMode: "DONT_CREATE_NEW_IF_CLOSED"
  pickupDate: string
  pickupTimeFrom: string
  pickupTimeTo: string
  waybillsReady: true
  packagesForCollection: {
    payer: { name?: string }
    sender: Omit<DpdPickupSender, "postalCode">
    packagesParams: DpdPackagesParams
  }
}

/** DELETE packagesPickupCall query. */
export type PickupCallDeleteQuery = { orderNumber: string; checkSum: string }
/** GET courierOrderAvailability query; zipCode as five digits (H9). */
export type CourierAvailabilityQuery = { countryCode: "PL"; zipCode: string }

/** Every outcome of the client. */
export type AnyOutcome = NumbersOutcome | LabelsOutcome | ProtocolOutcome | AvailabilityOutcome | PickupCallOutcome | PickupCallChangeOutcome

/** The raw answer the classifiers read (also what the fake and the fixtures give). */
export type DpdHttpAnswer = {
  httpStatus: number
  /** Parsed JSON, or null for an empty or non JSON body. */
  body: unknown
  /** The raw text, for a non JSON body (cut to 300 characters, masked before any use). */
  text: string
  traceId: string | null
  ms: number
}

export type LoggerLike = { info(msg: string): void; warn(msg: string): void; error(msg: string): void }

export type DpdServicesClientOptions = {
  /** DPDSERVICES_HOSTS.sandbox or .live, from dpdServicesHost(options). */
  host: string
  login: string
  password: string
  /** Sent as the x-dpd-fid header (a decimal string). */
  masterFid: number
  timeoutMs?: number
  requestsPerMinute?: number
  userAgent?: string
  logger?: LoggerLike | null
  /** Tests: the fetch to use. */
  fetchImpl?: typeof fetch
  /** Tests: how pacing waits. */
  sleep?: (ms: number) => Promise<void>
}

export type DpdServicesClient = {
  readonly host: string
  /** Never throws for an HTTP answer or a transport failure: every result is an outcome. */
  generatePackagesNumbers(body: GeneratePackagesNumbersRequest): Promise<NumbersOutcome>
  generateSpedLabels(body: GenerateSpedLabelsRequest): Promise<LabelsOutcome>
  /* Stage 4: every method never throws either. */
  generateProtocol(body: GenerateProtocolRequest): Promise<ProtocolOutcome>
  courierOrderAvailability(query: CourierAvailabilityQuery): Promise<AvailabilityOutcome>
  pickupCallCreate(body: PackagesPickupCallCreateRequest): Promise<PickupCallOutcome>
  pickupCallUpdate(body: PackagesPickupCallUpdateRequest): Promise<PickupCallChangeOutcome>
  pickupCallDelete(query: PickupCallDeleteQuery): Promise<PickupCallChangeOutcome>
}

/** The body of generateSpedLabels for one search: by the package reference (every box of it) or by waybills. */
export function labelsRequest(search: LabelSearch, page: LabelPage, sessionType: DpdSessionType = "DOMESTIC"): GenerateSpedLabelsRequest {
  const packages = "packageReference" in search ? [{ reference: search.packageReference }] : [{ parcels: search.waybills.map((waybill) => ({ waybill })) }]
  return {
    labelSearchParams: { policy: "STOP_ON_FIRST_ERROR", session: { type: sessionType, packages } },
    outputDocFormat: LABEL_OUTPUT.outputDocFormat,
    format: page,
    outputType: LABEL_OUTPUT.outputType,
    variant: LABEL_OUTPUT.variant,
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const TEXT_MAX = 300

type Op = "numbers" | "labels" | "protocol" | "availability" | "pickupCreate" | "pickupUpdate" | "pickupDelete"
const OP_NAMES: Record<Op, string> = {
  numbers: "generatePackagesNumbers",
  labels: "generateSpedLabels",
  protocol: "generateProtocol",
  availability: "courierOrderAvailability",
  pickupCreate: "packagesPickupCall POST",
  pickupUpdate: "packagesPickupCall PATCH",
  pickupDelete: "packagesPickupCall DELETE",
}

type Method = "GET" | "POST" | "PATCH" | "DELETE"

/** Stage 4 operations: their own transport sentence (8.1) and the path in the log line. */
type DispatchOp = Exclude<Op, "numbers" | "labels">
type DispatchOutcome = ProtocolOutcome | AvailabilityOutcome | PickupCallOutcome | PickupCallChangeOutcome

/** What an answer that never came means for each stage 4 call (8.1). */
const NO_ANSWER: Record<DispatchOp, string> = {
  protocol: "DPD did not answer the protocol within <ms> ms; nothing is printed again by itself.",
  availability: "DPD did not answer the courier availability within <ms> ms.",
  pickupCreate: "DPD did not answer the courier order within <ms> ms; the order may exist. Check the DPD panel before ordering again.",
  pickupUpdate: "DPD did not answer the courier change within <ms> ms; the change may have been made. Check the DPD panel before changing again.",
  pickupDelete: "DPD did not answer the courier cancellation within <ms> ms; the order may be canceled. Check the DPD panel before canceling again.",
}

const UNREACHABLE: Record<DispatchOp, string> = {
  protocol: "the protocol",
  availability: "the courier availability",
  pickupCreate: "the courier order; the order may exist. Check the DPD panel before ordering again",
  pickupUpdate: "the courier change; the change may have been made. Check the DPD panel before changing again",
  pickupDelete: "the courier cancellation; the order may be canceled. Check the DPD panel before canceling again",
}

function isAbort(err: unknown): boolean {
  const name = err !== null && typeof err === "object" ? (err as { name?: unknown }).name : undefined
  return name === "AbortError" || name === "TimeoutError"
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause
    const why = cause instanceof Error ? cause.message : ""
    return why && why !== err.message ? `${err.message} (${why})` : err.message
  }
  return String(err)
}

/** The client's own pacing refused the call (refused rate_limited with no HTTP status): nothing left this server, so nothing can exist in DPD because of it. */
export function nothingSent(outcome: AnyOutcome): boolean {
  return outcome.kind === "refused" && outcome.code === "rate_limited" && outcome.httpStatus === 0
}

export function createDpdServicesClient(opts: DpdServicesClientOptions): DpdServicesClient {
  const host = opts.host.replace(/\/+$/, "")
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const minGap = Math.ceil(60_000 / Math.max(1, opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE))
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const sleep = opts.sleep ?? realSleep
  const secrets = [opts.password]
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString("base64")}`,
    "x-dpd-fid": String(opts.masterFid),
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": opts.userAgent ?? `KodaPlus-Medusa-DPD/${KIT_META.version} (+https://koda.plus)`,
  }

  /*
   * Pacing on a clock that moves with the waits: after a wait the clock is at
   * least at the slot waited for, so a sleep that returns early (a test) never
   * piles the slots up, and a real one changes nothing.
   */
  let nextSlot = 0
  let skew = 0
  const clock = () => Date.now() + skew

  /** Reserves the next slot and waits for it; false (nothing reserved) when the wait would exceed PACING_MAX_WAIT_MS. Runs synchronously up to the wait. */
  async function pace(): Promise<boolean> {
    const now = clock()
    const slot = Math.max(now, nextSlot)
    const wait = slot - now
    if (wait > PACING_MAX_WAIT_MS) return false
    nextSlot = slot + minGap
    if (wait > 0) {
      await sleep(wait)
      skew = Math.max(skew, slot - Date.now())
    }
    return true
  }

  /** One log line: the operation, for a stage 4 call also the path (never the query, it may carry the checkSum), the HTTP status, the outcome code. */
  function log(op: Op, path: string | null, http: number, what: string, traceId: string | null, ms: number, ok: boolean, mask: (s: string) => string): void {
    /* The path is a constant of DPDSERVICES_PATHS: kept out of the mask, whose 40 character rule would hide it. */
    const line = `[dpd] DPDServices ${OP_NAMES[op]}${path ? ` ${path}` : ""}: ${mask(`${http || "-"} ${what} trace=${traceId ?? "-"} ${ms}ms`)}`
    if (ok) opts.logger?.info(line)
    else opts.logger?.warn(line)
  }

  type Sent = { answer: DpdHttpAnswer } | { failure: { aborted: boolean; detail: string } } | { paced: true }

  /** One request, never retried: the raw answer, or the transport failure. GET and DELETE carry no body and no content-type. */
  async function send(method: Method, path: string, query: Record<string, string> | null, body: unknown): Promise<Sent> {
    if (!(await pace())) return { paced: true }
    const started = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const withBody = method === "POST" || method === "PATCH"
      const own: Record<string, string> = { ...headers }
      if (!withBody) delete own["content-type"]
      const url = `${host}${path}${query ? `?${new URLSearchParams(query).toString()}` : ""}`
      const res = await doFetch(url, { method, headers: own, ...(withBody ? { body: JSON.stringify(body) } : {}), signal: ctrl.signal })
      const raw = await res.text()
      let parsed: unknown = null
      if (raw.trim() !== "") {
        try {
          parsed = JSON.parse(raw)
        } catch {
          /* a gateway page or a cut body: classified by the HTTP status */
        }
      }
      const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
      const traceId = typeof record?.traceId === "string" ? record.traceId : null
      return { answer: { httpStatus: res.status, body: parsed, text: parsed === null ? raw.slice(0, TEXT_MAX) : "", traceId, ms: Date.now() - started } }
    } catch (err) {
      return { failure: { aborted: ctrl.signal.aborted || isAbort(err), detail: errorText(err) } }
    } finally {
      clearTimeout(timer)
    }
  }

  function pacedOut(): DpdRefused {
    return {
      kind: "refused",
      code: "rate_limited",
      message: `Too many DPD calls from this server: the next free slot is more than ${PACING_MAX_WAIT_MS / 1000} s away, so nothing was sent.`,
      problems: [],
      traceId: null,
      httpStatus: 0,
    }
  }

  /** Masks every text of a refusal or an unclear answer that a person or a log may read. */
  function masked(outcome: DpdRefused | DpdUnclear, mask: (s: string) => string): DpdRefused | DpdUnclear
  function masked(outcome: DispatchRefused | DispatchUnclear, mask: (s: string) => string): DispatchRefused | DispatchUnclear
  function masked(outcome: DispatchRefused | DispatchUnclear, mask: (s: string) => string): DispatchRefused | DispatchUnclear {
    if (outcome.kind === "unclear") return { ...outcome, message: mask(outcome.message) }
    return {
      ...outcome,
      message: mask(outcome.message),
      problems: outcome.problems.map((p) => ({ ...p, ...(p.field ? { field: mask(p.field) } : {}), ...(p.detail ? { detail: mask(p.detail) } : {}) })),
    }
  }

  function summary(outcome: AnyOutcome): string {
    if (outcome.kind === "ok") return "OK"
    if (outcome.kind === "exists") return outcome.status
    if (outcome.kind === "not_found") return "NOT_FOUND"
    return outcome.code
  }

  const stage2Mask = (s: string) => maskSecrets(s, secrets)

  async function call<T extends NumbersOutcome | LabelsOutcome>(op: "numbers" | "labels", body: unknown, classify: (answer: DpdHttpAnswer) => T): Promise<T | DpdRefused | DpdUnclear> {
    const started = Date.now()
    const sent = await send("POST", DPDSERVICES_PATHS[op], null, body)
    let outcome: T | DpdRefused | DpdUnclear
    let http = 0
    let traceId: string | null = null
    if ("paced" in sent) outcome = pacedOut()
    else if ("failure" in sent) outcome = transportFailure(sent.failure.aborted, stage2Mask(sent.failure.detail), timeoutMs)
    else {
      outcome = classify(sent.answer)
      http = sent.answer.httpStatus
      traceId = sent.answer.traceId
    }
    if (outcome.kind === "refused" || outcome.kind === "unclear") outcome = masked(outcome, stage2Mask)
    log(op, null, http, summary(outcome), traceId, Date.now() - started, outcome.kind === "ok", stage2Mask)
    return outcome
  }

  /**
   * A stage 4 call: the same pacing, timeout and headers, an own sentence for
   * an answer that never came, and the checkSum of a PATCH or DELETE among
   * the secrets of every message and log line of the call. The answer body is
   * never logged (a courier answer carries the checkSum, a protocol the PDF).
   */
  async function dispatchCall<T extends DispatchOutcome>(
    op: DispatchOp,
    req: { method: Method; path: string; query: Record<string, string> | null; body: unknown; checkSum?: string },
    classify: (answer: DpdHttpAnswer) => T,
  ): Promise<T | DispatchRefused | DispatchUnclear> {
    const started = Date.now()
    const callSecrets = [...secrets, req.checkSum ?? null]
    const mask = (s: string) => maskSecrets(s, callSecrets)
    const sent = await send(req.method, req.path, req.query, req.body)
    let outcome: T | DispatchRefused | DispatchUnclear
    let http = 0
    let traceId: string | null = null
    if ("paced" in sent) outcome = pacedOut()
    else if ("failure" in sent) {
      outcome = sent.failure.aborted
        ? { kind: "unclear", code: "timeout", message: NO_ANSWER[op].replace("<ms>", String(timeoutMs)), traceId: null, httpStatus: 0 }
        : { kind: "unclear", code: "network", message: `DPD could not be reached for ${UNREACHABLE[op]}: ${sent.failure.detail.trim() || "network error"}.`.slice(0, 1000), traceId: null, httpStatus: 0 }
    } else {
      outcome = classify(sent.answer)
      http = sent.answer.httpStatus
      traceId = sent.answer.traceId
    }
    if (outcome.kind === "refused" || outcome.kind === "unclear") outcome = masked(outcome, mask)
    log(op, req.path, http, summary(outcome), traceId, Date.now() - started, outcome.kind === "ok", mask)
    return outcome
  }

  const pickupPath = DPDSERVICES_PATHS.pickupCall

  return {
    host,
    generatePackagesNumbers: (body) => call("numbers", body, (answer) => classifyNumbersAnswer(answer, body)),
    generateSpedLabels: (body) => call("labels", body, (answer) => classifyLabelsAnswer(answer)),
    generateProtocol: (body) =>
      dispatchCall("protocol", { method: "POST", path: DPDSERVICES_PATHS.protocol, query: null, body }, (answer) => classifyProtocolAnswer(answer, body)),
    courierOrderAvailability: (query) =>
      dispatchCall(
        "availability",
        { method: "GET", path: DPDSERVICES_PATHS.availability, query: { countryCode: query.countryCode, zipCode: query.zipCode }, body: null },
        (answer) => classifyAvailabilityAnswer(answer),
      ),
    pickupCallCreate: (body) =>
      dispatchCall("pickupCreate", { method: "POST", path: pickupPath, query: null, body }, (answer) => classifyPickupCallAnswer(answer)),
    pickupCallUpdate: (body) =>
      dispatchCall("pickupUpdate", { method: "PATCH", path: pickupPath, query: null, body, checkSum: body.checkSum }, (answer) => classifyPickupCallChangeAnswer(answer, "update")),
    pickupCallDelete: (query) =>
      dispatchCall(
        "pickupDelete",
        { method: "DELETE", path: pickupPath, query: { orderNumber: query.orderNumber, checkSum: query.checkSum }, body: null, checkSum: query.checkSum },
        (answer) => classifyPickupCallChangeAnswer(answer, "delete"),
      ),
  }
}
