/**
 * A fake InfoServices behind `fetch` (this file is not a test itself): it
 * answers getEventsForWaybillV1 by a script, builds the XML of events and of
 * a Fault, and reads the masked fixtures of test/fixtures/infoservices. The
 * envelope it records is checked in tests, never logged.
 *
 * Nothing here ever reaches a network.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { InfoEvent } from "../src/modules/dpd/lib/infoservices.ts"

export type FakeInfoRequest = { operation: string; waybill: string | null; select: string | null; body: string }
export type FakeInfoAnswer = { status?: number; body: string } | { fixture: string; status?: number } | { fail: "timeout" | "network" }

/* The namespace of the answers, as INFOSERVICES_NAMESPACE (infoservices.test.ts pins that both agree). */
const NS = "http://events.dpdinfoservices.dpd.com.pl/"
const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/"
const FIXTURES = join(import.meta.dirname, "fixtures", "infoservices")

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

/** The text of the first element with this local name (any prefix), or null. */
function tagText(xml: string, local: string): string | null {
  const m = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${local}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z_][\\w.-]*:)?${local}>`).exec(xml)
  return m ? m[1].trim() : null
}

/** The local name of the first element inside Body. */
function operationOf(xml: string): string {
  const body = /<(?:[A-Za-z_][\w.-]*:)?Body(?:\s[^>]*)?>/.exec(xml)
  if (!body) return ""
  const first = /<(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)/.exec(xml.slice(body.index + body[0].length))
  return first ? first[2] : ""
}

function abortError(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason
  const err = new Error("This operation was aborted")
  err.name = "AbortError"
  return err
}

/** A fetch answering by a script; records every request (the envelope is checked in tests, never logged). */
export function createFakeInfoServices(answer: (req: FakeInfoRequest) => FakeInfoAnswer): { fetchImpl: typeof fetch; calls: FakeInfoRequest[] } {
  const calls: FakeInfoRequest[] = []
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === "string" ? init.body : init?.body ? await new Response(init.body).text() : ""
    const req: FakeInfoRequest = { operation: operationOf(body), waybill: tagText(body, "waybill"), select: tagText(body, "eventsSelectType"), body }
    calls.push(req)
    const a = answer(req)
    if ("fail" in a) {
      if (a.fail === "network") throw new TypeError("fetch failed")
      const signal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return
        if (signal.aborted) return reject(abortError(signal))
        signal.addEventListener("abort", () => reject(abortError(signal)), { once: true })
      })
    }
    const { status, body: text } = "fixture" in a ? { ...loadInfoFixture(a.fixture), ...(a.status === undefined ? {} : { status: a.status }) } : { status: a.status ?? 200, body: a.body }
    return new Response(text, { status, headers: { "content-type": "text/xml;charset=UTF-8" } })
  }) as typeof fetch
  return { fetchImpl, calls }
}

/** A getEventsForWaybillV1 response with the given events (prefix S, soap, ns2 or none; eventDataList values as given). */
export function eventsXml(
  events: ReadonlyArray<
    Pick<InfoEvent, "waybill" | "code" | "eventTimeRaw"> &
      Partial<Pick<InfoEvent, "description" | "depot" | "depotName" | "country" | "objectId">> & { data?: Array<{ code: string; value: string }> }
  >,
  opts?: { prefix?: "S" | "soap" | "ns2" | ""; confirmId?: string },
): string {
  const prefix = opts?.prefix ?? "S"
  const p = prefix === "" ? "" : `${prefix}:`
  const nsAttr = prefix === "" ? `xmlns="${SOAP_NS}"` : `xmlns:${prefix}="${SOAP_NS}"`
  /* With prefix ns2 the envelope already owns ns2, so the answer element takes another prefix. */
  const rp = prefix === "ns2" ? "ns3" : "ns2"
  const opt = (name: string, v: string | null | undefined) => (v === undefined || v === null ? [] : [`<${name}>${esc(v)}</${name}>`])
  const list = events.map((e) =>
    [
      `<eventsList>`,
      `<businessCode>${esc(e.code)}</businessCode>`,
      ...opt("country", e.country),
      ...opt("depot", e.depot),
      ...opt("depotName", e.depotName),
      ...opt("description", e.description),
      ...(e.data ?? []).map((d) => `<eventDataList><code>${esc(d.code)}</code><value>${esc(d.value)}</value></eventDataList>`),
      `<eventTime>${esc(e.eventTimeRaw)}</eventTime>`,
      ...opt("objectId", e.objectId === undefined ? "0" : e.objectId),
      `<packageReference/>`,
      `<parcelReference/>`,
      `<waybill>${esc(e.waybill)}</waybill>`,
      `</eventsList>`,
    ].join(""),
  )
  return [
    `<${p}Envelope ${nsAttr}>`,
    `<${p}Body>`,
    `<${rp}:getEventsForWaybillV1Response xmlns:${rp}="${NS}">`,
    `<return>`,
    `<confirmId>${esc(opts?.confirmId ?? "0")}</confirmId>`,
    ...list,
    `</return>`,
    `</${rp}:getEventsForWaybillV1Response>`,
    `</${p}Body>`,
    `</${p}Envelope>`,
  ].join("\n")
}

/** A SOAP Fault with faultcode soap:Server; the caller sets the status (500). */
export function faultXml(faultstring: string): string {
  return [
    `<soap:Envelope xmlns:soap="${SOAP_NS}">`,
    `<soap:Body>`,
    `<soap:Fault>`,
    `<faultcode>soap:Server</faultcode>`,
    `<faultstring>${esc(faultstring)}</faultstring>`,
    `</soap:Fault>`,
    `</soap:Body>`,
    `</soap:Envelope>`,
  ].join("\n")
}

/** test/fixtures/infoservices/<name>: the status of its first line <!-- HTTP n --> (200 when absent), the body after it. */
export function loadInfoFixture(name: string): { status: number; body: string } {
  const text = readFileSync(join(FIXTURES, name), "utf8")
  const m = /^<!-- HTTP (\d{3}) -->\r?\n/.exec(text)
  if (!m) return { status: 200, body: text }
  return { status: Number(m[1]), body: text.slice(m[0].length) }
}
