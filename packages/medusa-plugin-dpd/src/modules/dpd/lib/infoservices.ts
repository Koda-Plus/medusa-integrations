import {
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_TIMEOUT_MS,
  EVENT_TIME_ZONE,
  INFOSERVICES_LANGUAGE,
  INFOSERVICES_NAMESPACE,
  INFOSERVICES_OPERATIONS,
  INFOSERVICES_QUEUE_LIMIT,
  PACING_MAX_WAIT_MS,
  type DpdMode,
  type InfoServicesOperation,
} from "./constants"
import type { StatusSource } from "./contract"
import type { LoggerLike } from "./dpdservices"
import { KIT_META } from "./kit-meta"
import type { ResolvedDpdOptions } from "./options"
import { maskSecrets } from "./security"
import { clip } from "./text"

/**
 * THE InfoServices SOAP CLIENT (statuses, stage 5): a hand written envelope
 * and a hand written parser, no dependency. Production only: demo and the
 * sandbox simulate the statuses (status-sim.ts), so only live mode ever calls
 * INFOSERVICES_URL.
 *
 * The login, the password, the channel and the request envelope never reach
 * a log, an error, dpd_event.data or an answer; an error names the
 * operation, never the URL. eventDataList values are read only to find the
 * new waybill of a repin (repinCandidate) and are never stored or logged:
 * code 03 is the receiver.
 *
 * The parser reads elements by their local names (S:, soap:, ns2: or no
 * prefix), decodes the five XML entities and character references, removes
 * <![CDATA[...]]> (also when DPD writes it as entities, PDF s.16), never
 * expands a DOCTYPE and never reads an external entity. A body it cannot read
 * (also one nested deeper than MAX_XML_DEPTH or longer than MAX_ANSWER_CHARS)
 * is null, never an exception, and no input costs more than linear time.
 */

/** authDataV1. Never logged, never in an error, never in dpd_event.data or an answer. */
export type InfoAuth = { login: string; password: string; channel: string }

/** One eventDataList item. TRANSIENT: read only by repinCandidate (DS3), never stored, never logged (code 03 is the receiver, s.21). */
export type InfoEventData = { code: string | null; description: string | null; value: string }

/** One event as the parser reads it (customerEventV3 of getEventsForWaybillV1, customerEventV4 of the queue). */
export type InfoEvent = {
  /** The waybill the event is about (as DPD sent it, trimmed). */
  waybill: string
  /** businessCode, like "190101"; "" only for a CANCEL entry of the queue, which carries no businessCode (O31). */
  code: string
  /** The Polish description DPD sends (language PL); stored as the history message. */
  description: string | null
  /** eventTime as sent, trimmed, like "2011-11-16T12:43:41" (s.11) or "2018-02-15T15:52:29.886" (s.21); a space instead of T is read too (7.8). "" when absent. */
  eventTimeRaw: string
  /** eventTime read as Warsaw wall time, in ISO UTC; null when unreadable (the event then stays out of the fold, H9). */
  eventTime: string | null
  depot: string | null
  depotName: string | null
  /** As sent ("PL" or "616"), never interpreted (H11). */
  country: string | null
  /** A decimal string (objectId exceeds 2^53); null for "0", empty or absent (H5). */
  objectId: string | null
  /** Transient, see InfoEventData. */
  data: InfoEventData[]
  /** Queue only (customerEventV4): the queue id and INSERT or CANCEL; null for the per waybill method. */
  queueId: string | null
  operationType: "INSERT" | "CANCEL" | null
}

/** <return> of the two event operations: confirmId (always "0" per waybill, H4) and the events in answer order. */
export type InfoEventsAnswer = { confirmId: string | null; events: InfoEvent[] }

/** Why an answer is unclear (6.1): nothing in the row changes. */
export const INFO_UNCLEAR_CODES = ["timeout", "network", "server_error", "fault", "bad_answer"] as const
export type InfoUnclearCode = (typeof INFO_UNCLEAR_CODES)[number]

/** Every result of the client; it never throws. `message` names the operation, never the URL, never the envelope. */
export type InfoOutcome<T> =
  | { kind: "ok"; value: T; httpStatus: number; ms: number }
  /** Fault "Access denied", "AuthData" or "Authorization" (case insensitive, H2): the pass stops (DS15). */
  | { kind: "auth"; message: string; httpStatus: number; ms: number }
  | { kind: "unclear"; code: InfoUnclearCode; message: string; httpStatus: number; ms: number }
  /** Pacing would wait over PACING_MAX_WAIT_MS: nothing was sent. */
  | { kind: "nothingSent"; code: "rate_limited"; message: string; httpStatus: 0; ms: 0 }

export type WaybillEventsOutcome = InfoOutcome<InfoEventsAnswer>
export type CustomerEventsOutcome = InfoOutcome<InfoEventsAnswer>
/** markEventsAsProcessedV1 <return>true|false</return>. */
export type ConfirmOutcome = InfoOutcome<{ confirmed: boolean }>

export type InfoServicesClientOptions = {
  /** INFOSERVICES_URL (live only); tests pass any URL with their fetchImpl. */
  url: string
  auth: InfoAuth
  timeoutMs?: number
  requestsPerMinute?: number
  userAgent?: string
  logger?: LoggerLike | null
  /** Tests: the fetch to use. */
  fetchImpl?: typeof fetch
  /** Tests: how pacing waits. */
  sleep?: (ms: number) => Promise<void>
}

export type InfoServicesClient = {
  /** getEventsForWaybillV1 (DS14: select ALL, language PL by default). One waybill per call. */
  getEventsForWaybill(waybill: string, select?: "ALL" | "ONLY_LAST"): Promise<WaybillEventsOutcome>
  /** getEventsForCustomerV4: built and tested on PDF fixtures, never called in stage 5 (DS7). */
  getEventsForCustomerV4(limit?: number): Promise<CustomerEventsOutcome>
  /** markEventsAsProcessedV1: never called in stage 5 (DS7, D5: never per waybill). */
  markEventsAsProcessed(confirmId: string): Promise<ConfirmOutcome>
}

/* ------------------------------------------------------------------ */
/* The envelope (7.1)                                                  */
/* ------------------------------------------------------------------ */

/** The characters XML 1.0 does not allow (outside the surrogates): never sent (7.1) and never read (7.5). A U+0000 read would also make Postgres refuse the jsonb tracking and the text of the history, on every pass. */
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

/** A code point XML 1.0 does not allow: below 0x20 except tab, LF and CR, a surrogate, 0xFFFE, 0xFFFF, or outside Unicode. */
function xmlForbiddenCode(code: number): boolean {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return true
  if (code < 0x20) return code !== 0x09 && code !== 0x0a && code !== 0x0d
  return (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff
}

/** The five XML escapes, and the characters XML 1.0 does not allow removed (7.1). */
function escapeXml(value: string): string {
  return String(value)
    .replace(XML_FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** SOAP 1.1 document/literal: the operation with the even prefix, its children unqualified (the schema is unqualified), authDataV1 last. */
function envelope(operation: InfoServicesOperation, children: ReadonlyArray<readonly [string, string]>, auth: InfoAuth): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:even="${INFOSERVICES_NAMESPACE}">`,
    `  <soapenv:Header/>`,
    `  <soapenv:Body>`,
    `    <even:${operation}>`,
    ...children.map(([name, value]) => `      <${name}>${escapeXml(value)}</${name}>`),
    `      <authDataV1>`,
    `        <channel>${escapeXml(auth.channel)}</channel>`,
    `        <login>${escapeXml(auth.login)}</login>`,
    `        <password>${escapeXml(auth.password)}</password>`,
    `      </authDataV1>`,
    `    </even:${operation}>`,
    `  </soapenv:Body>`,
    `</soapenv:Envelope>`,
  ].join("\n")
}

/** The envelopes, every value XML escaped; children of the operation without a prefix. */
export function waybillEventsEnvelope(waybill: string, select: "ALL" | "ONLY_LAST", language: "PL" | "EN", auth: InfoAuth): string {
  return envelope(
    INFOSERVICES_OPERATIONS.waybill,
    [
      ["waybill", waybill.trim()],
      ["eventsSelectType", select],
      ["language", language],
    ],
    auth,
  )
}

export function customerEventsEnvelope(limit: number, language: "PL" | "EN", auth: InfoAuth): string {
  const n = Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.trunc(limit))) : INFOSERVICES_QUEUE_LIMIT
  return envelope(
    INFOSERVICES_OPERATIONS.customer,
    [
      ["limit", String(n)],
      ["language", language],
    ],
    auth,
  )
}

export function confirmEnvelope(confirmId: string, auth: InfoAuth): string {
  return envelope(INFOSERVICES_OPERATIONS.confirm, [["confirmId", confirmId]], auth)
}

/* ------------------------------------------------------------------ */
/* The reader (7.5)                                                    */
/* ------------------------------------------------------------------ */

/** An element: its local name, xsi:nil="true", its child elements and its own text (text nodes decoded, CDATA as is, in order). */
type XmlNode = { name: string; nil: boolean; children: XmlNode[]; text: string }

function localName(qualified: string): string {
  const i = qualified.indexOf(":")
  return i >= 0 ? qualified.slice(i + 1) : qualified
}

/** &lt; &gt; &amp; &quot; &apos; and character references decoded once; an unknown entity, a code outside Unicode or a code XML 1.0 does not allow (&#0;, &#x1F;, &#xFFFE;) stays as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (whole, body: string) => {
    if (body === "lt") return "<"
    if (body === "gt") return ">"
    if (body === "amp") return "&"
    if (body === "quot") return '"'
    if (body === "apos") return "'"
    const code = body.startsWith("#x") ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    if (xmlForbiddenCode(code)) return whole
    return String.fromCodePoint(code)
  })
}

/** The end of a start tag: the first ">" outside a quoted attribute value; -1 when there is none. */
function tagEnd(xml: string, from: number): number {
  let quote: string | null = null
  for (let i = from; i < xml.length; i++) {
    const c = xml[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === ">") return i
  }
  return -1
}

/** A DOCTYPE skipped without reading it: to its ">", past an internal subset in brackets. -1 when it never ends. */
function doctypeEnd(xml: string, from: number): number {
  let depth = 0
  for (let i = from; i < xml.length; i++) {
    const c = xml[i]
    if (c === "[") depth += 1
    else if (c === "]") depth = Math.max(0, depth - 1)
    else if (c === ">" && depth === 0) return i
  }
  return -1
}

function isXmlSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r"
}

/**
 * Whether the attributes of a start tag (the text after its name) hold
 * nil="true" under any prefix. One pass that never steps back into a name or
 * a value, so a long run without "=" or an unquoted value costs its length,
 * not its square (a regex restarted at every character did). A value without
 * quotes or without its closing quote is skipped, never read.
 */
function hasNilTrue(attrs: string): boolean {
  const n = attrs.length
  let nil = false
  let i = 0
  while (i < n) {
    const c = attrs[i]
    if (isXmlSpace(c) || c === "/" || c === "=") {
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      /* A quoted text where a name belongs: skipped whole. */
      const close = attrs.indexOf(c, i + 1)
      if (close < 0) break
      i = close + 1
      continue
    }
    const start = i
    while (i < n && !isXmlSpace(attrs[i]) && attrs[i] !== "=" && attrs[i] !== "/" && attrs[i] !== '"' && attrs[i] !== "'") i += 1
    const name = attrs.slice(start, i)
    let j = i
    while (j < n && isXmlSpace(attrs[j])) j += 1
    if (attrs[j] !== "=") continue
    j += 1
    while (j < n && isXmlSpace(attrs[j])) j += 1
    const q = attrs[j]
    if (q === '"' || q === "'") {
      const close = attrs.indexOf(q, j + 1)
      if (close < 0) break
      if (localName(name) === "nil" && attrs.slice(j + 1, close).trim() === "true") nil = true
      i = close + 1
    } else {
      while (j < n && !isXmlSpace(attrs[j])) j += 1
      i = j
    }
  }
  return nil
}

/** Elements open at once in an answer; DPD nests about eight, deeper is not an answer it sends (a gateway or a forged body). */
const MAX_XML_DEPTH = 64

/** Characters of an answer the parsers read at all: a queue answer of 1000 events is about 1 MB; longer is not an answer DPD sends (a gateway or a forged body). */
const MAX_ANSWER_CHARS = 4_000_000

/** The document element, or null when the text is not well formed XML (an unclosed element, text outside the root, a second root). */
function readXml(input: string): XmlNode | null {
  const xml = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const stack: XmlNode[] = []
  let root: XmlNode | null = null
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf("<", i)
    const text = lt < 0 ? xml.slice(i) : xml.slice(i, lt)
    if (text.length > 0) {
      const top = stack[stack.length - 1]
      if (top) top.text += decodeEntities(text)
      else if (text.trim() !== "") return null
    }
    if (lt < 0) break
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2)
      if (end < 0) return null
      i = end + 2
    } else if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4)
      if (end < 0) return null
      i = end + 3
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9)
      if (end < 0) return null
      const top = stack[stack.length - 1]
      if (!top) return null
      top.text += xml.slice(lt + 9, end)
      i = end + 3
    } else if (xml.startsWith("<!", lt)) {
      const end = doctypeEnd(xml, lt + 2)
      if (end < 0) return null
      i = end + 1
    } else if (xml.startsWith("</", lt)) {
      const end = xml.indexOf(">", lt + 2)
      if (end < 0) return null
      const name = xml.slice(lt + 2, end).trim()
      const open = stack.pop()
      if (!open || localName(name) !== open.name) return null
      i = end + 1
    } else {
      const end = tagEnd(xml, lt + 1)
      if (end < 0) return null
      const selfClosing = xml[end - 1] === "/"
      const inner = xml.slice(lt + 1, selfClosing ? end - 1 : end)
      const nameMatch = /^[^\s/>]+/.exec(inner)
      if (!nameMatch) return null
      const nil = hasNilTrue(inner.slice(nameMatch[0].length))
      const node: XmlNode = { name: localName(nameMatch[0]), nil, children: [], text: "" }
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(node)
      else if (root) return null
      else root = node
      if (!selfClosing) {
        if (stack.length >= MAX_XML_DEPTH) return null
        stack.push(node)
      }
      i = end + 1
    }
  }
  return stack.length === 0 ? root : null
}

/** The first element of that local name at any depth below `node` (document order) that is not xsi:nil; a nil element and what it holds are skipped as absent (7.5 step 2). Iterative, so no depth exhausts the call stack. */
function find(node: XmlNode, name: string): XmlNode | null {
  const todo: XmlNode[] = [...node.children].reverse()
  for (let c = todo.pop(); c; c = todo.pop()) {
    if (c.nil) continue
    if (c.name === name) return c
    for (let k = c.children.length - 1; k >= 0; k--) todo.push(c.children[k])
  }
  return null
}

/** The first direct child of that local name that is not xsi:nil. */
function child(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((c) => c.name === name && !c.nil) ?? null
}

const ENTITY_CDATA = /^<!\[CDATA\[([\s\S]*)\]\]>$/

/** A leaf value (7.5 steps 4 to 6): its text without the characters XML 1.0 does not allow (a raw NUL in a text node or a CDATA), a CDATA written as entities unwrapped once, trimmed; "" is null. */
function leafText(node: XmlNode | null): string | null {
  if (!node || node.nil) return null
  let v = node.text.replace(XML_FORBIDDEN, "").trim()
  const m = ENTITY_CDATA.exec(v)
  if (m) v = m[1].trim()
  return v === "" ? null : v
}

function leaf(node: XmlNode, name: string): string | null {
  return leafText(child(node, name))
}

/** A text cut to `max` characters (7.5) without splitting a surrogate pair: a lone half would make Postgres refuse the jsonb tracking and history on every pass. */
function clipOrNull(text: string | null, max: number): string | null {
  return text === null ? null : clip(text, max)
}

/** The Body of a SOAP answer, or null for a body that is not XML, has no Body or is longer than MAX_ANSWER_CHARS (never parsed: the client then reads it as an answer without a Fault and without a <return>). */
function bodyOf(xml: string): XmlNode | null {
  if (xml.length > MAX_ANSWER_CHARS) return null
  const root = readXml(xml)
  if (!root) return null
  return root.name === "Body" ? root : find(root, "Body")
}

const DIGITS = /^[0-9]{1,20}$/

function readEvent(node: XmlNode): InfoEvent | null {
  const queue = child(node, "operationType") !== null || child(node, "id") !== null
  const op = (leaf(node, "operationType") ?? "").toUpperCase()
  const operationType = queue ? (op === "INSERT" || op === "CANCEL" ? op : null) : null
  const objectRaw = leaf(node, "objectId")
  const objectId = objectRaw && DIGITS.test(objectRaw) && !/^0+$/.test(objectRaw) ? objectRaw : null
  const code = leaf(node, "businessCode") ?? ""
  /* No businessCode: skipped (O31), except a CANCEL of the queue, which carries only its objectId. */
  if (code === "" && !(operationType === "CANCEL" && objectId !== null)) return null
  const queueRaw = queue ? leaf(node, "id") : null
  const eventTimeRaw = leaf(node, "eventTime") ?? ""
  const data: InfoEventData[] = []
  for (const item of node.children) {
    if (item.name !== "eventDataList" || item.nil) continue
    const value = leaf(item, "value")
    if (value === null) continue
    data.push({ code: leaf(item, "code"), description: queue ? null : leaf(item, "description"), value })
  }
  return {
    waybill: leaf(node, "waybill") ?? "",
    code,
    description: clipOrNull(leaf(node, "description"), 500),
    eventTimeRaw,
    eventTime: warsawToUtc(eventTimeRaw),
    depot: leaf(node, "depot"),
    /* customerEventV2 of the queue has no depotName. */
    depotName: queue ? null : clipOrNull(leaf(node, "depotName"), 100),
    country: leaf(node, "country"),
    objectId,
    data,
    queueId: queueRaw && DIGITS.test(queueRaw) ? queueRaw : null,
    operationType,
  }
}

/**
 * By local names only (S:, soap:, ns2: or none, H3): entities decoded,
 * <![CDATA[...]]> removed, also when written as entities (s.16). Null when
 * there is no <return> (a broken body), also for <return xsi:nil="true"/>,
 * which counts as absent (7.5 step 2). An empty <return> with only
 * confirmId gives { confirmId, events: [] } (13b to 13e).
 */
export function parseEventsResponse(xml: string): InfoEventsAnswer | null {
  const body = bodyOf(xml)
  const ret = body ? find(body, "return") : null
  if (!ret) return null
  const events: InfoEvent[] = []
  for (const node of ret.children) {
    if (node.name !== "eventsList" || node.nil) continue
    const event = readEvent(node)
    if (event) events.push(event)
  }
  return { confirmId: leaf(ret, "confirmId"), events }
}

/** <return>true</return> or false; null when unreadable. */
export function parseConfirmResponse(xml: string): boolean | null {
  const body = bodyOf(xml)
  const ret = body ? find(body, "return") : null
  const v = (leafText(ret) ?? "").toLowerCase()
  return v === "true" ? true : v === "false" ? false : null
}

/** faultcode and faultstring of a soap Fault, by local names; null when there is none. */
export function parseFault(xml: string): { faultcode: string | null; faultstring: string | null } | null {
  const body = bodyOf(xml)
  const fault = body ? find(body, "Fault") : null
  if (!fault) return null
  return { faultcode: leaf(fault, "faultcode"), faultstring: leaf(fault, "faultstring") }
}

/** "Access denied", "AuthData" or "Authorization" in the faultstring, case insensitive (H2). */
export function isAuthFault(faultstring: string | null): boolean {
  return /access denied|authdata|authorization/i.test(faultstring ?? "")
}

/* ------------------------------------------------------------------ */
/* eventTime (7.8) and the dedupe key (8.5)                            */
/* ------------------------------------------------------------------ */

const WALL = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

const DAY_MS = 86_400_000

/** The Warsaw wall time of the instant t (to the second) minus t cut to the second: the zone offset at t in ms. */
function warsawOffset(t: number): number {
  const p: Record<string, string> = {}
  for (const part of WALL.formatToParts(new Date(t))) p[part.type] = part.value
  const hour = Number(p.hour) % 24
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second))
  return wall - Math.floor(t / 1000) * 1000
}

const EVENT_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/

/** Warsaw wall time to ISO UTC through Intl.DateTimeFormat (never new Date(str)); T or a space between date and time, seconds and fraction optional; the earlier instant of a doubled hour; null when unreadable (7.8). */
export function warsawToUtc(raw: string): string | null {
  const m = EVENT_TIME.exec(String(raw ?? "").trim())
  if (!m) return null
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number)
  const s = m[6] === undefined ? 0 : Number(m[6])
  const ms = m[7] === undefined ? 0 : Number(m[7].slice(0, 3).padEnd(3, "0"))
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return null
  const probe = new Date(Date.UTC(2000, mo - 1, d, h, mi, s, ms))
  probe.setUTCFullYear(y)
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  const guess = probe.getTime()
  const before = warsawOffset(guess - DAY_MS)
  const after = warsawOffset(guess + DAY_MS)
  const valid = [...new Set([before, after])].map((off) => guess - off).filter((t) => warsawOffset(t) === guess - t)
  /* A doubled hour: the earlier instant (summer time). An hour that does not exist: the offset before the change. */
  const t = valid.length > 0 ? Math.min(...valid) : guess - before
  return new Date(t).toISOString()
}

/** The raw text up to the first dot, separator kept, no parsing ("2018-02-15T15:52:29.886" -> "2018-02-15T15:52:29", 8.5). */
export function eventSecond(raw: string): string {
  const s = String(raw ?? "")
  const dot = s.indexOf(".")
  return dot < 0 ? s : s.slice(0, dot)
}

/** DS5: st:<mode>:<waybill>:<code>:<eventSecond(raw)>:<depot or empty>. */
export function statusDedupeKey(mode: DpdMode, event: Pick<InfoEvent, "waybill" | "code" | "eventTimeRaw" | "depot">): string {
  return `st:${mode}:${event.waybill}:${event.code}:${eventSecond(event.eventTimeRaw)}:${event.depot ?? ""}`
}

/* ------------------------------------------------------------------ */
/* The client (8.1)                                                    */
/* ------------------------------------------------------------------ */

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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

/**
 * POST text/xml; charset=utf-8, SOAPAction "", the pacing slot clock and the
 * AbortController timeout of dpdservices.ts (minGap = 60000 / rpm, refuse
 * with nothingSent past PACING_MAX_WAIT_MS). A Fault at any HTTP status:
 * auth or unclear "fault" (O30). HTTP 2xx with a readable <return>: ok.
 * Anything else: unclear (8.1).
 */
export function createInfoServicesClient(opts: InfoServicesClientOptions): InfoServicesClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const minGap = Math.ceil(60_000 / Math.max(1, opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE))
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const sleep = opts.sleep ?? realSleep
  const headers: Record<string, string> = {
    "content-type": "text/xml; charset=utf-8",
    soapaction: '""',
    accept: "text/xml",
    "user-agent": opts.userAgent ?? `KodaPlus-Medusa-DPD/${KIT_META.version} (+https://koda.plus)`,
  }
  const host = hostOf(opts.url)

  /* Pacing on a clock that moves with the waits, as in dpdservices.ts: one clock per client, so InfoServices and DPDServices never take each other's slots. */
  let nextSlot = 0
  let skew = 0
  const clock = () => Date.now() + skew

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

  /** A text from the server or the transport as a person may read it: the URL (and its host) named as the operation, the password masked, one line, at most 200 characters. */
  function clean(op: InfoServicesOperation, text: string): string {
    let out = String(text ?? "")
    if (opts.url) out = out.split(opts.url).join(op)
    if (host) out = out.split(host).join(op)
    out = maskSecrets(out, [opts.auth.password])
    return clip(out.replace(/\s+/g, " ").trim(), 200)
  }

  /** `[dpd] infoservices <op>: <kind> <http or -> <ms>ms`; the waybill only on the warn line of an unclear answer, never the envelope. */
  function log(op: InfoServicesOperation, outcome: InfoOutcome<unknown>, waybill: string | null): void {
    const line = `[dpd] infoservices ${op}: ${outcome.kind} ${outcome.httpStatus || "-"} ${outcome.ms}ms`
    try {
      if (outcome.kind === "ok") opts.logger?.info(line)
      else opts.logger?.warn(outcome.kind === "unclear" && waybill ? `${line} ${waybill}` : line)
    } catch {
      /* a failing logger never changes the outcome */
    }
  }

  async function call<T>(op: InfoServicesOperation, body: string, parse: (xml: string) => T | null, waybill: string | null): Promise<InfoOutcome<T>> {
    const outcome = await send(op, body, parse)
    log(op, outcome, waybill)
    return outcome
  }

  async function send<T>(op: InfoServicesOperation, body: string, parse: (xml: string) => T | null): Promise<InfoOutcome<T>> {
    if (!(await pace())) {
      return {
        kind: "nothingSent",
        code: "rate_limited",
        message: `Too many InfoServices calls from this server: the next free slot is more than ${PACING_MAX_WAIT_MS / 1000} s away, so nothing was sent.`,
        httpStatus: 0,
        ms: 0,
      }
    }
    const started = Date.now()
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let status = 0
    let text = ""
    try {
      /* redirect "manual": a 3xx is an answer (bad_answer below), never a second POST of the envelope with authDataV1 to the Location (8.1 points 2 and 6). */
      const res = await doFetch(opts.url, { method: "POST", headers: { ...headers }, body, signal: ctrl.signal, redirect: "manual" })
      status = res.status
      text = await res.text()
    } catch (err) {
      const ms = Date.now() - started
      if (ctrl.signal.aborted || isAbort(err)) {
        return { kind: "unclear", code: "timeout", message: `InfoServices ${op} did not answer within ${timeoutMs} ms.`, httpStatus: 0, ms }
      }
      const why = clean(op, errorText(err)).replace(/\.$/, "")
      return { kind: "unclear", code: "network", message: `InfoServices ${op} could not be reached: ${why}.`, httpStatus: 0, ms }
    } finally {
      clearTimeout(timer)
    }
    const ms = Date.now() - started
    /* The parsers never throw; should one ever do, the answer is unclear and nothing leaves the client (InfoOutcome). */
    const unreadable = (): InfoOutcome<T> => ({ kind: "unclear", code: "bad_answer", message: `InfoServices ${op} answered HTTP ${status} that could not be read.`, httpStatus: status, ms })
    /* A Fault first, at any HTTP status (O30). */
    let fault: ReturnType<typeof parseFault>
    try {
      fault = parseFault(text)
    } catch {
      return unreadable()
    }
    if (fault) {
      const faultstring = clean(op, fault.faultstring ?? "").replace(/\.$/, "")
      if (isAuthFault(fault.faultstring)) {
        return { kind: "auth", message: `InfoServices refused the login (${op}): ${faultstring}. Check infoLogin, infoPassword and infoChannel.`, httpStatus: status, ms }
      }
      const faultcode = clean(op, localName(fault.faultcode ?? "")) || "unknown"
      return { kind: "unclear", code: "fault", message: `InfoServices ${op} answered a SOAP Fault (${faultcode}): ${faultstring || "no faultstring"}.`, httpStatus: status, ms }
    }
    if (status >= 200 && status < 300) {
      let value: T | null
      try {
        value = parse(text)
      } catch {
        return unreadable()
      }
      if (value !== null) return { kind: "ok", value, httpStatus: status, ms }
      return { kind: "unclear", code: "bad_answer", message: `InfoServices ${op} answered HTTP ${status} without a readable <return>.`, httpStatus: status, ms }
    }
    if (status >= 500) {
      return { kind: "unclear", code: "server_error", message: `InfoServices ${op} answered HTTP ${status} without a SOAP Fault.`, httpStatus: status, ms }
    }
    /* 3xx, 4xx without a Fault: a gateway, not the check of authDataV1 (O30). */
    return { kind: "unclear", code: "bad_answer", message: `InfoServices ${op} answered HTTP ${status} without a readable <return>.`, httpStatus: status, ms }
  }

  return {
    async getEventsForWaybill(waybill, select = "ALL") {
      const op = INFOSERVICES_OPERATIONS.waybill
      const trimmed = String(waybill ?? "").trim()
      if (trimmed === "") {
        const outcome: WaybillEventsOutcome = { kind: "unclear", code: "bad_answer", message: `${op}: empty waybill`, httpStatus: 0, ms: 0 }
        log(op, outcome, null)
        return outcome
      }
      return call(op, waybillEventsEnvelope(trimmed, select, INFOSERVICES_LANGUAGE, opts.auth), parseEventsResponse, trimmed)
    },
    async getEventsForCustomerV4(limit = INFOSERVICES_QUEUE_LIMIT) {
      return call(INFOSERVICES_OPERATIONS.customer, customerEventsEnvelope(limit, INFOSERVICES_LANGUAGE, opts.auth), parseEventsResponse, null)
    },
    async markEventsAsProcessed(confirmId) {
      const op = INFOSERVICES_OPERATIONS.confirm
      const id = String(confirmId ?? "").trim()
      if (id === "" || id === "0") {
        const outcome: ConfirmOutcome = { kind: "unclear", code: "bad_answer", message: `${op}: no confirmId`, httpStatus: 0, ms: 0 }
        log(op, outcome, null)
        return outcome
      }
      return call(op, confirmEnvelope(id, opts.auth), (xml) => {
        const confirmed = parseConfirmResponse(xml)
        return confirmed === null ? null : { confirmed }
      }, null)
    },
  }
}

/** The host of a URL, or null when it is not one. */
function hostOf(url: string): string | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(url ?? ""))
  return m ? m[1] : null
}

/* ------------------------------------------------------------------ */
/* The status source (DS15)                                            */
/* ------------------------------------------------------------------ */

/** demo and sandbox: simulated; live with infoLogin, infoPassword and infoChannel: dpd; live without one: off. Full body from step 0. */
export function statusSourceOf(o: Pick<ResolvedDpdOptions, "demo" | "mode" | "infoLogin" | "infoPassword" | "infoChannel">): StatusSource {
  if (o.demo || o.mode !== "live") return "simulated"
  return o.infoLogin && o.infoPassword && o.infoChannel ? "dpd" : "off"
}

/** The problems the options alone give: statuses_not_configured (source off), tracking_mode_queue_unsupported (trackingMode queue, DS7). Full body from step 0. */
export function statusOptionProblems(
  o: Pick<ResolvedDpdOptions, "demo" | "mode" | "infoLogin" | "infoPassword" | "infoChannel" | "trackingMode">,
): Array<"statuses_not_configured" | "tracking_mode_queue_unsupported"> {
  const out: Array<"statuses_not_configured" | "tracking_mode_queue_unsupported"> = []
  if (statusSourceOf(o) === "off") out.push("statuses_not_configured")
  if (o.trackingMode === "queue") out.push("tracking_mode_queue_unsupported")
  return out
}
