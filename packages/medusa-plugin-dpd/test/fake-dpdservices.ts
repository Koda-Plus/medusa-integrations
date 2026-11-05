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
 * Stage 4 (spec 14.3): generateProtocol as 05a, 11h, 11k and 11l show it,
 * courierOrderAvailability as 11a to 11e, and packagesPickupCall POST, PATCH
 * and DELETE in two modes: "demo" is the DPD test host as observed (12a: every
 * valid order is UNKNOWN_ERROR without a number; 12u and 12v: a PATCH or
 * DELETE of an unknown order is 500), "works" a courier that answers in the
 * OpenAPI shapes [NZ] (an order number, a checkSum, VALIDATION_ERROR codes).
 *
 *   failNext(op, failure)  the next call of the operation times out, loses
 *                          the network, loses the answer AFTER DPD stored
 *                          the package, or answers a given status and body
 *   seedPackage            a package that already exists in DPD
 *   closeOrder             a courier order DPD closed ("works")
 *   calls, count           every fetch the client made
 *
 * Nothing here ever reaches a network.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { COURIER_CHECKSUM_MAX, COURIER_CHECKSUM_MIN, COURIER_ORDER_MAX_KG, DPDSERVICES_HOSTS, DPDSERVICES_PATHS } from "../src/modules/dpd/lib/constants.ts"
import { warsawDate } from "../src/modules/dpd/lib/courier.ts"
import { simpleLabelPdf } from "../src/modules/dpd/lib/pdf.ts"

/** base64 of simpleLabelPdf([{ text: "test" }], "A4"): what the fake gives as documentData. */
export const TINY_PDF_BASE64: string = Buffer.from(simpleLabelPdf([{ text: "test" }], "A4")).toString("base64")

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "dpdservices")

export type Fixture = {
  request: { method: string; path: string; query?: Record<string, string>; headers: Record<string, string>; body: unknown }
  response: { httpStatus: number; headers: Record<string, string>; body: unknown }
}

/** A masked sandbox fixture by its name ("01-numbers-ok", with or without ".json"). */
export function loadFixture(name: string): Fixture {
  const file = join(FIXTURES, name.endsWith(".json") ? name : `${name}.json`)
  return JSON.parse(readFileSync(file, "utf8")) as Fixture
}

export type FakeFailure = "timeout" | "network" | "lose_answer" | { status: number; body?: unknown; text?: string }

export type FakeOp = "numbers" | "labels" | "protocol" | "availability" | "pickupCreate" | "pickupUpdate" | "pickupDelete"
type FakeOrder = { checkSum: string; pickupDate: string; pickupTimeFrom: string; pickupTimeTo: string; parcels: number; closed: boolean; canceled: boolean }
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
  readonly courier: "demo" | "works"
  readonly ranges: Array<{ range: string; offset: number | null }>
  readonly noRange: string[]
  readonly now: () => Date
  /** headers stays (the FID header tests read it); method, path and query are the request as sent. */
  calls: Array<{ op: FakeOp; method: string; path: string; query: Record<string, string> | null; headers: Record<string, string>; body: unknown }> = []
  packages: Map<string, StoredPackage> = new Map()
  readonly protocols: Array<{ documentId: string; references: string[]; waybills: string[] }> = []
  readonly orders: Map<string, FakeOrder> = new Map()
  /** A PATCH rotates the checkSum (default); false keeps it, as the sandbox simulator does. Either is [NZ] for live (DS13). */
  rotateCheckSum = true
  private failures: Record<FakeOp, FakeFailure[]> = { numbers: [], labels: [], protocol: [], availability: [], pickupCreate: [], pickupUpdate: [], pickupDelete: [] }
  private sessionCounter = 244462950
  private waybillCounter = 0
  private traceCounter = 0
  private documentCounter = 203216917
  private orderCounter = 2026000000
  private checkSumCounter = 0

  constructor(
    opts: {
      login?: string
      password?: string
      payerFids?: number[]
      pudoIds?: string[]
      /** "demo" (default): the DPD test host as observed (12a and friends). "works": a courier that answers OK [NZ]. */
      courier?: "demo" | "works"
      /** availability ranges for a five digit zipCode; default those of 11a. */
      ranges?: Array<{ range: string; offset: number | null }>
      /** zipCodes with RANGE_NOT_FOUND [NZ]. */
      noRange?: string[]
      now?: () => Date
    } = {},
  ) {
    this.host = DPDSERVICES_HOSTS.sandbox
    this.login = opts.login ?? "koda-test"
    this.password = opts.password ?? "test-password-koda-0000"
    this.payerFids = opts.payerFids ?? [1000]
    this.pudoIds = opts.pudoIds ?? ["PL14509"]
    this.courier = opts.courier ?? "demo"
    this.ranges = opts.ranges ?? [
      { offset: 360, range: "09:00-17:00" },
      { offset: 180, range: "11:00-14:00" },
      { offset: 180, range: "14:00-17:00" },
    ]
    this.noRange = opts.noRange ?? []
    this.now = opts.now ?? (() => new Date())
  }

  failNext(op: FakeOp, failure: FakeFailure): void {
    this.failures[op].push(failure)
  }

  count(op: FakeOp): number {
    return this.calls.filter((c) => c.op === op).length
  }

  /** A package that already exists in DPD (for the duplicate and lookup tests); returns its waybills. */
  seedPackage(reference: string, boxes: number): string[] {
    const parcels = Array.from({ length: boxes }, (_, i) => ({ reference: `${reference}-${i + 1}`, waybill: this.nextWaybill() }))
    this.packages.set(reference, { sessionId: ++this.sessionCounter, parcels })
    return parcels.map((p) => p.waybill)
  }

  /** A courier order DPD closed (the courier is on the way): PATCH and DELETE get ORDER_CLOSED_STATUS ("works"). */
  closeOrder(orderNumber: string): void {
    const order = this.orders.get(orderNumber)
    if (order) order.closed = true
  }

  /** Arrow property, pass as fetchImpl. */
  fetch: typeof fetch = async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (!href.startsWith(`${this.host}/`)) throw new Error(`test: the client called a host outside the fake: ${href}`)
    const url = new URL(href)
    const path = url.pathname
    const method = (init?.method ?? "GET").toUpperCase()
    const op = opOf(method, path)
    if (!op) throw new Error(`test: the client called an unknown path or method: ${method} ${path}`)
    const query = url.search ? Object.fromEntries(url.searchParams) : null
    const headers = headersOf(init)
    if ((method === "GET" || method === "DELETE") && init?.body !== undefined && init.body !== null) {
      throw new Error(`test: the client sent a body with ${method} ${path}`)
    }
    let body: unknown = null
    try {
      body = JSON.parse(typeof init?.body === "string" ? init.body : "null")
    } catch {
      body = null
    }
    this.calls.push({ op, method, path, query, headers, body })

    const failure = this.failures[op].shift()
    if (failure === "timeout") throw abortError()
    if (failure === "network") throw new Error("socket hang up")
    if (failure && typeof failure === "object") {
      const text = failure.body !== undefined ? JSON.stringify(failure.body) : (failure.text ?? "")
      return new Response(text, { status: failure.status, headers: { "content-type": "application/json" } })
    }
    const res = this.answer(op, headers, body, query ?? {})
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

  private answer(op: FakeOp, headers: Record<string, string>, body: unknown, query: Record<string, string>): Response {
    const basic = `Basic ${Buffer.from(`${this.login}:${this.password}`).toString("base64")}`
    if (headers.authorization !== basic || !/^\d+$/.test(headers["x-dpd-fid"] ?? "")) {
      return new Response("", { status: 401, headers: { "content-type": "application/json", "www-authenticate": 'Basic realm="DPDServicesRealm"' } })
    }
    switch (op) {
      case "numbers":
        return this.numbers(body)
      case "labels":
        return this.labels(body)
      case "protocol":
        return this.protocol(body)
      case "availability":
        return this.availability(query)
      case "pickupCreate":
        return this.pickupCreate(body)
      case "pickupUpdate":
        return this.pickupChange("update", obj(body) ?? {})
      case "pickupDelete":
        return this.pickupChange("delete", query)
    }
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

  /** A fixture's answer body with a fresh traceId of the fake. */
  private fixture(name: string): Response {
    const f = loadFixture(name)
    const body = obj(f.response.body)
    return this.json(f.response.httpStatus, body ? { ...body, traceId: this.trace() } : f.response.body)
  }

  /** generateProtocol in the order the demo host checked (11l, 11k, 11h, then 05a). */
  private protocol(body: unknown): Response {
    const params = obj(obj(body)?.protocolSearchParams)
    const session = obj(params?.session)
    const wanted = list(session?.packages).map((p) => obj(p) ?? {})
    const notProcessed = wanted.map((p) => ({ reference: str(p.reference) || null, statusInfo: { status: "NOT_PROCESSED" }, parcels: [] }))
    if (str(session?.type) !== "DOMESTIC") {
      return this.json(400, {
        status: "INCORRECT_DATA",
        documentData: "",
        session: { statusInfo: { status: "INCORRECT_SESSION_TYPE", description: "Chosen packages are not suitable for session type" }, packages: notProcessed },
        documentId: null,
        traceId: this.trace(),
      })
    }
    if (!this.payerFids.includes(Number(obj(params?.pickupAddress)?.fid))) {
      return this.json(400, {
        status: "INCORRECT_DATA",
        documentData: "",
        session: { statusInfo: { status: "ACCESS_DENIED_FOR_FID", description: "Access denied for pickup fid (PickupAddress/FID)" }, packages: notProcessed },
        documentId: null,
        traceId: this.trace(),
      })
    }
    const known = (p: Obj): StoredPackage | null => {
      const reference = str(p.reference)
      if (reference) return this.packages.get(reference) ?? null
      const waybills = list(p.parcels).map((x) => str(obj(x)?.waybill))
      const all = [...this.packages.values()]
      return all.find((pkg) => waybills.length > 0 && waybills.every((w) => pkg.parcels.some((x) => x.waybill === w))) ?? null
    }
    this.documentCounter += 1
    const documentId = String(this.documentCounter)
    if (wanted.some((p) => known(p) === null)) {
      return this.json(400, {
        status: "INCORRECT_DATA",
        documentData: "",
        session: {
          statusInfo: { status: "NOT_FOUND" },
          packages: wanted.map((p) => ({ reference: str(p.reference) || null, statusInfo: { status: known(p) ? "OK" : "NOT_FOUND" }, parcels: [] })),
        },
        documentId,
        traceId: this.trace(),
      })
    }
    const references = wanted.map((p) => str(p.reference)).filter(Boolean)
    const waybills = wanted.flatMap((p) => known(p)?.parcels.map((x) => x.waybill) ?? [])
    this.protocols.push({ documentId, references, waybills })
    return this.json(200, {
      status: "OK",
      documentData: TINY_PDF_BASE64,
      session: { statusInfo: { status: "OK" }, packages: wanted.map((p) => ({ reference: str(p.reference) || null, statusInfo: { status: "OK" }, parcels: [] })) },
      documentId,
      traceId: this.trace(),
    })
  }

  /** courierOrderAvailability: 11b and 11d for a code that is not five digits, 11e for another country, RANGE_NOT_FOUND [NZ], else 11a. */
  private availability(query: Record<string, string>): Response {
    const zip = query.zipCode ?? ""
    if (!/^\d{5}$/.test(zip)) return this.fixture(/^[\d-]+$/.test(zip) ? "11b-avail-dash" : "11d-avail-letters")
    if (query.countryCode !== "PL") return this.fixture("11e-avail-de")
    if (this.noRange.includes(zip)) return this.json(404, { status: "RANGE_NOT_FOUND", ranges: [], traceId: this.trace() })
    return this.json(200, { status: "OK", ranges: this.ranges.map((r) => ({ offset: r.offset, range: r.range })), traceId: this.trace() })
  }

  private today(): string {
    return warsawDate(this.now())
  }

  /** The Bean answers of the demo host for an order (12d, 12g) and the payer check (12h), in that order; null when the body passes. */
  private orderRefusal(body: Obj): Response | null {
    const date = str(body.pickupDate)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < this.today()) return this.fixture("12d-order-yesterday")
    const parcel = obj(obj(obj(body.packagesForCollection)?.packagesParams)?.parcel)
    if (Number(parcel?.maxWeight) > COURIER_ORDER_MAX_KG) return this.fixture("12g-order-maxweight-51")
    const payer = Number(obj(obj(body.packagesForCollection)?.payer)?.number)
    if (!this.payerFids.includes(payer)) return this.fixture("12h-order-wrong-payer")
    return null
  }

  private statusAnswer(status: number, code: string, details: Array<{ code: string; fields: string }> = []): Response {
    return this.json(status, {
      orderNumber: null,
      checkSum: "null",
      status: { status: code, errorDetails: details.map((d) => ({ code: d.code, description: null, fields: `${d.fields};` })) },
      traceId: this.trace(),
    })
  }

  private nextCheckSum(): string {
    this.checkSumCounter += 1
    return String(10_000_000 + ((this.checkSumCounter * 7_919_011) % 90_000_000))
  }

  private pickupCreate(body: unknown): Response {
    const b = obj(body) ?? {}
    const refusal = this.orderRefusal(b)
    if (refusal) return refusal
    if (this.courier === "demo") return this.fixture("12a-order")
    this.orderCounter += 1
    const orderNumber = String(this.orderCounter)
    const checkSum = this.nextCheckSum()
    const parcels = Number(obj(obj(obj(b.packagesForCollection)?.packagesParams)?.parcel)?.count) || 0
    this.orders.set(orderNumber, {
      checkSum,
      pickupDate: str(b.pickupDate),
      pickupTimeFrom: str(b.pickupTimeFrom),
      pickupTimeTo: str(b.pickupTimeTo),
      parcels,
      closed: false,
      canceled: false,
    })
    return this.json(200, { orderNumber, checkSum, status: { status: "OK", errorDetails: [] }, traceId: this.trace() })
  }

  /** PATCH (the body) and DELETE (the query) of packagesPickupCall. */
  private pickupChange(op: "update" | "delete", input: Obj | Record<string, string>): Response {
    const orderNumber = str(input.orderNumber)
    const checkSum = str(input.checkSum)
    if (checkSum.length < COURIER_CHECKSUM_MIN || checkSum.length > COURIER_CHECKSUM_MAX) {
      return this.json(400, {
        errors: [{ userMessage: `size must be between ${COURIER_CHECKSUM_MIN} and ${COURIER_CHECKSUM_MAX}`, field: op === "delete" ? "packagesPickupCallDelete.checkSum" : "checkSum" }],
        traceId: this.trace(),
      })
    }
    /* The test host knows no order (every POST ended UNKNOWN_ERROR): 12u and 12v. */
    if (this.courier === "demo") return this.fixture(op === "update" ? "12u-patch-unknown-order" : "12v-delete-unknown-order")
    if (op === "update") {
      const date = str(input.pickupDate)
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < this.today()) return this.fixture("12d-order-yesterday")
    }
    const order = this.orders.get(orderNumber)
    if (!order) return this.statusAnswer(400, "NOT_FOUND")
    if (order.checkSum !== checkSum) return this.statusAnswer(400, "VALIDATION_ERROR", [{ code: "INCORRECT_CHECKSUM", fields: "checkSum" }])
    if (order.closed) return this.statusAnswer(400, "VALIDATION_ERROR", [{ code: "ORDER_CLOSED_STATUS", fields: "orderNumber" }])
    if (order.canceled) return this.statusAnswer(400, "VALIDATION_ERROR", [{ code: "INCORRECT_STATUS", fields: "orderNumber" }])
    if (op === "delete") {
      order.canceled = true
      return this.json(200, { orderNumber, checkSum: order.checkSum, status: { status: "OK", errorDetails: [] }, traceId: this.trace() })
    }
    /* A PATCH rotates the checkSum [NZ]: the flow must store the new one (DS13). */
    if (this.rotateCheckSum) order.checkSum = this.nextCheckSum()
    order.pickupDate = str(input.pickupDate)
    order.pickupTimeFrom = str(input.pickupTimeFrom)
    order.pickupTimeTo = str(input.pickupTimeTo)
    order.parcels = Number(obj(obj(obj(input.packagesForCollection)?.packagesParams)?.parcel)?.count) || order.parcels
    return this.json(200, { orderNumber, checkSum: order.checkSum, status: { status: "OK", errorDetails: [] }, traceId: this.trace() })
  }
}

/** The operation of a method and a path; null for anything the client must never send. */
function opOf(method: string, path: string): FakeOp | null {
  if (method === "POST" && path === DPDSERVICES_PATHS.numbers) return "numbers"
  if (method === "POST" && path === DPDSERVICES_PATHS.labels) return "labels"
  if (method === "POST" && path === DPDSERVICES_PATHS.protocol) return "protocol"
  if (method === "GET" && path === DPDSERVICES_PATHS.availability) return "availability"
  if (path === DPDSERVICES_PATHS.pickupCall) {
    if (method === "POST") return "pickupCreate"
    if (method === "PATCH") return "pickupUpdate"
    if (method === "DELETE") return "pickupDelete"
  }
  return null
}
