import { DEFAULT_REQUESTS_PER_MINUTE, DEFAULT_TIMEOUT_MS, DPDSERVICES_PATHS, LABEL_OUTPUT, PACING_MAX_WAIT_MS, type LabelPage } from "./constants"
import { classifyLabelsAnswer, classifyNumbersAnswer, transportFailure, type DpdRefused, type DpdUnclear, type LabelsOutcome, type NumbersOutcome } from "./dpd-answers"
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

type Op = "numbers" | "labels"
const OP_NAMES: Record<Op, string> = { numbers: "generatePackagesNumbers", labels: "generateSpedLabels" }

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
export function nothingSent(outcome: NumbersOutcome | LabelsOutcome): boolean {
  return outcome.kind === "refused" && outcome.code === "rate_limited" && outcome.httpStatus === 0
}

export function createDpdServicesClient(opts: DpdServicesClientOptions): DpdServicesClient {
  const host = opts.host.replace(/\/+$/, "")
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const minGap = Math.ceil(60_000 / Math.max(1, opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE))
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const sleep = opts.sleep ?? realSleep
  const secrets = [opts.password]
  const mask = (s: string) => maskSecrets(s, secrets)
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

  function log(op: Op, http: number, what: string, traceId: string | null, ms: number, ok: boolean): void {
    const line = mask(`[dpd] DPDServices ${OP_NAMES[op]}: ${http || "-"} ${what} trace=${traceId ?? "-"} ${ms}ms`)
    if (ok) opts.logger?.info(line)
    else opts.logger?.warn(line)
  }

  /** One POST, never retried: the raw answer, or the transport failure. */
  async function post(op: Op, body: unknown): Promise<{ answer: DpdHttpAnswer } | { failure: DpdUnclear } | { paced: true }> {
    if (!(await pace())) return { paced: true }
    const started = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await doFetch(`${host}${DPDSERVICES_PATHS[op]}`, { method: "POST", headers: { ...headers }, body: JSON.stringify(body), signal: ctrl.signal })
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
      return { failure: transportFailure(ctrl.signal.aborted || isAbort(err), mask(errorText(err)), timeoutMs) }
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
  function masked(outcome: DpdRefused | DpdUnclear): DpdRefused | DpdUnclear {
    if (outcome.kind === "unclear") return { ...outcome, message: mask(outcome.message) }
    return {
      ...outcome,
      message: mask(outcome.message),
      problems: outcome.problems.map((p) => ({ ...p, ...(p.field ? { field: mask(p.field) } : {}), ...(p.detail ? { detail: mask(p.detail) } : {}) })),
    }
  }

  function summary(outcome: NumbersOutcome | LabelsOutcome): string {
    if (outcome.kind === "ok") return "OK"
    if (outcome.kind === "exists") return outcome.status
    if (outcome.kind === "not_found") return "NOT_FOUND"
    return outcome.code
  }

  async function call<T extends NumbersOutcome | LabelsOutcome>(op: Op, body: unknown, classify: (answer: DpdHttpAnswer) => T): Promise<T | DpdRefused | DpdUnclear> {
    const started = Date.now()
    const sent = await post(op, body)
    let outcome: T | DpdRefused | DpdUnclear
    let http = 0
    let traceId: string | null = null
    if ("paced" in sent) outcome = pacedOut()
    else if ("failure" in sent) outcome = sent.failure
    else {
      outcome = classify(sent.answer)
      http = sent.answer.httpStatus
      traceId = sent.answer.traceId
    }
    if (outcome.kind === "refused" || outcome.kind === "unclear") outcome = masked(outcome)
    log(op, http, summary(outcome), traceId, Date.now() - started, outcome.kind === "ok")
    return outcome
  }

  return {
    host,
    generatePackagesNumbers: (body) => call("numbers", body, (answer) => classifyNumbersAnswer(answer, body)),
    generateSpedLabels: (body) => call("labels", body, (answer) => classifyLabelsAnswer(answer)),
  }
}
