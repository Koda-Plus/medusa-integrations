import type { DpdHttpAnswer, DpdServicesClient, PackagesPickupCallCreateRequest, PackagesPickupCallUpdateRequest, PickupCallDeleteQuery } from "./dpdservices"
import { classifyPickupCallAnswer, classifyPickupCallChangeAnswer, type PickupCallChangeOutcome, type PickupCallOutcome } from "./dpd-answers"
import { courierWindowProblems, validateCourierCall, warsawDate, warsawTime, type CourierWindow } from "./courier"
import { SANDBOX_ORDER_PREFIX } from "./constants"

/**
 * THE SIMULATED COURIER ORDER of demo and sandbox (DS4). The DPD test host
 * answers every valid packagesPickupCall with HTTP 200 UNKNOWN_ERROR and no
 * order number (H10), so in sandbox every order would end unknown and PATCH
 * and DELETE could never be tried. The simulator answers in process instead:
 * the same validation DPD applies (validateCourierCall, H11), an orderNumber
 * "SBX" plus 11 digits and an 8 digit checkSum. It never calls `fetch`; the
 * orders live in memory, per client, so a restart forgets them (a PATCH or
 * DELETE of an order it does not know is unclear, as on the test host, H12).
 *
 * Every answer other than a local validation refusal is built as the body
 * DPD would send (StatusInfo, OpenAPI) and read by the real classifier, so
 * the flow sees exactly the shapes it sees from DPD (spec 9.1).
 */

export type CourierSimOptions = {
  /** Default () => new Date(). */
  now?: () => Date
  /** Default Math.random; tests pass a fixed one. */
  random?: () => number
  /** payer.number other than this: refused DISALLOWED_FID (12h). */
  payerFid: number
}

export type SimulatedOrder = {
  orderNumber: string
  checkSum: string
  pickupDate: string
  pickupTimeFrom: string
  pickupTimeTo: string
  parcels: number
  canceled: boolean
}

export type CourierSimulator = {
  pickupCallCreate(body: PackagesPickupCallCreateRequest): Promise<PickupCallOutcome>
  pickupCallUpdate(body: PackagesPickupCallUpdateRequest): Promise<PickupCallChangeOutcome>
  pickupCallDelete(query: PickupCallDeleteQuery): Promise<PickupCallChangeOutcome>
  /** Tests and the demo reset: the orders of this process. */
  readonly orders: ReadonlyMap<string, SimulatedOrder>
}

const ORDER_DIGITS = 11
const ORDER_SPACE = 100_000_000_000

/** A body the way DPD answers packagesPickupCall (PackagesPickupCallResponse), traceId null. */
function answerOf(httpStatus: number, body: Record<string, unknown>): DpdHttpAnswer {
  return { httpStatus, body, text: "", traceId: null, ms: 0 }
}

function statusBody(status: string, details: Array<{ code: string; fields: string }> = []): Record<string, unknown> {
  return { orderNumber: null, checkSum: "null", status: { status, errorDetails: details.map((d) => ({ code: d.code, description: null, fields: `${d.fields};` })) } }
}

function windowOf(body: { pickupDate: string; pickupTimeFrom: string; pickupTimeTo: string }): CourierWindow {
  return { pickupDate: body.pickupDate, pickupTimeFrom: body.pickupTimeFrom, pickupTimeTo: body.pickupTimeTo }
}

/** In process, per client: validateCourierCall first; an order unknown to this process in PATCH or DELETE is unclear server_error (as H12, also after a restart). */
export function createCourierSimulator(opts: CourierSimOptions): CourierSimulator {
  const now = opts.now ?? (() => new Date())
  const random = opts.random ?? Math.random
  const orders = new Map<string, SimulatedOrder>()
  let n = Math.floor(now().getTime() / 1000) % ORDER_SPACE

  /** The shape check of the window (DS11 without ranges): refused pickup_time as a VALIDATION_ERROR, HTTP 200 [NZ]. */
  function windowRefusal(w: CourierWindow, today: string): Record<string, unknown> | null {
    const problems = courierWindowProblems(w, null, today)
    if (problems.length === 0) return null
    const fields = [...new Set(problems.map((p) => p.field ?? "pickupDate"))]
    return statusBody("VALIDATION_ERROR", fields.map((f) => ({ code: "INCORRECT_PICKUP_TIME", fields: f })))
  }

  /** Steps 2 to 5 of PATCH and DELETE (9.1): unknown, wrong checkSum, canceled, closed. */
  function orderRefusal(orderNumber: string, checkSum: string, today: string): { order: SimulatedOrder } | { answer: DpdHttpAnswer } {
    const order = orders.get(orderNumber)
    if (!order) return { answer: answerOf(500, { orderNumber: null, checkSum: null, status: { status: "UNKNOWN_ERROR" } }) }
    if (order.checkSum !== checkSum) return { answer: answerOf(200, statusBody("VALIDATION_ERROR", [{ code: "INCORRECT_CHECKSUM", fields: "checkSum" }])) }
    if (order.canceled) return { answer: answerOf(200, statusBody("VALIDATION_ERROR", [{ code: "INCORRECT_STATUS", fields: "orderNumber" }])) }
    /* Closed [NZ: what DPD means by ORDER_CLOSED_STATUS is not known]: the day has passed, or the window has begun. */
    const closed = order.pickupDate < today || (order.pickupDate === today && warsawTime(now()) >= order.pickupTimeFrom)
    if (closed) return { answer: answerOf(200, statusBody("VALIDATION_ERROR", [{ code: "ORDER_CLOSED_STATUS", fields: "orderNumber" }])) }
    return { order }
  }

  /** The simulator never throws: a request it cannot read is an unclear answer, like a body DPD could not read. */
  function unreadable(): DpdHttpAnswer {
    return answerOf(200, { orderNumber: null, checkSum: null })
  }

  function create(body: PackagesPickupCallCreateRequest): PickupCallOutcome {
    const today = warsawDate(now())
    const local = validateCourierCall(body, { today, payerFid: opts.payerFid, op: "create" })
    if (local) return local
    const shape = windowRefusal(windowOf(body), today)
    if (shape) return classifyPickupCallAnswer(answerOf(200, shape))
    const orderNumber = simulatedOrderNumber(n)
    n = (n + 1) % ORDER_SPACE
    const checkSum = String(10_000_000 + Math.floor(random() * 90_000_000))
    orders.set(orderNumber, { orderNumber, checkSum, ...windowOf(body), parcels: body.packagesForCollection.packagesParams.parcel.count, canceled: false })
    return classifyPickupCallAnswer(answerOf(200, { orderNumber, checkSum, status: { status: "OK", errorDetails: [] } }))
  }

  function update(body: PackagesPickupCallUpdateRequest): PickupCallChangeOutcome {
    const today = warsawDate(now())
    const local = validateCourierCall(body, { today, payerFid: opts.payerFid, op: "update" })
    if (local) return local
    const found = orderRefusal(body.orderNumber, body.checkSum, today)
    if ("answer" in found) return classifyPickupCallChangeAnswer(found.answer, "update")
    const shape = windowRefusal(windowOf(body), today)
    if (shape) return classifyPickupCallChangeAnswer(answerOf(200, shape), "update")
    const order: SimulatedOrder = { ...found.order, ...windowOf(body), parcels: body.packagesForCollection.packagesParams.parcel.count }
    orders.set(order.orderNumber, order)
    return classifyPickupCallChangeAnswer(answerOf(200, { orderNumber: order.orderNumber, checkSum: order.checkSum, status: { status: "OK", errorDetails: [] } }), "update")
  }

  function cancel(query: PickupCallDeleteQuery): PickupCallChangeOutcome {
    const today = warsawDate(now())
    const local = validateCourierCall({ orderNumber: query.orderNumber, checkSum: query.checkSum }, { today, payerFid: opts.payerFid, op: "delete" })
    if (local) return local
    const found = orderRefusal(query.orderNumber, query.checkSum, today)
    if ("answer" in found) return classifyPickupCallChangeAnswer(found.answer, "delete")
    orders.set(found.order.orderNumber, { ...found.order, canceled: true })
    return classifyPickupCallChangeAnswer(answerOf(200, { orderNumber: found.order.orderNumber, checkSum: found.order.checkSum, status: { status: "OK", errorDetails: [] } }), "delete")
  }

  return {
    orders,
    pickupCallCreate: async (body) => {
      try {
        return create(body)
      } catch {
        return classifyPickupCallAnswer(unreadable())
      }
    },
    pickupCallUpdate: async (body) => {
      try {
        return update(body)
      } catch {
        return classifyPickupCallChangeAnswer(unreadable(), "update")
      }
    },
    pickupCallDelete: async (query) => {
      try {
        return cancel(query)
      } catch {
        return classifyPickupCallChangeAnswer(unreadable(), "delete")
      }
    },
  }
}

/** The client with packagesPickupCall from the simulator; everything else (numbers, labels, protocol, availability) from `client`. */
export function withSimulatedCourier(client: DpdServicesClient, sim: CourierSimulator): DpdServicesClient {
  return {
    host: client.host,
    generatePackagesNumbers: (body) => client.generatePackagesNumbers(body),
    generateSpedLabels: (body) => client.generateSpedLabels(body),
    generateProtocol: (body) => client.generateProtocol(body),
    courierOrderAvailability: (query) => client.courierOrderAvailability(query),
    pickupCallCreate: (body) => sim.pickupCallCreate(body),
    pickupCallUpdate: (body) => sim.pickupCallUpdate(body),
    pickupCallDelete: (query) => sim.pickupCallDelete(query),
  }
}

/** "SBX" + n as 11 digits, zero padded. */
export function simulatedOrderNumber(n: number): string {
  const digits = Math.floor(Math.abs(n)) % ORDER_SPACE
  return `${SANDBOX_ORDER_PREFIX}${String(digits).padStart(ORDER_DIGITS, "0")}`
}
