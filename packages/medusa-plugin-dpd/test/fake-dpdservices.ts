/**
 * A fake DPDServices behind `fetch` (this file is not a test itself). It
 * answers in the shapes the sandbox gave (test/fixtures/dpdservices, from
 * docs/sandbox/fakty-sandbox.md): HTTP Basic and a numeric `x-dpd-fid`, the
 * payer FID bound to the account, Bean Validation for a weight under 0.01 kg
 * and for a COD outside PLN, INCORRECT_DATA for a postal code that is not
 * all digits, duplicates of a package or parcel reference, labels found by
 * the package reference, a parcel reference, a waybill or the session.
 * DPD Pickup as fixtures 10a to 10m show it: one box (Bean 10b), at most
 * 20 kg (Bean 10g), a phone or an e-mail (Bean 10f, both errors), a point it
 * knows (`pudoIds`, PL14509 like the demo host; else INCORRECT_DATA 10c with
 * the three receiver codes before INCORRECT_PUDO).
 *
 *   failNext(op, failure)  the next call of the operation times out, loses
 *                          the network, loses the answer AFTER DPD stored
 *                          the package, or answers a given status and body
 *   seedPackage            a package that already exists in DPD
 *   calls, count           every fetch the client made
 *
 * Nothing here ever reaches a network.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DPDSERVICES_HOSTS, DPDSERVICES_PATHS } from "../src/modules/dpd/lib/constants.ts"
import { simpleLabelPdf } from "../src/modules/dpd/lib/pdf.ts"

/** base64 of simpleLabelPdf([{ text: "test" }], "A4"): what the fake gives as documentData. */
export const TINY_PDF_BASE64: string = Buffer.from(simpleLabelPdf([{ text: "test" }], "A4")).toString("base64")

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dpdservices")

export type Fixture = {
  request: { method: string; path: string; headers: Record<string, string>; body: unknown }
  response: { httpStatus: number; headers: Record<string, string>; body: unknown }
}

/** A masked sandbox fixture by its name ("01-numbers-ok", with or without ".json"). */
export function loadFixture(name: string): Fixture {
  const file = join(FIXTURES, name.endsWith(".json") ? name : `${name}.json`)
  return JSON.parse(readFileSync(file, "utf8")) as Fixture
}

export type FakeFailure = "timeout" | "network" | "lose_answer" | { status: number; body?: unknown; text?: string }

type Op = "numbers" | "labels"
type Obj = Record<string, unknown>
type StoredPackage = { sessionId: number; parcels: Array<{ reference: string; waybill: string }> }

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : ""
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(init?.headers).forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

function abortError(): Error {
  const err = new Error("This operation was aborted")
  err.name = "AbortError"
  return err
}

export class FakeDpdServices {
  readonly host: string
  readonly login: string
  readonly password: string
  readonly payerFids: number[]
  readonly pudoIds: string[]
  calls: Array<{ op: Op; headers: Record<string, string>; body: unknown }> = []
  packages: Map<string, StoredPackage> = new Map()
  private failures: Record<Op, FakeFailure[]> = { numbers: [], labels: [] }
  private sessionCounter = 244462950
  private waybillCounter = 0
  private traceCounter = 0

  constructor(opts: { login?: string; password?: string; payerFids?: number[]; pudoIds?: string[] } = {}) {
    this.host = DPDSERVICES_HOSTS.sandbox
    this.login = opts.login ?? "koda-test"
    this.password = opts.password ?? "test-password-koda-0000"
    this.payerFids = opts.payerFids ?? [1000]
    this.pudoIds = opts.pudoIds ?? ["PL14509"]
  }

  failNext(op: Op, failure: FakeFailure): void {
    this.failures[op].push(failure)
  }

  count(op: Op): number {
    return this.calls.filter((c) => c.op === op).length
  }

  /** A package that already exists in DPD (for the duplicate and lookup tests); returns its waybills. */
  seedPackage(reference: string, boxes: number): string[] {
    const parcels = Array.from({ length: boxes }, (_, i) => ({ reference: `${reference}-${i + 1}`, waybill: this.nextWaybill() }))
    this.packages.set(reference, { sessionId: ++this.sessionCounter, parcels })
    return parcels.map((p) => p.waybill)
  }

  /** Arrow property, pass as fetchImpl. */
  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(`${this.host}/`)) throw new Error(`test: the client called a host outside the fake: ${url}`)
    const path = url.slice(this.host.length)
    const op: Op | null = path === DPDSERVICES_PATHS.numbers ? "numbers" : path === DPDSERVICES_PATHS.labels ? "labels" : null
    if (!op) throw new Error(`test: the client called an unknown path: ${path}`)
    const headers = headersOf(init)
    let body: unknown = null
    try {
      body = JSON.parse(typeof init?.body === "string" ? init.body : "null")
    } catch {
      body = null
    }
    this.calls.push({ op, headers, body })

    const failure = this.failures[op].shift()
    if (failure === "timeout") throw abortError()
    if (failure === "network") throw new Error("socket hang up")
    if (failure && typeof failure === "object") {
      const text = failure.body !== undefined ? JSON.stringify(failure.body) : (failure.text ?? "")
      return new Response(text, { status: failure.status, headers: { "content-type": "application/json" } })
    }
    const res = this.answer(op, headers, body)
    if (failure === "lose_answer") throw new Error("socket hang up")
    return res
  }

  private nextWaybill(): string {
    this.waybillCounter += 1
    return `0000899${String(this.waybillCounter).padStart(6, "0")}Q`
  }

  private trace(): string {
    this.traceCounter += 1
    return `fake-trace-${this.traceCounter}`
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  }

  private answer(op: Op, headers: Record<string, string>, body: unknown): Response {
    const basic = `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`
    if (headers.authorization !== basic || !/^\d+$/.test(headers["x-dpd-fid"] ?? "")) {
      return new Response("", { status: 401, headers: { "content-type": "application/json", "www-authenticate": 'Basic realm="DPDServicesRealm"' } })
    }
    return op === "numbers" ? this.numbers(body) : this.labels(body)
  }

  private numbers(body: unknown): Response {
    const packages = list(obj(body)?.packages).map((p) => obj(p) ?? {})
    for (const pkg of packages) {
      const payer = Number(pkg.payerFID)
      if (!this.payerFids.includes(payer)) {
        return this.json(403, { status: "DISALLOWED_FID", sessionId: null, beginTime: null, endTime: null, packages: [], traceId: this.trace() })
      }
    }
    const errors: Array<{ userMessage: string; field: string }> = []
    packages.forEach((pkg, i) => {
      list(pkg.parcels).forEach((p, j) => {
        const weight = Number(obj(p)?.weight)
        if (!(weight >= 0.01)) errors.push({ userMessage: "must be greater than or equal to 0.01", field: `packages[${i}].parcels[${j}].weight` })
      })
      list(pkg.services).forEach((s, j) => {
        const service = obj(s)
        if (service?.code !== "COD") return
        const currency = list(service.attributes).map((a) => obj(a)).find((a) => a?.code === "CURRENCY")?.value
        if (currency !== "PLN") errors.push({ userMessage: "Domestic COD requires PLN currency", field: `packages[${i}].services[${j}]` })
      })
    })
    if (errors.length > 0) return this.json(400, { errors, traceId: this.trace() })
    for (const pkg of packages) {
      const pickup = this.pickupRefusal(pkg)
      if (pickup) return pickup
    }
    for (const pkg of packages) {
      /* The receiver postal code rule only for a courier package: a Pickup package has no receiver. */
      if (!obj(pkg.receiver)) continue
      const postal = str(obj(pkg.receiver)?.postalCode)
      if (!/^\d+$/.test(postal)) {
        return this.json(400, {
          status: "INCORRECT_DATA",
          sessionId: null,
          beginTime: null,
          endTime: null,
          packages: [
            {
              status: "INCORRECT_DATA",
              reference: str(pkg.reference),
              validationInfo: [{ errorCode: "INCORRECT_RECEIVER_POSTAL_CODE", info: `Incorrect receiver postal code: (${postal})` }],
              parcels: list(pkg.parcels).map((p) => ({ status: "OK", reference: str(obj(p)?.reference), waybill: null, validationInfo: [] })),
            },
          ],
          traceId: this.trace(),
        })
      }
    }
    const usedParcels = new Set([...this.packages.values()].flatMap((p) => p.parcels.map((x) => x.reference)))
    for (const pkg of packages) {
      const parcelTaken = list(pkg.parcels).some((p) => usedParcels.has(str(obj(p)?.reference)))
      const packageTaken = this.packages.has(str(pkg.reference))
      if (parcelTaken || packageTaken) {
        return this.json(400, {
          status: parcelTaken ? "DUPLICATED_PARCEL_REFERENCE" : "DUPLICATED_PACKAGE_REFERENCE",
          sessionId: null,
          beginTime: null,
          endTime: null,
          packages: [],
          traceId: this.trace(),
        })
      }
    }
    const sessionId = ++this.sessionCounter
    const out = packages.map((pkg) => {
      const parcels = list(pkg.parcels).map((p) => ({ reference: str(obj(p)?.reference), waybill: this.nextWaybill() }))
      this.packages.set(str(pkg.reference), { sessionId, parcels })
      return {
        status: "OK",
        reference: str(pkg.reference),
        validationInfo: [],
        parcels: parcels.map((p) => ({ status: "OK", reference: p.reference, waybill: p.waybill, validationInfo: [] })),
      }
    })
    return this.json(200, { status: "OK", sessionId, beginTime: null, endTime: null, packages: out, traceId: this.trace() })
  }

  /** The Pickup rules in the order the demo host applied them (10b, 10g, 10f, 10c); null when the package passes or is no Pickup. */
  private pickupRefusal(pkg: Obj): Response | null {
    const service = list(pkg.services).map((s) => obj(s)).find((s) => s?.code === "DPD_PICKUP")
    if (!obj(pkg.pudoReceiver) || !service) return null
    const parcels = list(pkg.parcels)
    if (parcels.length > 1) {
      return this.json(400, { errors: [{ userMessage: "Domestic DPD_PICKUP service is available only for single parcel shipments", field: "packages[0].services[0]" }], traceId: this.trace() })
    }
    if (parcels.some((p) => Number(obj(p)?.weight) > 20)) {
      return this.json(400, { errors: [{ userMessage: "The DPD_PICKUP service is unavailable for parcels from 20 kg", field: "packages[0].services[0]" }], traceId: this.trace() })
    }
    const receiver = obj(pkg.pudoReceiver) ?? {}
    if (!str(receiver.phone) && !str(receiver.email)) {
      return this.json(400, {
        errors: [
          { userMessage: "Name or company is required", field: "packages[0].pudoReceiver" },
          { userMessage: "Pudo receiver phone or email is needed with DPD_PICKUP service", field: "packages[0].services[0]" },
        ],
        traceId: this.trace(),
      })
    }
    const pudo = str(list(service.attributes).map((a) => obj(a)).find((a) => a?.code === "PUDO")?.value)
    if (!this.pudoIds.includes(pudo)) {
      return this.json(400, {
        status: "INCORRECT_DATA",
        sessionId: null,
        beginTime: null,
        endTime: null,
        packages: [
          {
            status: "INCORRECT_DATA",
            reference: str(pkg.reference),
            validationInfo: [
              { errorCode: "INCORRECT_RECEIVER_ADDRESS", info: "Adres odbiorcy jest wymagany" },
              { errorCode: "INCORRECT_RECEIVER_CITY", info: "Miasto odbiorcy jest wymagane" },
              { errorCode: "INCORRECT_RECEIVER_POSTAL_CODE", info: "Kod pocztowy odbiorcy jest wymagany" },
              { errorCode: "INCORRECT_PUDO", info: "Incorrect pudo identifier" },
            ],
            parcels: parcels.map((p) => ({ status: "OK", reference: str(obj(p)?.reference), waybill: null, validationInfo: [] })),
          },
        ],
        traceId: this.trace(),
      })
    }
    return null
  }

  private labels(body: unknown): Response {
    const session = obj(obj(obj(body)?.labelSearchParams)?.session)
    const found: Array<{ reference: string | null; parcels: Array<{ reference: string | null; waybill: string }> }> = []
    let missing = false
    const sessionId = Number(session?.sessionId)
    if (Number.isFinite(sessionId) && session?.sessionId !== undefined && session?.sessionId !== null) {
      const hits = [...this.packages.entries()].filter(([, p]) => p.sessionId === sessionId)
      if (hits.length === 0) missing = true
      for (const [reference, p] of hits) found.push({ reference, parcels: p.parcels.map((x) => ({ reference: x.reference, waybill: x.waybill })) })
    }
    for (const raw of list(session?.packages)) {
      const want = obj(raw) ?? {}
      const reference = str(want.reference)
      if (reference) {
        const p = this.packages.get(reference)
        if (!p) missing = true
        else found.push({ reference, parcels: p.parcels.map((x) => ({ reference: null, waybill: x.waybill })) })
        continue
      }
      const parcels: Array<{ reference: string | null; waybill: string }> = []
      for (const rawParcel of list(want.parcels)) {
        const wantParcel = obj(rawParcel) ?? {}
        const byWaybill = str(wantParcel.waybill)
        const byReference = str(wantParcel.reference)
        const hit = [...this.packages.values()].flatMap((p) => p.parcels).find((x) => (byWaybill && x.waybill === byWaybill) || (byReference && x.reference === byReference))
        if (!hit) missing = true
        else parcels.push({ reference: byReference ? hit.reference : null, waybill: hit.waybill })
      }
      if (parcels.length > 0) found.push({ reference: null, parcels })
    }
    if (missing || found.length === 0) {
      return this.json(404, { status: "NOT_FOUND", documentData: null, session: { statusInfo: { status: "NOT_FOUND" }, packages: [] }, documentId: null, traceId: this.trace() })
    }
    return this.json(200, {
      status: "OK",
      documentData: TINY_PDF_BASE64,
      session: {
        statusInfo: { status: "OK" },
        packages: found.map((p) => ({
          reference: p.reference,
          statusInfo: { status: "OK" },
          parcels: p.parcels.map((x) => ({ reference: x.reference, waybill: x.waybill, statusInfo: { status: "OK" } })),
        })),
      },
      documentId: null,
      traceId: this.trace(),
    })
  }
}
