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
export type WriterKey = "shipment" | "fulfillmentStatus"
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

export interface LocalizedTextDto {
  en?: string
  pl?: string
}

export interface ReferenceDto {
  name: string
  url: string | null
  soon: boolean
  icon: string | null
  description: LocalizedTextDto | null
  metrics: Array<{ label: LocalizedTextDto; value: string }>
  links: Array<{ label: LocalizedTextDto; url: string }>
  review: {
    rating: number
    scale: number
    source: string
    url: string | null
    icon: string | null
    quote: LocalizedTextDto | null
    author: string | null
  } | null
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
  references: ReferenceDto[]
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
