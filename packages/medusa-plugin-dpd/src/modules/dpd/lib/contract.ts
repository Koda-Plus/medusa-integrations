/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN. Types and plain constants
 * only, zero imports: the admin bundle imports this file and Vite never sees
 * server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. Passwords and keys stay on the
 * server; the admin learns only whether each is set.
 *
 * NOTHING ABOUT THE RECEIVER IS KEPT AT REST: no row, document list or
 * history line carries the receiver's name, phone, e-mail or street. The one
 * type that shows them is PlanDto, read live from the order when the plan is
 * built and answered with `Cache-Control: private, no-store`.
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
 * Routes of stage 2, one shipment (`:id` is a row of the current mode; every
 * answer is private, no-store):
 *
 *   GET  /admin/dpd/shipments/:id          ShipmentResponse
 *   GET  /admin/dpd/shipments/:id/plan     PlanResponse
 *   POST /admin/dpd/shipments/:id/create   CreateRequest  -> ActionResponse
 *   POST /admin/dpd/shipments/:id/label    LabelRequest   -> ActionResponse
 *   GET  /admin/dpd/shipments/:id/label    the label PDF (?download=1 saves it)
 *   POST /admin/dpd/shipments/:id/lookup   {}             -> ActionResponse
 *   POST /admin/dpd/shipments/:id/skip     {}             -> ActionResponse
 *   POST /admin/dpd/shipments/:id/accept   {}             -> ActionResponse
 *   POST /admin/dpd/shipments/:id/boxes    BoxesRequest   -> PlanResponse
 *
 * Routes of stage 3, DPD Pickup points (the store routes are public, need the
 * publishable key Medusa asks for and answer `public, max-age=300`):
 *
 *   GET  /store/dpd/points                 zip [city, address] | lat, lng; cod, limit -> PointsResponse
 *   GET  /store/dpd/points/:id             PointResponse
 *   GET  /admin/dpd/points                 the same query -> PointsResponse (no-store)
 *   POST /admin/dpd/shipments/:id/point    SetPointRequest -> PlanResponse
 *
 * Routes of stage 4, the handover to the courier (`:id` of a dispatch is a
 * row of the current mode; every answer is private, no-store):
 *
 *   GET  /admin/dpd/dispatches                     DispatchesQuery           -> DispatchesResponse
 *   POST /admin/dpd/dispatch-plan                  DispatchPlanRequest       -> DispatchPlanResponse
 *   POST /admin/dpd/dispatches                     CreateDispatchRequest     -> DispatchResponse
 *   GET  /admin/dpd/dispatches/:id                 DispatchResponse
 *   POST /admin/dpd/dispatches/:id/print           {}                        -> DispatchResponse
 *   GET  /admin/dpd/dispatches/:id/protocol        the protocol PDF (?download=1, ?document=<id>)
 *   GET  /admin/dpd/dispatches/:id/availability    AvailabilityResponse
 *   POST /admin/dpd/courier-availability           GroupAvailabilityRequest  -> AvailabilityResponse
 *   POST /admin/dpd/dispatches/:id/order           CourierOrderRequest       -> DispatchResponse
 *   POST /admin/dpd/dispatches/:id/reschedule      CourierOrderRequest       -> DispatchResponse
 *   POST /admin/dpd/dispatches/:id/cancel-courier  {}                        -> DispatchResponse
 *   POST /admin/dpd/dispatches/:id/resolve         ResolveDispatchRequest    -> DispatchResponse
 *   POST /admin/dpd/dispatches/:id/cancel          {}                        -> DispatchResponse
 *   POST /admin/dpd/shipments/:id/exclude          {}                        -> ActionResponse
 *   POST /admin/dpd/shipments/:id/restore          {}                        -> ActionResponse
 *   POST /admin/dpd/shipments/:id/withdraw         {}                        -> WithdrawResponse
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
  | "excluded"
/** Where the parcel is, from the InfoServices events (stage 5). */
export type ShipmentStage = "preparing" | "ready" | "in_transit" | "in_point" | "delivered" | "problem" | "returned" | "canceled"
/** The state of a handover to the courier (protocol and courier order). */
export type DispatchState = "pending" | "printing" | "printed" | "ordering" | "ordered" | "updating" | "unknown" | "canceled"
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
 *   canceled     canceled, shipped outside Medusa or marked not to be sent
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
  if (row.state === "canceled" || row.state === "skipped" || row.state === "excluded") return "canceled"
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
  /** "dpd": DPD said it at the last attempt (kept on a failed row next to the plan problems). */
  source?: "dpd"
}

/** A warning of a plan: a problem that does not stop the plan; order_paid carries the amount already captured, for the admin to format. */
export type PlanWarningDto = ProblemDto & {
  amount?: { minor: number; currency: string }
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

/** The number of rows per group of the current mode, plus all, the rows needing attention and the dispatches. */
export type CountsDto = Record<ShipmentGroup, number> & {
  all: number
  /** to_create + problems + dispatchesAttention. */
  attention: number
  /** Dispatches not canceled. */
  dispatches: number
  /** Dispatches that need a person (DS18). */
  dispatchesAttention: number
}

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
  /** How Pickup points are checked: catalog (demo, sandbox), mypudo (live with MyPudo credentials), not_configured (live without: every point is accepted unchecked). */
  pickupCheck: "catalog" | "mypudo" | "not_configured"
  /** How courier orders run: demo (simulated, demo mode), simulated (sandbox, DS4), dpd (live). */
  courierOrders: "demo" | "simulated" | "dpd"
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
  /** The package reference sent to DPD (the fulfillment id). */
  reference: string | null
  /** The DPD session of the waybills; null before DPD gave them, and after an adoption. */
  sessionId: string | null
  /** How many times the row was claimed to talk to DPD. */
  attempts: number
  /** The boxes as last sent or set by hand; null before any. */
  boxes: BoxDto[] | null
  updatedAt: string | null
  /** unknown | abandoned_unknown: the time a lookup may run (updated_at + UNKNOWN_SETTLE_MS); null otherwise. */
  lookupAfter: string | null
  actions: ShipmentActions
  /** The dispatch the shipment is in; null when free. */
  dispatchId: string | null
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
  dispatchId: string | null
  /** dpd_event.data.action when it is a string (DISPATCH_ACTIONS for dispatch rows), else null; the admin history reads dispatch.history.<action>. */
  action: string | null
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
  /** The dispatches of the order's shipments, newest first. */
  dispatches: DispatchDto[]
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

/** The boxes of a row or a plan, as the admin sees them. */
export type BoxDto = {
  weightKg: number
  lengthCm: number | null
  widthCm: number | null
  heightCm: number | null
  reference: string | null
  waybill: string | null
}

/** What a person may do with a row now (state only; the admin also checks writers.shipment.armed). */
export type ShipmentActions = {
  /** pending | failed, outbound: open the plan. */
  plan: boolean
  /** pending | failed, outbound. */
  create: boolean
  /** pending | failed: change the boxes. */
  boxes: boolean
  /** created: get the label from DPD (POST). */
  fetchLabel: boolean
  /** labeled, or ambiguous | abandoned_unknown with waybills: open or download the stored label (GET). */
  label: boolean
  /** unknown | abandoned_unknown without waybills: check in DPD. */
  lookup: boolean
  /** ambiguous with waybills: accept the waybills DPD gave. */
  accept: boolean
  /** pending | failed | ambiguous: mark as shipped outside Medusa. */
  skip: boolean
  /** created | labeled, outbound, no dispatch, handed_over_at null (demo seed rows with handedOver are not candidates, 6.12 point 2, E23): mark "do not send" (DS15). */
  exclude: boolean
  /** excluded: back to labeled (stored label) or created. */
  restore: boolean
  /** in a dispatch (dispatchId set): withdraw; the server checks the dispatch state (DS12). */
  withdraw: boolean
  /** a candidate (DS5 on the row alone): can be picked for a dispatch. */
  dispatch: boolean
}

/** A stored document of a shipment, without its bytes. */
export type DocumentDto = {
  id: string
  type: "label" | "return_label" | "protocol"
  format: "PDF"
  page: LabelPage | null
  createdAt: string | null
  createdBy: string | null
}

/** An address of a plan: the receiver read live from the order, or the sender. */
export type PlanAddressDto = {
  company: string | null
  name: string | null
  address: string
  city: string
  postalCode: string
  countryCode: string
  phone: string | null
  email: string | null
}

/** The plan as the admin sees it: read live from the order, never stored. */
export type PlanDto = {
  ok: boolean
  optionId: string
  kind: OptionKind | null
  cod: boolean
  sessionType: "DOMESTIC" | "INTERNATIONAL" | null
  country: string | null
  receiver: PlanAddressDto | null
  sender: PlanAddressDto | null
  senderLocationId: string | null
  boxes: BoxDto[]
  boxesSource: "edited" | "variants" | "default_box" | "none"
  /** Sum of the box weights, kg. */
  weightKg: number
  /** "249.90" and the currency; null without cash on delivery on this shipment. */
  codAmount: { amount: string; currency: CodCurrency } | null
  reference: string
  problems: ProblemDto[]
  warnings: PlanWarningDto[]
  /** The exact JSON for DPD (shown raw on request), null with problems. */
  request: unknown
  hash: string
  /** Pickup: the point read now (also missing and invalid); null for a courier plan or a Pickup plan without an order. */
  point: PlanPointDto | null
  /** Pickup: who collects (read live, never stored); null for a courier plan. */
  pudoReceiver: PlanPudoReceiverDto | null
}

/** GET /admin/dpd/shipments/:id/plan */
export type PlanResponse = {
  shipment: ShipmentDto
  plan: PlanDto
  writerArmed: boolean
  mode: DpdMode
  /** The page the create action asks for by default (Settings, else the option). */
  labelPage: LabelPage
}

/** POST /admin/dpd/shipments/:id/create */
export type CreateRequest = { planHash: string; page?: LabelPage }
/** POST /admin/dpd/shipments/:id/label */
export type LabelRequest = { page?: LabelPage }
/** POST /admin/dpd/shipments/:id/boxes; null goes back to automatic boxes. */
export type BoxesRequest = {
  boxes: Array<{ weightKg: number | string; lengthCm?: number | string | null; widthCm?: number | string | null; heightCm?: number | string | null }> | null
}
/** POST /admin/dpd/shipments/:id/point; the answer is PlanResponse (the row with the new pudoId and the fresh plan). */
export type SetPointRequest = { pudoId: string }
/** The answer of every action route (create, label POST, lookup, skip, accept). */
export type ActionResponse = { shipment: ShipmentDto }
/** GET /admin/dpd/shipments/:id */
export type ShipmentResponse = { shipment: ShipmentDto; documents: DocumentDto[]; events: EventDto[]; writerArmed: boolean; labelPage: LabelPage }

/** ErrorResponse.code values of the actions (stage 2), of the Pickup point routes (stage 3) and of the handover (stage 4). */
export const ACTION_ERROR_CODES = [
  "writer_off", "writer_unknown", "not_armed", "not_configured", "not_demo", "not_found", "invalid",
  "plan_problems", "plan_hash_missing", "plan_changed", "busy", "wrong_state", "too_early", "no_label",
  "not_pickup", "point_refused", "points_unavailable", "rate_limited", "point_not_found",
  "availability_unavailable", "availability_refused", "courier_window", "no_check_sum", "marker_failed", "not_candidate",
] as const
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number]

/** Every value dpd_shipment.error_code can hold: the DPD codes (DPD_ERROR_CODES, repeated here, this file has no imports) and the flow codes. */
export const SHIPMENT_ERROR_CODES = [
  "timeout", "network", "server_error", "bad_answer", "unknown_status", "dpd_unknown_error",
  "not_processed", "no_waybill", "partial", "not_pdf", "http_404",
  "auth", "payer_fid", "forbidden", "disabled_api", "incorrect_data", "validation",
  "rate_limited", "unsupported", "bad_request", "not_configured", "alternative_number",
  "rate_limited_manual",
  "lease_expired", "label_lease_expired", "label_unclear", "label_not_found",
  "adopted", "adopt_failed", "waybill_count_mismatch", "waybill_mismatch", "duplicate_not_found",
  "not_created", "abandoned_found", "lookup_failed", "no_client",
  "point_unchecked",
] as const
export type ShipmentErrorCode = (typeof SHIPMENT_ERROR_CODES)[number]

/**
 * The error of any route:
 *
 *   writer_off         the option turns the writer off (409)
 *   writer_unknown     not one of the three writers (400)
 *   not_armed          the writer is not armed in Settings (409)
 *   not_configured     sandbox or live without credentials (409)
 *   not_demo           a demo route outside demo mode (409)
 *   not_found          no such order or row (404)
 *   invalid            a broken request (400)
 *   plan_problems      the plan has problems to fix first (422)
 *   plan_hash_missing  the plan was not read (400)
 *   plan_changed       the plan changed since it was read (409)
 *   busy               another process holds the row (409)
 *   wrong_state        not possible in the state of the row (409)
 *   too_early          a lookup before the row settled (409)
 *   no_label           no stored label (404)
 *   not_pickup          the row does not go to a Pickup point (409)
 *   point_refused       the point cannot take this shipment (422, with problems)
 *   points_unavailable  the point search cannot answer now (502) or is not configured or busy (503)
 *   rate_limited        too many point searches from this address (429, Retry-After)
 *   point_not_found     no Pickup point a parcel can go to under this id (404)
 *   availability_unavailable  DPD did not answer the availability (503): nothing sent
 *   availability_refused      no courier for this postal code (RANGE_NOT_FOUND, POSTAL_CODE_NOT_FOUND) (422)
 *   courier_window            the date or the window is not allowed (422, with fields)
 *   no_check_sum              the courier order has no checkSum: change or cancel it at DPD (409)
 *   marker_failed             the handover marker could not be written to the fulfillment: nothing sent (503)
 *   not_candidate             the shipment cannot be excluded, restored or withdrawn in its state (409)
 *
 * `problems` also comes with plan_problems (the problems of a dispatch plan
 * or its orderProblems) and courier_window (the problems of the window);
 * `fields` also with courier_window ({ index: 0, field: <the key of the
 * body> }) and with invalid for shipmentIds ({ index: <the position>,
 * field: "shipmentIds" }). plan_problems, plan_hash_missing, plan_changed,
 * busy, wrong_state, not_found and invalid mean in the routes of the
 * handover what they mean for a shipment.
 */
export type ErrorResponse = {
  code: ActionErrorCode | string
  message: string
  /** invalid boxes (POST .../boxes): each wrong field, by the 0-based box index and the BoxDto field name (weightKg, lengthCm, widthCm, heightCm); also courier_window and invalid shipmentIds. */
  fields?: FieldErrorDto[]
  /** point_refused: the problems of the chosen point; plan_problems and courier_window: the problems of the plan or the window. */
  problems?: ProblemDto[]
}

/** One wrong field of a request: the 0-based index of the item and its field name. */
export type FieldErrorDto = { index: number; field: string }

/* ------------------------------------------------------------------ */
/* Stage 3: DPD Pickup points                                          */
/* ------------------------------------------------------------------ */

/** Where the points come from: MyPudo (live), the test catalog (sandbox), the sample catalog (demo). */
export type PointsSourceKind = "live" | "sandbox" | "demo"

/** One opening range of a point: day 1 (Monday) to 7 (Sunday), "08:00" to "18:00". */
export type PointHoursDto = { day: 1 | 2 | 3 | 4 | 5 | 6 | 7; from: string; to: string }

/** What a point takes: the weight and the box by kind of point. */
export type PointLimitsDto = {
  maxKg: number
  box:
    | { kind: "fits"; sidesCm: [number, number, number] }        // sorted, longest first
    | { kind: "sum"; maxSideCm: number; maxSumCm: number }
    | { kind: "girth"; maxLengthCm: number; maxGirthCm: number }
}

/** A DPD Pickup point as the store and the admin get it. Public data only. */
export type PointDto = {
  id: string                  // "PL14509"
  name: string
  type: string                // pudoType as MyPudo gives it ("300")
  isLocker: boolean
  partner: string | null
  address: { line1: string; line2: string | null; zip: string; city: string; country: string }   // country alpha-2
  lat: number | null
  lng: number | null
  active: boolean
  services: string[]          // known codes only (POINT_SERVICES), sorted
  delivery: boolean           // service 100
  cod: boolean                // service 101
  hours: PointHoursDto[]
  distance: number | null     // metres, coordinate search only
  limits: PointLimitsDto
}

/** GET /store/dpd/points, GET /admin/dpd/points */
export type PointsResponse = { points: PointDto[]; source: PointsSourceKind }
/** GET /store/dpd/points/:id */
export type PointResponse = { point: PointDto; source: PointsSourceKind }

/** The point of a Pickup plan, read now. */
export type PlanPointDto = {
  /** null only with check "missing". */
  pudoId: string | null
  /** missing: no point chosen; invalid: the id is not a DPD Pickup id (E3). */
  check: "ok" | "not_found" | "unchecked" | "missing" | "invalid"
  point: PointDto | null
  /** unchecked only: not_configured | timeout | network | http | invalid_answer | api_error. */
  reason: string | null
  source: PointsSourceKind
}

/** Who collects at the point, as the plan sends it (read live from the order, never stored). */
export type PlanPudoReceiverDto = { company: string | null; name: string; countryCode: string; phone: string | null; email: string | null }

/* ------------------------------------------------------------------ */
/* Stage 4: the handover to the courier                                */
/* ------------------------------------------------------------------ */

/** One parsed availability range (11a): "08:00-16:00", offset in minutes [NZ: shown, not enforced]. */
export type CourierRangeDto = { from: string; to: string; offset: number | null; raw: string }

/** packagesParams as the admin sees it. */
export type DispatchParamsDto = {
  count: number
  weightKg: number
  maxWeightKg: number
  maxHeightCm: number
  maxWidthCm: number
  maxDepthCm: number
  /** false: no box had a side, 1 cm sent (dims_unknown). */
  dimsKnown: boolean
}

/** One stored protocol of a dispatch, without its bytes. */
export type DispatchProtocolDto = {
  /** dpd_document.id (GET .../protocol?document=<id>). */
  id: string
  documentId: string | null
  createdAt: string | null
  /** Shipments it lists. */
  shipments: number
  /** It does not list exactly the shipments of the dispatch now (protocol_stale). */
  stale: boolean
}

/** What a person may do with a dispatch now (state only; the admin also checks the writers). */
export type DispatchActions = {
  /** pending: print the protocol (writer shipment). */
  print: boolean
  /** printed | ordered: print again (a new document). */
  reprint: boolean
  /** a protocol is stored: open or download it. */
  protocol: boolean
  /** printed, canOrder: order the courier (writer pickup). */
  order: boolean
  /** ordered with a checkSum: new date or window (PATCH). */
  reschedule: boolean
  /** ordered with a checkSum: cancel the courier (DELETE). */
  cancelCourier: boolean
  /** unknown, ordered with an errorCode of DISPATCH_ATTENTION_CODES (O13, O17), or ordered without a checkSum (O16: the only local way out when the courier was called off at DPD; no attention): ordered or not ordered. */
  resolve: boolean
  /** pending | printed: cancel the dispatch. */
  cancel: boolean
  /** pending | printed | ordered (with a checkSum): withdraw a shipment. */
  withdraw: boolean
}

export type DispatchDto = {
  id: string
  mode: DpdMode
  demo: boolean
  state: DispatchState
  locationId: string | null
  sender: PlanAddressDto | null
  shipmentIds: string[]
  /** The shipments now in the dispatch (rows), for the drawer. */
  shipments: ShipmentDto[]
  boxes: number
  weightKg: number
  params: DispatchParamsDto | null
  /** Step 2 problems and the problems of the last DPD refusal (source "dpd"); never a code of DISPATCH_WARNING_CODES (E22). */
  problems: ProblemDto[]
  /** Plan warnings kept in the problems column (dims_unknown, sample_sender), split out by toDispatchDto; shown orange (warning.*), never block an action (E22). */
  warnings: ProblemDto[]
  /** Read now, only for one dispatch (GET .../dispatches/:id and every action answer, dispatchResponse): shipment_canceled with field "shipments.<id>" for a shipment whose fulfillment is canceled (or, outside demo, missing). Always [] in the list, the order card and withdraw (dispatchDtos), which read no fulfillments (E4). */
  shipmentProblems: ProblemDto[]
  protocols: DispatchProtocolDto[]
  protocolAt: string | null
  pickupDate: string | null
  pickupTimeFrom: string | null
  pickupTimeTo: string | null
  orderType: "DOMESTIC" | null
  /** Shown; null before an order or after "ordered" without a number. */
  orderNumber: string | null
  /** The checkSum itself never leaves the server. */
  hasCheckSum: boolean
  orderedAt: string | null
  /** The courier order of this dispatch is (or would be) simulated: demo or sandbox. */
  simulated: boolean
  /** null while the row is claimed (the claim presets the code of a lease expiry). */
  error: string | null
  errorCode: string | null
  attempts: number
  createdBy: string | null
  updatedBy: string | null
  createdAt: string | null
  updatedAt: string | null
  attention: boolean
  actions: DispatchActions
}

/** POST /admin/dpd/dispatch-plan */
export type DispatchPlanRequest = { shipmentIds: string[] }

export type DispatchGroupDto = { key: string; locationId: string | null; sender: PlanAddressDto | null; shipmentIds: string[] }

export type DispatchPlanShipmentDto = {
  id: string
  orderId: string | null
  displayId: number | null
  reference: string | null
  waybills: string[]
  boxes: number
  weightKg: number
  problems: ProblemDto[]
}

export type DispatchPlanDto = {
  ok: boolean
  canOrder: boolean
  groups: DispatchGroupDto[]
  locationId: string | null
  sender: PlanAddressDto | null
  orderer: { name: string; fullName: string; phone: string } | null
  shipments: DispatchPlanShipmentDto[]
  params: DispatchParamsDto | null
  problems: ProblemDto[]
  orderProblems: ProblemDto[]
  warnings: ProblemDto[]
  hash: string
}

export type DispatchPlanResponse = { plan: DispatchPlanDto; mode: DpdMode; writers: Record<WriterKey, WriterDto>; courierOrders: "demo" | "simulated" | "dpd" }

/** POST /admin/dpd/dispatches; print: print the protocol in the same click (writer shipment). */
export type CreateDispatchRequest = { shipmentIds: string[]; planHash: string; print?: boolean }
/** POST .../order and .../reschedule */
export type CourierOrderRequest = { pickupDate: string; pickupTimeFrom: string; pickupTimeTo: string }
/** POST .../resolve (DS7). */
export type ResolveDispatchRequest = { outcome: "ordered" | "not_ordered"; orderNumber?: string }

/** GET /admin/dpd/dispatches/:id and the answer of every dispatch action. */
export type DispatchResponse = {
  dispatch: DispatchDto
  events: EventDto[]
  writers: Record<WriterKey, WriterDto>
  courierOrders: "demo" | "simulated" | "dpd"
}

/** The filter of the dispatch list (store, route and admin). */
export type DispatchFilter = "open" | "attention" | "all"
/** GET /admin/dpd/dispatches */
export type DispatchesQuery = { filter?: DispatchFilter; offset?: number; limit?: number }
export type DispatchesResponse = { dispatches: DispatchDto[]; count: number; offset: number; limit: number; open: number; attention: number }

/** GET /admin/dpd/dispatches/:id/availability and POST /admin/dpd/courier-availability (read now, never stored). */
export type AvailabilityResponse = {
  postalCode: string
  countryCode: "PL"
  ranges: CourierRangeDto[]
  /** today .. today + 14, Europe/Warsaw. */
  days: string[]
  today: string
  /** HH:mm of the server's now in Europe/Warsaw (warsawTime(now)): courierWindowChoices compares today's ranges with it, never with the browser clock (E7). */
  nowTime: string
  /** true in demo only: the ranges are DEMO_COURIER_RANGES. In sandbox they come from the DPD test host (false), even though the order itself is simulated. */
  simulated: boolean
}

/** POST /admin/dpd/courier-availability: the drawer before the dispatch exists (DS11); groupKey is a DispatchGroup.key of the plan of these ids. */
export type GroupAvailabilityRequest = { shipmentIds: string[]; groupKey: string }

/** POST /admin/dpd/shipments/:id/withdraw. withdrawn false: DPD refused or did not answer the PATCH or DELETE (dispatch.errorCode says why). */
export type WithdrawResponse = { shipment: ShipmentDto; dispatch: DispatchDto; withdrawn: boolean; warnings: ProblemDto[] }

/** The error codes of an ordered dispatch that ask a person to act (DS18 with O17): the two unclear answers, and the PATCH or DELETE refusals that make the stored order invalid (not found, wrong status, wrong checkSum, wrong order number). */
export const DISPATCH_ATTENTION_CODES: readonly string[] = [
  "update_unclear", "cancel_unclear",
  "order_not_found", "order_status", "checksum", "order_number",
]

/** Unknown, or ordered with an error code of DISPATCH_ATTENTION_CODES. An ordered row without a checkSum alone is not attention (O16). */
export function dispatchNeedsAttention(row: { state: DispatchState; errorCode: string | null }): boolean {
  return row.state === "unknown" || (row.state === "ordered" && row.errorCode !== null && DISPATCH_ATTENTION_CODES.includes(row.errorCode))
}

/** Every value dpd_dispatch.error_code can hold: DPD_ERROR_CODES, COURIER_ERROR_CODES (repeated, no imports) and the flow codes. */
export const DISPATCH_ERROR_CODES = [
  "timeout", "network", "server_error", "bad_answer", "unknown_status", "dpd_unknown_error",
  "not_processed", "no_waybill", "partial", "not_pdf", "http_404",
  "auth", "payer_fid", "forbidden", "disabled_api", "incorrect_data", "validation",
  "rate_limited", "unsupported", "bad_request", "not_configured", "alternative_number",
  "protocol_not_found", "session_type", "pickup_fid", "pickup_address", "parcel_limit",
  "postal_code_not_found", "range_not_found", "postal_pattern", "country_not_found",
  "order_closed", "checksum", "pickup_time", "order_not_found", "order_number", "order_status",
  "service_unavailable", "no_order_number",
  "protocol_unclear", "order_unclear", "update_unclear", "cancel_unclear", "marker_failed", "plan_changed",
] as const
export type DispatchErrorCode = (typeof DISPATCH_ERROR_CODES)[number]
