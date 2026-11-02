/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. Types and plain constants
 * only, zero imports: the admin bundle imports this file and Vite never sees
 * server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. Passwords and keys stay on the
 * server; the admin learns only whether each is set. No type carries the
 * receiver's name, phone, e-mail or street: the plugin keeps none of them.
 *
 * Routes of stage 1:
 *
 *   GET  /admin/dpd                  StatusResponse
 *   GET  /admin/dpd/shipments        ShipmentsQuery    -> ShipmentsResponse
 *   GET  /admin/dpd/orders/:orderId  OrderDpdResponse  (the order widget card)
 *   POST /admin/dpd/writers          WriterRequest     -> WritersResponse
 *   POST /admin/dpd/demo/seed        DemoSeedResponse
 *   POST /admin/dpd/demo/reset       DemoResetResponse
 *
 * An error of any route is an ErrorResponse with an HTTP status.
 */

/** The mode the plugin runs in: everything simulated, the DPD demo host, production. */
export type DpdMode = "demo" | "sandbox" | "live"
/** The frozen ids of the five fulfillment options. */
export type DpdOptionId = "dpd-courier" | "dpd-courier-cod" | "dpd-pickup" | "dpd-pickup-cod" | "dpd-return"
/** Where the parcel goes: to the address, to a Pickup point, or back to the store. */
export type OptionKind = "courier" | "pickup" | "return"
/** A row of the plugin: a shipment of a fulfillment, or a return. */
export type ShipmentKind = "outbound" | "return"
/** The label page: a sheet (A4) or a label printer. */
export type LabelPage = "A4" | "LBL_PRINTER"
/** The cash on delivery currencies of DPD. */
export type CodCurrency = "PLN" | "EUR" | "RON" | "CZK"
/** The outbox state of a shipment row (see SHIPMENT_STATES in constants.ts). */
export type ShipmentState =
  | "pending"
  | "creating"
  | "created"
  | "labeling"
  | "labeled"
  | "failed"
  | "unknown"
  | "ambiguous"
  | "abandoned_unknown"
  | "skipped"
  | "canceled"
/** Where the parcel is, from the InfoServices events (stage 5). */
export type ShipmentStage = "preparing" | "ready" | "in_transit" | "in_point" | "delivered" | "problem" | "returned" | "canceled"
/** The state of a handover to the courier (protocol and courier order). */
export type DispatchState = "pending" | "ordering" | "ordered" | "unknown" | "canceled"
/** The three writers (see writers.ts). */
export type WriterKey = "shipment" | "pickup" | "fulfillmentStatus"
/** How a secret option looks to the admin. */
export type SecretState = "set" | "missing"

/**
 * The lists of the Panel, each a filter of GET /admin/dpd/shipments:
 *
 *   to_create    outbound, no label yet (pending, creating, created, labeling)
 *   labeled      the label is stored, not handed to the courier yet
 *   handed_over  in a protocol, before DPD reports the parcel moving
 *   in_transit   on the way or waiting at a Pickup point
 *   delivered    delivered (to the address, or collected from the point)
 *   problems     a DPD refusal, an unclear answer, a problem status, a
 *                parcel sent back to the store
 *   canceled     canceled or shipped outside Medusa
 *   returns      the return shipments, whatever their state
 */
export const SHIPMENT_GROUPS = ["to_create", "labeled", "handed_over", "in_transit", "delivered", "problems", "canceled", "returns"] as const
export type ShipmentGroup = (typeof SHIPMENT_GROUPS)[number]
/** The filter of the list: one group, or everything. */
export type ShipmentFilter = "all" | ShipmentGroup

/** The groups that ask a person to act (the attention counter of the contract). */
export const ATTENTION_GROUPS: readonly ShipmentGroup[] = ["to_create", "problems"]

/** The group of a row, the same on the server (counts, filters) and in the admin. */
export function groupOf(row: { kind: ShipmentKind; state: ShipmentState; stage: ShipmentStage | null; handedOver: boolean }): ShipmentGroup {
  if (row.state === "canceled" || row.state === "skipped") return "canceled"
  if (row.kind === "return") return "returns"
  if (row.state === "failed" || row.state === "unknown" || row.state === "ambiguous" || row.state === "abandoned_unknown") return "problems"
  if (row.stage === "problem" || row.stage === "returned") return "problems"
  if (row.stage === "canceled") return "canceled"
  if (row.stage === "delivered") return "delivered"
  if (row.stage === "in_transit" || row.stage === "in_point") return "in_transit"
  if (row.state !== "labeled") return "to_create"
  return row.handedOver ? "handed_over" : "labeled"
}

/** A problem of a plan or a row, with a code the admin translates. */
export type ProblemDto = {
  code: string
  /** The field or value it is about, like "receiver.postalCode" or "PL14509". */
  field?: string
  detail?: string
}

/** A problem of the sender, the orderer or a sender of `senders` (code: missing, required, too_long, invalid, not_polish). */
export type SenderProblemDto = {
  code: "missing" | "required" | "too_long" | "invalid" | "not_polish"
  /** "sender.street", "orderer.phone", "senders.sloc_01.city". */
  path: string
  /** The limit for too_long. */
  max?: number
}

/** One writer: the option allows it, a person armed it, so it writes. */
export type WriterDto = {
  key: WriterKey
  /** The option allows it. */
  allowed: boolean
  /** A person armed it in Settings (for the current mode). */
  on: boolean
  /** It writes: allowed and on. */
  armed: boolean
  updatedBy: string | null
  updatedAt: string | null
}

/** The number of rows per group of the current mode, plus all and the rows needing attention. */
export type CountsDto = Record<ShipmentGroup, number> & { all: number; attention: number }

/** The settings a person changes in the admin, and where each comes from. */
export type SettingsDto = {
  labelPage: LabelPage
  source: { labelPage: "admin" | "option" }
}

/** What the admin may know of the options: never a secret, only whether it is set. */
export type OptionsSummaryDto = {
  credentials: {
    login: SecretState
    password: SecretState
    infoLogin: SecretState
    infoPassword: SecretState
    infoChannel: SecretState
    pickupLogin: SecretState
    pickupPassword: SecretState
    pickupApiKey: SecretState
  }
  masterFid: number | null
  payerFid: number | null
  trackingMode: "waybill" | "queue"
  labelPage: LabelPage
  countries: string[]
  codCountries: Record<string, CodCurrency[]>
  codPaymentProviders: string[]
  internationalReturns: boolean
  weightUnit: "g" | "kg"
  defaultBox: { weightKg: number; lengthCm: number | null; widthCm: number | null; heightCm: number | null } | null
  documentRetentionDays: number
  autoCreate: boolean
  /** Stock locations with their own sender. */
  senderLocations: string[]
}

/** GET /admin/dpd: the state of the plugin for the page header, Settings and the guide. */
export type StatusResponse = {
  mode: DpdMode
  demo: boolean
  /** DPDServices can be called (or demo mode). */
  configured: boolean
  /** Option names still needed, like ["login", "masterFid"]. */
  missing: string[]
  /** Option values that were set but ignored, like "labelPage (A4 or LBL_PRINTER)". */
  optionProblems: string[]
  senderProblems: SenderProblemDto[]
  writers: Record<WriterKey, WriterDto>
  counts: CountsDto
  settings: SettingsDto
  options: OptionsSummaryDto
  /** The demo shipments were built (demo mode). */
  demoSeeded: boolean
  /** The package version (KIT_META.version). */
  version: string
}

/** One row of the Panel (a shipment or a return). */
export type ShipmentDto = {
  id: string
  orderId: string | null
  displayId: number | null
  fulfillmentId: string | null
  returnId: string | null
  kind: ShipmentKind
  optionId: string
  /** The kind of the option; null when the option id is not one of the five. */
  optionKind: OptionKind | null
  cod: boolean
  /** Cash on delivery as sent to DPD, "199.99"; null before it is known. */
  codAmount: string | null
  currency: string | null
  pudoId: string | null
  /** The destination country (ISO alpha-2). */
  country: string | null
  state: ShipmentState
  /** Null before DPD reports anything. */
  stage: ShipmentStage | null
  /** The last InfoServices event code. */
  status: string | null
  group: ShipmentGroup
  /** The waybill of every box. */
  waybills: string[]
  problems: ProblemDto[]
  error: string | null
  errorCode: string | null
  handedOverAt: string | null
  createdAt: string | null
  mode: DpdMode
  demo: boolean
}

/** GET /admin/dpd/shipments query: filter, search (order number, waybill, Pickup point), paging. */
export type ShipmentsQuery = {
  filter?: ShipmentFilter
  q?: string
  offset?: number
  limit?: number
}

/** GET /admin/dpd/shipments: one page of rows of the current mode, and the counts for the filter buttons. */
export type ShipmentsResponse = {
  shipments: ShipmentDto[]
  count: number
  offset: number
  limit: number
  counts: CountsDto
}

/** One line of the history of a shipment. */
export type EventDto = {
  id: string
  shipmentId: string | null
  orderId: string | null
  kind: "status" | "action" | "run" | string
  status: string | null
  previousStatus: string | null
  source: string | null
  message: string | null
  actor: string | null
  occurredAt: string
  demo: boolean
}

/** GET /admin/dpd/orders/:orderId: the order widget card. */
export type OrderDpdResponse = {
  mode: DpdMode
  configured: boolean
  /** The DPD option the customer chose (from the shipping method), even before a fulfillment. */
  chosen: {
    optionId: string
    optionKind: OptionKind | null
    cod: boolean
    pudoId: string | null
    country: string | null
    methodName: string | null
  } | null
  shipments: ShipmentDto[]
  events: EventDto[]
  writers: Record<WriterKey, WriterDto>
}

/** POST /admin/dpd/writers: arm or disarm one writer for the current mode. */
export type WriterRequest = {
  writer: WriterKey
  armed: boolean
}

/** POST /admin/dpd/writers answer: every writer after the change. */
export type WritersResponse = {
  writers: Record<WriterKey, WriterDto>
}

/** POST /admin/dpd/demo/seed (demo mode only): builds the sample rows once. */
export type DemoSeedResponse = {
  /** False when the rows were already there. */
  seeded: boolean
  created: number
  mode: DpdMode
}

/** POST /admin/dpd/demo/reset (demo mode only): removes the demo rows and demo keys. */
export type DemoResetResponse = {
  removed: { shipments: number; documents: number; events: number; dispatches: number; settings: number }
}

/**
 * The error of any route:
 *
 *   writer_off       the option turns the writer off (409)
 *   writer_unknown   not one of the three writers (400)
 *   not_demo         a demo route outside demo mode (409)
 *   not_found        no such order or row (404)
 *   invalid          a broken request (400)
 */
export type ErrorResponse = {
  code: "writer_off" | "writer_unknown" | "not_demo" | "not_found" | "invalid" | string
  message: string
}
