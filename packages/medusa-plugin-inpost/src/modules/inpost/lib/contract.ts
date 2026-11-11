/**
 * CONTRACT BETWEEN THE API ROUTES AND THE ADMIN (and the storefront route).
 * Types only, zero imports: the admin bundle imports them and Vite never sees
 * server code.
 *
 * NO TYPE HERE HAS A FIELD FOR A SECRET. The ShipX token stays on the server
 * (the admin learns only whether it is set). Receiver details appear only in
 * a plan, which is built from the order on request and never stored.
 */

export type InpostMode = "demo" | "live"
export type ParcelKind = "locker" | "courier"
export type ParcelSize = "small" | "medium" | "large"
export type LabelSize = "A6" | "A4"
export type ParcelState = "pending" | "creating" | "created" | "failed" | "unknown" | "skipped" | "canceled"
export type ShipmentStage = "preparing" | "ready" | "in_transit" | "in_locker" | "delivered" | "problem" | "returned" | "canceled"
/** The lists of the Panel. */
export type PanelGroup = "to_create" | "waiting" | "in_transit" | "in_locker" | "delivered" | "problems"
export type ParcelFilter = "all" | PanelGroup | "canceled" | "skipped"
export type WriterKey = "shipment" | "fulfillmentStatus" | "returns"
export type RunTrigger = "schedule" | "manual" | "webhook"

export interface LockerAddressDto {
  line1: string
  line2: string
  city: string
  post_code: string
}

export interface LockerDto {
  code: string
  name: string | null
  address: LockerAddressDto | null
  /** A map search of the locker. */
  mapUrl: string | null
}

export interface ProblemDto {
  code: string
  detail?: string
}

export interface ParcelDto {
  id: string
  orderId: string
  displayId: number | null
  fulfillmentId: string | null
  optionId: string
  kind: ParcelKind
  cod: boolean
  service: string
  locker: LockerDto | null
  /** The size of this shipment; null: the default of Settings. */
  size: ParcelSize | null
  parcelNo: number
  /** Cash on delivery sent to ShipX, "199.99" (set once the shipment exists). */
  codAmount: string | null
  currency: string | null
  reference: string | null
  state: ParcelState
  /** The ShipX status and the stage it means; null before the shipment exists. */
  status: string | null
  stage: ShipmentStage | null
  group: PanelGroup | "canceled" | "skipped"
  statusAt: string | null
  shipmentId: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  sendingMethod: string | null
  /** The problems of the last plan (to_create rows). */
  problems: ProblemDto[]
  skipReason: string | null
  /** The shipment was not created by this plugin (adopted from an order shipped outside Medusa). */
  external: boolean
  error: string | null
  errorCode: string | null
  attempts: number
  createdBy: string | null
  shipmentCreatedAt: string | null
  /** A prepaid account: the offer ShipX prepared, waiting to be bought. */
  offer: { id: string; rate: number | null; currency: string | null; status: string | null } | null
  dispatch: { state: string; orderId: string | null; error: string | null; at: string | null } | null
  fulfillmentCanceledAt: string | null
  shippedMarkedAt: string | null
  deliveredMarkedAt: string | null
  statusWriterError: string | null
  lastCheckedAt: string | null
  demo: boolean
  createdAt: string | null
  updatedAt: string | null
  /** What a person may do now (the writer must also be armed for the writes). */
  actions: {
    plan: boolean
    create: boolean
    cancel: boolean
    buy: boolean
    label: boolean
    refresh: boolean
    changeLocker: boolean
    changeSize: boolean
    retry: boolean
    lookup: boolean
    link: boolean
    skip: boolean
  }
}

export interface ParcelEventDto {
  id: string
  parcelId: string | null
  orderId: string | null
  shipmentId: string | null
  kind: "status" | "webhook" | "action" | "run" | string
  status: string | null
  previousStatus: string | null
  source: string | null
  message: string | null
  data: Record<string, unknown> | null
  actor: string | null
  occurredAt: string
  demo: boolean
}

export interface WriterDto {
  key: WriterKey
  /** The option allows it. */
  allowed: boolean
  /** A person armed it in Settings. */
  on: boolean
  armed: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export interface SenderDto {
  companyName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  street: string
  buildingNumber: string
  flatNumber: string
  city: string
  postCode: string
}

export interface SettingsDto {
  sender: SenderDto
  senderSent: boolean
  senderAddress: boolean
  defaultParcelSize: ParcelSize
  labelFormat: LabelSize
  source: { sender: "admin" | "option" | "none"; defaultParcelSize: "admin" | "option"; labelFormat: "admin" | "option" }
}

export interface RunDto {
  id: string
  trigger: string
  occurredAt: string
  message: string | null
  counts: Record<string, number>
}

export interface CheckResult {
  ok: boolean
  mode: InpostMode
  checkedAt: string
  error: string | null
  organization: { id: string; name: string | null; status: string | null; services: string[] } | null
}

export interface StatusResponse {
  mode: InpostMode
  demoReason: "option" | "no_token" | null
  sandbox: boolean
  configured: boolean
  missing: string[]
  /** Option values that were set but ignored. */
  problems: string[]
  tokenSet: boolean
  organizationId: string | null
  counts: Record<PanelGroup, number> & { all: number; canceled: number; skipped: number; attention: number }
  writers: Record<WriterKey, WriterDto>
  autoCreate: boolean
  settings: SettingsDto
  options: {
    sendingMethod: { locker: string | null; courier: string | null }
    dropoffPoint: string | null
    referenceTemplate: string
    weightUnit: "g" | "kg"
    defaultWeightKg: number
    skipMetadataKeys: string[]
    verifyLockers: boolean
    pollEnabled: boolean
    pollMaxAgeDays: number
    requestsPerMinute: number
  }
  webhook: {
    /** A valid secret is set: the route answers. */
    enabled: boolean
    /** A secret is set but not usable (too short, not lowercase). */
    invalid: boolean
    /** The full URL for InPost Manager (live mode only; it carries the secret). */
    url: string | null
    lastAt: string | null
    lastEvent: string | null
  }
  links: { manager: string; webtrucker: string; geowidget: string }
  /** Shipping options of this provider in Medusa (null when Query could not read them). */
  shippingOptions: Array<{ id: string; name: string; optionId: string | null }> | null
  lastRun: RunDto | null
  lastCheck: CheckResult | null
  running: boolean
  schedule: string
  /** The InPost Returns API: configuration and counters of the return rows of this mode. */
  returns: ReturnsStatusDto
  /** The storefront map: what the public Geowidget token says (never the whole token). */
  geowidget: GeowidgetStatusDto
}

export interface GeowidgetStatusDto {
  set: boolean
  readable: boolean
  environment: "sandbox" | "production" | null
  domains: string[]
  expiresAt: string | null
  expired: boolean
  preview: string | null
  /** The token's environment differs from the ShipX one (a sandbox map with production shipments or the other way round). */
  mismatch: boolean
  /** The Geowidget script host the storefront should load. */
  host: string
}

/** GET /store/inpost/geowidget: what a storefront needs to show the map. */
export interface GeowidgetStoreResponse {
  token: string
  environment: "sandbox" | "production"
  host: string
}

export interface ParcelsResponse {
  parcels: ParcelDto[]
  count: number
  offset: number
  limit: number
}

export interface PlanDto {
  ok: boolean
  kind: ParcelKind
  service: string
  receiver: {
    name: string
    phone: string | null
    email: string | null
    address: { street: string; building_number: string; flat_number?: string; city: string; post_code: string; country_code: string } | null
    sample: boolean
  }
  locker: { code: string; name: string | null; address: LockerAddressDto | null } | null
  parcel: { size: ParcelSize; letter: "A" | "B" | "C"; weightKg: number; weightEstimated: boolean; dimensionsMm: { length: number; width: number; height: number } }
  cod: { amount: string; currency: "PLN" } | null
  insurance: { amount: string; currency: "PLN" } | null
  reference: string
  sendingMethod: string | null
  dropoffPoint: string | null
  sender: Record<string, unknown> | null
  pickup: { name: string; phone: string; email: string | null; address: Record<string, string> } | null
  buysOffer: boolean
  problems: ProblemDto[]
  warnings: ProblemDto[]
  /** The exact ShipX request, for the person who wants to see it. */
  request: Record<string, unknown> | null
  hash: string
}

export interface PlanResponse {
  parcel: ParcelDto
  plan: PlanDto
  /** The shipment writer is armed: Create sends this plan. */
  writerArmed: boolean
  mode: InpostMode
}

export interface ParcelDetailResponse {
  parcel: ParcelDto
  events: ParcelEventDto[]
}

export interface OrderInpostResponse {
  mode: InpostMode
  configured: boolean
  /** The InPost option and locker the customer chose (from the shipping method), even before a fulfillment. */
  chosen: { optionId: string; kind: ParcelKind; cod: boolean; locker: LockerDto | null; methodName: string | null } | null
  parcels: ParcelDto[]
  events: ParcelEventDto[]
  writers: Record<WriterKey, WriterDto>
  /** The InPost returns of the order in the current mode. */
  returns: ReturnDto[]
  /** Returns can be created (demo mode, or the Returns API credentials are set). */
  returnsConfigured: boolean
}

export interface PointDto {
  code: string
  name: string
  type: string[]
  status: string | null
  address: { line1: string; line2: string; street: string; building_number: string; city: string; post_code: string; province: string }
  location: { lat: number; lng: number } | null
  description: string | null
  opening_hours: string | null
  is_24_7: boolean
  payment_available: boolean
  distance: number | null
}

export interface PointsResponse {
  points: PointDto[]
  mode: "code" | "postcode" | "near" | "city"
  /** The points of the demo (no request to InPost). */
  demo: boolean
}

export interface ActionResponse {
  parcel: ParcelDto
  message?: string
}

/* ------------------------------------------------------------------ */
/* Returns (InPost Returns API)                                        */
/* ------------------------------------------------------------------ */

/**
 * A return row: pending (recorded, nothing sent), creating (sent, waiting
 * for the answer), created (InPost answered with the return), failed (InPost
 * refused it: fix and try again), unknown (no clear answer: the return may
 * exist; a person checks InPost, then tries again or marks it handled),
 * skipped (handled outside the plugin).
 */
export type ReturnState = "pending" | "creating" | "created" | "failed" | "unknown" | "skipped"
/** How the customer sends it: a short drop-off code typed at any Paczkomat (no printing), or a label. */
export type ReturnMethod = "code" | "label"
export type ReturnFilter = "all" | "open" | "created" | "attention" | "skipped"
export type ReturnsEnvironmentName = "stage" | "production"

export interface ReturnDto {
  id: string
  orderId: string
  displayId: number | null
  /** The Medusa return this InPost return belongs to; null: created for the order from the admin. */
  returnId: string | null
  state: ReturnState
  method: ReturnMethod | null
  reference: string | null
  /** The InPost return shipment (a UUID). */
  shipmentId: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  shortNumber: string | null
  /** The code the customer types at the Paczkomat. */
  dropOffCode: string | null
  hasLabel: boolean
  expiresAt: string | null
  expired: boolean
  skipReason: string | null
  error: string | null
  errorCode: string | null
  attempts: number
  createdBy: string | null
  shipmentCreatedAt: string | null
  lastCheckedAt: string | null
  demo: boolean
  createdAt: string | null
  updatedAt: string | null
  actions: { create: boolean; refresh: boolean; label: boolean; retry: boolean; skip: boolean }
}

export interface ReturnsResponse {
  returns: ReturnDto[]
  count: number
  offset: number
  limit: number
}

export interface ReturnPlanDto {
  ok: boolean
  /** The customer who sends the parcel back (InPost's `sender`), read from the order now, never stored. */
  sender: { name: string; email: string | null; phone: string | null; sample: boolean }
  originCountry: string | null
  method: ReturnMethod
  reference: string
  /** null: the expiry of the InPost account. */
  expirationDate: string | null
  /** Where the parcel goes: always the return address of the InPost account (the plugin sends none). */
  destination: "account"
  problems: ProblemDto[]
  warnings: ProblemDto[]
  /** The exact Returns API request. */
  request: Record<string, unknown> | null
  hash: string
}

export interface ReturnPlanResponse {
  plan: ReturnPlanDto
  /** The row of this order and Medusa return, if one exists already. */
  existing: ReturnDto | null
  /** The returns writer is armed: Create sends this plan. */
  writerArmed: boolean
  configured: boolean
  mode: InpostMode
}

export interface ReturnActionResponse {
  return: ReturnDto
  message?: string
}

export interface ReturnDetailResponse {
  return: ReturnDto
  events: ParcelEventDto[]
}

export interface ReturnsCheckResult {
  ok: boolean
  mode: InpostMode
  environment: ReturnsEnvironmentName
  checkedAt: string
  error: string | null
  /** Seconds the fresh token is valid. */
  expiresIn: number | null
  scope: string | null
}

export interface ReturnsStatusDto {
  /** Demo mode, or the client id, the secret and the organization are set. */
  configured: boolean
  missing: string[]
  environment: ReturnsEnvironmentName
  clientIdSet: boolean
  secretSet: boolean
  /** The organization UUID (not a secret). */
  organizationId: string | null
  expirationDays: number | null
  host: string
  counts: { all: number; open: number; created: number; attention: number; skipped: number }
  lastCheck: ReturnsCheckResult | null
}
