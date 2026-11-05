import { createHash } from "node:crypto"
import { COURIER_ORDER_MAX_KG, COURIER_ORDER_TYPE, COURIER_UPDATE_MODE, DEMO_PAYER_FID, DIMS_UNKNOWN_CM, DISPATCH_MAX_SHIPMENTS, PROTOCOL_OUTPUT } from "./constants"
import { readStoredBoxes, roundKg } from "./boxes"
import { DEMO_SENDER } from "./demo"
import { isPickedUp } from "./tracking"
import { canonicalJson, senderOf } from "./plan"
import { hasSender, isPolishPostalCode, resolveOrderer, senderFor, validateOrderer } from "./sender"
import type { ProblemDto } from "./contract"
import type { DpdMode } from "./constants"
import type { ResolvedDpdOptions } from "./options"
import type { ResolvedOrderer, ResolvedSender } from "./sender"
import type { PlanBox } from "./boxes"
import type { ShipmentRow } from "./dto"
import type {
  DpdAddress, DpdPackagesParams, DpdPickupSender, DpdProtocolPickupAddress, GenerateProtocolRequest,
  PackagesPickupCallCreateRequest, PackagesPickupCallUpdateRequest,
} from "./dpdservices"
import type { CourierWindow } from "./courier"

/**
 * THE HANDOVER TO THE COURIER, pure (DS1): which shipments of a pick can go
 * in one dispatch, the sender group, the packagesParams of the courier order
 * and the hash a create must repeat (DS9), the bodies of generateProtocol and
 * packagesPickupCall (section 7), the handover marker the flow writes into
 * fulfillment.data before the protocol (DS6), and the names of the history
 * rows of a dispatch.
 *
 * Step 1 is the protocol (writer shipment), step 2, optional, the courier
 * order (writer pickup). A problem blocks step 1; an orderProblem blocks
 * step 2 only (DISPATCH_ORDER_PROBLEM_CODES).
 */

/** Problems that block the dispatch (step 1) or the courier order (step 2). Shipment problems carry field "shipments.<id>". */
export const DISPATCH_PROBLEM_CODES = [
  "no_shipments", "too_many_shipments", "shipment_not_found", "shipment_not_labeled", "shipment_dispatched",
  "shipment_excluded", "shipment_canceled", "shipment_not_domestic", "shipment_not_outbound",
  "shipment_no_reference", "shipment_boxes_missing", "mixed_senders", "sender_not_pl", "orderer_invalid",
  "shipment_picked_up",
] as const
export type DispatchProblemCode = (typeof DISPATCH_PROBLEM_CODES)[number]
/* Reused plan codes: sender_missing, sender_invalid, payer_fid_missing (step 1 and 2), courier_over_50kg (step 2 only). */
/** The codes of DispatchPlan.orderProblems: they block step 2 only. */
export const DISPATCH_ORDER_PROBLEM_CODES: readonly string[] = ["courier_over_50kg", "sender_not_pl", "orderer_invalid"]

export const DISPATCH_WARNING_CODES = ["dims_unknown", "protocol_stale", "sample_sender"] as const
export type DispatchWarningCode = (typeof DISPATCH_WARNING_CODES)[number]

/** One shipment as the plan reads it: the row and its fulfillment read now. */
export type DispatchShipmentInput = {
  row: ShipmentRow
  /** null: the fulfillment is not in Medusa (tolerated in demo only, DS6). */
  fulfillment: { id: string; location_id: string | null; canceled_at: string | Date | null } | null
}

export type DispatchPlanContext = {
  options: ResolvedDpdOptions
  mode: DpdMode
  demo: boolean
  /** The ids a person picked, in their order (a missing row is shipment_not_found). */
  shipmentIds: readonly string[]
}

export type DispatchSender = {
  locationId: string | null
  /** senderOf(...) of plan.ts: DEMO_SENDER in demo (warning sample_sender). */
  address: DpdAddress
  resolved: ResolvedSender
  orderer: ResolvedOrderer
}

/** One sender group of a mixed pick (DS9): key "loc:<location id>" or "default". */
export type DispatchGroup = { key: string; locationId: string | null; sender: DpdAddress | null; shipmentIds: string[] }

export type DispatchPlanShipment = {
  id: string
  orderId: string | null
  displayId: number | null
  reference: string | null
  waybills: string[]
  boxes: PlanBox[]
  weightKg: number
  problems: ProblemDto[]
}

export type DispatchPlan = {
  /** Step 1 possible: no problems. */
  ok: boolean
  /** Step 2 possible too: ok and no orderProblems. */
  canOrder: boolean
  groups: DispatchGroup[]
  locationId: string | null
  sender: DispatchSender | null
  shipments: DispatchPlanShipment[]
  params: DpdPackagesParams | null
  problems: ProblemDto[]
  orderProblems: ProblemDto[]
  warnings: ProblemDto[]
  /** dispatchPlanHash of the sorted ids with waybills, the sender and params; "" with problems. */
  hash: string
}

const SHIPMENT_FIELD = (id: string) => `shipments.${id}`

/** The waybills of a row (a JSON list of strings); dto.ts has the same reader, kept apart so this file imports no flow module at run time. */
function waybillsOfRow(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((w): w is string => typeof w === "string" && w.length > 0) : []
}

function present(v: string | Date | null | undefined): boolean {
  return v !== null && v !== undefined && v !== ""
}

/** Pure: DS5 per shipment, DS9 groups, DS10 params, DS16 sender and orderer. */
export function buildDispatchPlan(inputs: readonly DispatchShipmentInput[], ctx: DispatchPlanContext): DispatchPlan {
  const o = ctx.options
  const problems: ProblemDto[] = []
  const warnings: ProblemDto[] = []
  const orderProblems: ProblemDto[] = []
  const plan = (rest: Partial<DispatchPlan>): DispatchPlan => ({
    ok: false, canOrder: false, groups: [], locationId: null, sender: null, shipments: [], params: null,
    problems, orderProblems: [], warnings: [], hash: "", ...rest,
  })

  /* 1. The list. */
  const ids = [...new Set(ctx.shipmentIds)]
  if (ids.length === 0) return plan({ problems: [{ code: "no_shipments" }] })
  if (ids.length > DISPATCH_MAX_SHIPMENTS) problems.push({ code: "too_many_shipments", detail: String(ids.length) })
  const byId = new Map(inputs.map((i) => [i.row.id, i]))

  /* 2. The shipments, in the order a person picked them. */
  const shipments: DispatchPlanShipment[] = []
  const found: DispatchShipmentInput[] = []
  for (const id of ids) {
    const input = byId.get(id)
    if (!input || input.row.mode !== ctx.mode) {
      problems.push({ code: "shipment_not_found", field: SHIPMENT_FIELD(id) })
      continue
    }
    const own = candidateProblems(input, ctx.mode, ctx.demo)
    problems.push(...own)
    const boxes = shipmentBoxesOf(input.row, o.defaultBox, ctx.demo) ?? []
    const sum = boxes.reduce((s, b) => s + b.weightKg, 0)
    shipments.push({
      id,
      orderId: input.row.order_id,
      displayId: input.row.display_id,
      reference: dispatchReferenceOf(input.row, ctx.demo),
      waybills: waybillsOfRow(input.row.waybills),
      boxes,
      weightKg: boxes.length > 0 ? roundKg(sum) : 0,
      problems: own,
    })
    found.push(input)
  }

  /* 3. Sender groups (DS9): one dispatch has one sender. */
  const groups: DispatchGroup[] = []
  for (const input of found) {
    const locationId = input.fulfillment?.location_id ?? null
    const key = senderGroupOf(o, locationId)
    const group = groups.find((g) => g.key === key)
    if (group) group.shipmentIds.push(input.row.id)
    else {
      /* The default group has no location of its own: its sender is the shop's (senderFor). */
      const groupLocation = key === "default" ? null : locationId
      groups.push({ key, locationId: groupLocation, sender: senderOf(o, groupLocation, ctx.demo).sender, shipmentIds: [input.row.id] })
    }
  }
  if (groups.length > 1) {
    problems.push({ code: "mixed_senders", detail: String(groups.length) })
    return plan({ groups, shipments })
  }

  /* 4. The sender of the one group, and the orderer (DS16). */
  const group = groups[0] ?? null
  const locationId = group?.locationId ?? null
  let sender: DispatchSender | null = null
  if (group) {
    const of = senderOf(o, locationId, ctx.demo)
    problems.push(...of.problems)
    warnings.push(...of.warnings)
    if (of.sender) {
      const resolved = resolvedSenderOf(o, locationId, ctx.demo)
      /* One orderer per shop, also with a location sender: the option's fields win, the empty ones fall back to this sender (DEMO_SENDER in demo). */
      const orderer = resolveOrderer(o.orderer, resolved)
      sender = { locationId, address: of.sender, resolved, orderer }
    }
  }

  /* 5. The payer FID. */
  if (payerFidOf(o, ctx.demo) === null) problems.push({ code: "payer_fid_missing", field: "payerFid" })

  /* 6. Step 2 only: the orderer and a Polish sender. */
  if (sender) orderProblems.push(...senderOrderProblems(sender))

  /* 7. packagesParams of the shipments without problems of their own. */
  let params: DpdPackagesParams | null = null
  const boxes = shipments.filter((s) => s.problems.length === 0).flatMap((s) => s.boxes)
  if (boxes.length > 0) {
    const p = packagesParamsOf(boxes, o.defaultBox)
    params = p.params
    warnings.push(...p.warnings)
    orderProblems.push(...p.orderProblems)
  }

  /* 8 and 9. The result and the hash a create must repeat. */
  const ok = problems.length === 0
  const hash = ok
    ? dispatchPlanHash({
        shipments: [...shipments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((s) => ({ id: s.id, waybills: s.waybills })),
        sender: sender?.address ?? null,
        params,
      })
    : ""
  return plan({ ok, canOrder: ok && orderProblems.length === 0, groups, locationId, sender, shipments, params, orderProblems, warnings, hash })
}

/** The sender a courier order names: the location's own, else the shop's (senderFor), DEMO_SENDER in demo without one. */
function resolvedSenderOf(o: ResolvedDpdOptions, locationId: string | null, demo: boolean): ResolvedSender {
  const own = locationId && o.senders[locationId] ? o.senders[locationId] : null
  const s = own ?? senderFor(o, locationId)
  return !hasSender(s) && demo ? DEMO_SENDER : s
}

/** DS5 for one shipment: [] when it is a candidate. A shipment DPD already has (isPickedUp, DS13) is not one (E54). */
export function candidateProblems(input: DispatchShipmentInput, mode: DpdMode, demo: boolean): ProblemDto[] {
  const row = input.row
  const field = SHIPMENT_FIELD(row.id)
  if (row.mode !== mode) return [{ code: "shipment_not_found", field }]
  const out: ProblemDto[] = []
  if (row.kind !== "outbound") out.push({ code: "shipment_not_outbound", field })
  if (row.state === "excluded") out.push({ code: "shipment_excluded", field })
  else if (row.state === "canceled" || row.state === "skipped") out.push({ code: "shipment_canceled", field, detail: row.state })
  else if (row.state !== "labeled") out.push({ code: "shipment_not_labeled", field, detail: row.state })
  if (row.session_type && row.session_type !== "DOMESTIC") out.push({ code: "shipment_not_domestic", field, detail: row.session_type })
  if (row.dispatch_id !== null || present(row.handed_over_at)) out.push({ code: "shipment_dispatched", field, detail: row.dispatch_id ?? "handed_over" })
  /* DS13, E54: DPD has the parcel already (dropped at a point, taken by a courier outside the plugin): no protocol, no courier for it. */
  else if (isPickedUp(row)) out.push({ code: "shipment_picked_up", field })
  if (input.fulfillment === null) {
    if (!demo) out.push({ code: "shipment_canceled", field, detail: "fulfillment_missing" })
  } else if (present(input.fulfillment.canceled_at)) out.push({ code: "shipment_canceled", field, detail: "fulfillment_canceled" })
  if (dispatchReferenceOf(row, demo) === null) out.push({ code: "shipment_no_reference", field })
  const boxes = shipmentBoxesOf(row, null, demo)
  if (boxes === null || boxes.length === 0) out.push({ code: "shipment_boxes_missing", field })
  return out
}

/** "loc:<id>" when the location has its own sender (options.senders), else "default". */
export function senderGroupOf(o: ResolvedDpdOptions, locationId: string | null): string {
  return locationId && o.senders[locationId] ? `loc:${locationId}` : "default"
}

/* DS10: maxDepth from the length, maxWidth from the width, maxHeight from the height (like sizeX, sizeY, sizeZ of stage 2). */
const PARAM_SIDES = [
  ["maxHeight", "heightCm"],
  ["maxWidth", "widthCm"],
  ["maxDepth", "lengthCm"],
] as const

/** DS10: params of every box, warnings (dims_unknown), orderProblems (courier_over_50kg per box). */
export function packagesParamsOf(boxes: readonly PlanBox[], defaultBox: ResolvedDpdOptions["defaultBox"]): { params: DpdPackagesParams; warnings: ProblemDto[]; orderProblems: ProblemDto[] } {
  const weights = boxes.map((b) => b.weightKg)
  const sum = weights.reduce((s, w) => s + w, 0)
  const unknown: string[] = []
  const side = (param: (typeof PARAM_SIDES)[number][0], key: (typeof PARAM_SIDES)[number][1]): number => {
    const known = boxes.map((b) => b[key] ?? defaultBox?.[key] ?? null).filter((v): v is number => v !== null && Number.isFinite(v))
    if (known.length === 0) {
      unknown.push(param)
      return DIMS_UNKNOWN_CM
    }
    return Math.round(Math.max(...known))
  }
  const [maxHeight, maxWidth, maxDepth] = PARAM_SIDES.map(([param, key]) => side(param, key))
  const orderProblems: ProblemDto[] = []
  boxes.forEach((b, i) => {
    if (b.weightKg > COURIER_ORDER_MAX_KG) orderProblems.push({ code: "courier_over_50kg", field: "parcel.maxWeight", detail: `box ${i + 1}, ${b.weightKg} kg` })
  })
  return {
    params: {
      doxCount: 0,
      parcel: {
        count: boxes.length,
        weight: boxes.length > 0 ? roundKg(sum) : 0,
        maxWeight: weights.length > 0 ? Math.max(...weights) : 0,
        maxHeight,
        maxWidth,
        maxDepth,
      },
    },
    warnings: unknown.length > 0 ? [{ code: "dims_unknown", detail: unknown.join(", ") }] : [],
    orderProblems,
  }
}

/** sha256(canonicalJson({ v: 1, shipments, sender, params })) hex, first 24 characters (like planHash). */
export function dispatchPlanHash(parts: { shipments: ReadonlyArray<{ id: string; waybills: readonly string[] }>; sender: DpdAddress | null; params: DpdPackagesParams | null }): string {
  return createHash("sha256")
    .update(canonicalJson({ v: 1, shipments: parts.shipments.map((s) => ({ id: s.id, waybills: [...s.waybills] })), sender: parts.sender, params: parts.params }))
    .digest("hex")
    .slice(0, 24)
}

/** H5: fid = payerFid; the sender's company, person, address, city, country, postal code, phone, e-mail. */
export function pickupAddressOf(sender: DispatchSender, payerFid: number): DpdProtocolPickupAddress {
  const a = sender.address
  return {
    fid: payerFid,
    ...(a.company ? { company: a.company } : {}),
    ...(a.name ? { name: a.name } : {}),
    address: a.address,
    city: a.city,
    countryCode: a.countryCode,
    postalCode: a.postalCode,
    ...(a.phone ? { phone: a.phone } : {}),
    ...(a.email ? { email: a.email } : {}),
  }
}

/** H3, H6, H7: STOP_ON_FIRST_ERROR, DOMESTIC, one { reference } per shipment, PDF. */
export function protocolRequest(references: readonly string[], pickupAddress: DpdProtocolPickupAddress): GenerateProtocolRequest {
  return {
    protocolSearchParams: {
      policy: PROTOCOL_OUTPUT.policy,
      session: { type: "DOMESTIC", packages: references.map((reference) => ({ reference })) },
      pickupAddress,
    },
    outputDocFormat: PROTOCOL_OUTPUT.outputDocFormat,
  }
}

/** Sender of packagesPickupCall: the company as name and the person as fullName, each falling back to the other (both required, DS16). */
function pickupSenderOf(s: ResolvedSender): DpdPickupSender {
  return {
    name: s.company || s.name,
    fullName: s.name || s.company,
    address: s.street,
    city: s.city,
    postalCode: s.postalCode,
    phone: s.phone,
  }
}

/** DS16; no own orderNumber (H13). */
export function pickupCallRequest(input: { window: CourierWindow; sender: DispatchSender; params: DpdPackagesParams; payerFid: number }): PackagesPickupCallCreateRequest {
  const r = input.sender.resolved
  return {
    pickupDate: input.window.pickupDate,
    pickupTimeFrom: input.window.pickupTimeFrom,
    pickupTimeTo: input.window.pickupTimeTo,
    orderType: COURIER_ORDER_TYPE,
    waybillsReady: true,
    packagesForCollection: {
      payer: { number: input.payerFid, ...(r.company ? { name: r.company } : {}) },
      orderer: { name: input.sender.orderer.name, fullName: input.sender.orderer.fullName, phone: input.sender.orderer.phone },
      sender: pickupSenderOf(r),
      packagesParams: input.params,
    },
  }
}

/** DS12, DS13: updateMode DONT_CREATE_NEW_IF_CLOSED. */
export function pickupCallUpdateRequest(input: { orderNumber: string; checkSum: string; window: CourierWindow; sender: DispatchSender; params: DpdPackagesParams }): PackagesPickupCallUpdateRequest {
  const r = input.sender.resolved
  const full = pickupSenderOf(r)
  const sender = { name: full.name, fullName: full.fullName, address: full.address, city: full.city, phone: full.phone }
  return {
    orderNumber: input.orderNumber,
    checkSum: input.checkSum,
    updateMode: COURIER_UPDATE_MODE,
    pickupDate: input.window.pickupDate,
    pickupTimeFrom: input.window.pickupTimeFrom,
    pickupTimeTo: input.window.pickupTimeTo,
    waybillsReady: true,
    packagesForCollection: {
      /* UpdatePayer has only name; the object is required, so an empty one without a company. */
      payer: r.company ? { name: r.company } : {},
      sender,
      packagesParams: input.params,
    },
  }
}

type Obj = Record<string, unknown>

function obj(v: unknown): Obj | null {
  let x = v
  if (typeof x === "string") {
    try {
      x = JSON.parse(x)
    } catch {
      return null
    }
  }
  return x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null
}

function readResolved(o: Obj | null): ResolvedSender | null {
  if (!o) return null
  const [company, name, phone, email, street, city, postalCode, countryCode] = [o.company, o.name, o.phone, o.email, o.street, o.city, o.postalCode, o.countryCode].map(str)
  if (company === null || name === null || phone === null || email === null || street === null || city === null || postalCode === null || countryCode === null) return null
  return { company, name, phone, email, street, city, postalCode, countryCode }
}

function readOrderer(o: Obj | null): ResolvedOrderer | null {
  const name = str(o?.name)
  const fullName = str(o?.fullName)
  const phone = str(o?.phone)
  return name === null || fullName === null || phone === null ? null : { name, fullName, phone }
}

function readAddress(o: Obj | null): DpdAddress | null {
  const address = str(o?.address)
  const city = str(o?.city)
  const countryCode = str(o?.countryCode)
  const postalCode = str(o?.postalCode)
  if (!o || address === null || city === null || countryCode === null || postalCode === null) return null
  const optional = (v: unknown): string => str(v) ?? ""
  return pickupAddressOrder({ company: optional(o.company), name: optional(o.name), address, city, countryCode, postalCode, phone: optional(o.phone), email: optional(o.email) })
}

/** A stored sender snapshot (dpd_dispatch.sender) back as a DispatchSender; null when unreadable. */
export function dispatchSenderOf(value: unknown): DispatchSender | null {
  const o = obj(value)
  if (!o) return null
  const rawLocation = o.locationId
  if (rawLocation !== null && rawLocation !== undefined && typeof rawLocation !== "string") return null
  const resolved = readResolved(obj(o.resolved))
  const orderer = readOrderer(obj(o.orderer))
  const address = readAddress(obj(o.address))
  if (!resolved || !orderer || !address) return null
  return { locationId: typeof rawLocation === "string" ? rawLocation : null, address, resolved, orderer }
}

/** The key order of a DpdAddress as plan.ts writes it, so a snapshot read back hashes the same. */
function pickupAddressOrder(a: DpdAddress): DpdAddress {
  return {
    ...(a.company ? { company: a.company } : {}),
    ...(a.name ? { name: a.name } : {}),
    address: a.address,
    city: a.city,
    countryCode: a.countryCode,
    postalCode: a.postalCode,
    ...(a.phone ? { phone: a.phone } : {}),
    ...(a.email ? { email: a.email } : {}),
  }
}

const PARCEL_KEYS = ["count", "weight", "maxWeight", "maxHeight", "maxWidth", "maxDepth"] as const

/** A stored params snapshot back; null when unreadable. */
export function packagesParamsFrom(value: unknown): DpdPackagesParams | null {
  const o = obj(value)
  const p = obj(o?.parcel)
  if (!o || !p || o.doxCount !== 0) return null
  const n = (k: (typeof PARCEL_KEYS)[number]): number | null => {
    const v = p[k]
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null
  }
  const [count, weight, maxWeight, maxHeight, maxWidth, maxDepth] = PARCEL_KEYS.map(n)
  if (count === null || weight === null || maxWeight === null || maxHeight === null || maxWidth === null || maxDepth === null) return null
  return { doxCount: 0, parcel: { count, weight, maxWeight, maxHeight, maxWidth, maxDepth } }
}

/** The protocol reference of a row: reference ?? fulfillment_id ?? (demo ? id : null). Seeded demo rows have neither (7.6). */
export function dispatchReferenceOf(row: Pick<ShipmentRow, "reference" | "fulfillment_id" | "id">, demo: boolean): string | null {
  return row.reference || row.fulfillment_id || (demo ? row.id : null)
}

/** The stored boxes (readStoredBoxes); in demo without boxes one box per waybill (defaultBox weight, else 1 kg); else null (7.6). */
export function shipmentBoxesOf(row: Pick<ShipmentRow, "boxes" | "waybills">, defaultBox: ResolvedDpdOptions["defaultBox"], demo: boolean): PlanBox[] | null {
  const stored = readStoredBoxes(row.boxes)
  if (stored && stored.items.length > 0) {
    return stored.items.map((b) => ({ weightKg: b.weightKg, lengthCm: b.lengthCm, widthCm: b.widthCm, heightCm: b.heightCm }))
  }
  if (!demo) return null
  return waybillsOfRow(row.waybills).map(() => ({
    weightKg: defaultBox?.weightKg ?? 1,
    lengthCm: defaultBox?.lengthCm ?? null,
    widthCm: defaultBox?.widthCm ?? null,
    heightCm: defaultBox?.heightCm ?? null,
  }))
}

/** DEMO_PAYER_FID in demo, else o.payerFid (like payerFID in plan.ts). */
export function payerFidOf(o: Pick<ResolvedDpdOptions, "demo" | "payerFid">, demo: boolean): number | null {
  return demo ? DEMO_PAYER_FID : o.payerFid
}

/** orderer_invalid and sender_not_pl: what blocks step 2 in the sender snapshot. */
function senderOrderProblems(sender: DispatchSender): ProblemDto[] {
  const out: ProblemDto[] = validateOrderer(sender.orderer).map((p) => ({
    code: "orderer_invalid",
    field: p.path,
    detail: `${p.path}, ${p.code.replace(/_/g, " ")}${p.max !== undefined ? `, max ${p.max}` : ""}`,
  }))
  if (sender.resolved.countryCode !== "PL" || !isPolishPostalCode(sender.resolved.postalCode)) out.push({ code: "sender_not_pl", field: "sender.postalCode" })
  return out
}

/** Step 2 problems again from the stored snapshots: orderer_invalid (validateOrderer), sender_not_pl, courier_over_50kg (parcel.maxWeight). orderCourier and dispatchCanOrder use it. */
export function orderProblemsOf(sender: DispatchSender, params: DpdPackagesParams): ProblemDto[] {
  const out = senderOrderProblems(sender)
  if (params.parcel.maxWeight > COURIER_ORDER_MAX_KG) out.push({ code: "courier_over_50kg", field: "parcel.maxWeight", detail: `${params.parcel.maxWeight} kg` })
  return out
}

/** DS6: the keys written into fulfillment.data before generateProtocol (only these keys, merged). */
export function markerData(dispatchId: string, at: Date): { dpd_handed_over_at: string; dpd_dispatch_id: string } {
  return { dpd_handed_over_at: at.toISOString(), dpd_dispatch_id: dispatchId }
}

export function clearedMarkerData(): { dpd_handed_over_at: null; dpd_dispatch_id: null } {
  return { dpd_handed_over_at: null, dpd_dispatch_id: null }
}

/** data.dpd_handed_over_at is a non empty string (what the provider guard reads). */
export function hasMarker(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false
  const v = (data as Obj).dpd_handed_over_at
  return typeof v === "string" && v.trim() !== ""
}

/** dpd_event.data.action of every dispatch history row (kind "action", dispatch_id set; shipment_id set for a per shipment row). */
export const DISPATCH_ACTIONS = [
  "dispatch_created", "protocol_printed", "protocol_reprinted", "protocol_refused", "protocol_unclear",
  "courier_ordered", "courier_refused", "courier_unknown", "courier_rescheduled", "courier_update_refused",
  "courier_update_unclear", "courier_canceled", "courier_cancel_refused", "courier_cancel_unclear",
  "dispatch_resolved", "dispatch_canceled", "shipment_withdrawn", "shipment_excluded", "shipment_restored",
  "dispatch_lease_expired", "handed_over",
] as const
export type DispatchAction = (typeof DISPATCH_ACTIONS)[number]
