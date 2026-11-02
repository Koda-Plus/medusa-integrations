/**
 * Constants of DPD by Koda Plus. Zero imports, so the admin bundle and the
 * unit tests load this file as it is.
 *
 * What comes from DPD (the DPDServices OpenAPI 5.27.0, the InfoServices,
 * MyPudoAPI and PudoFinder documentation): the hosts, the label pages, the
 * cash on delivery currencies and the shape of a Pickup point id. Stage 2
 * calls DPDServices (generatePackagesNumbers and generateSpedLabels); the
 * other hosts are here so later stages and the admin read one source.
 */

/** Container key of the data module (and the namespace of tables, routes and files). */
export const DPD_MODULE = "dpd"

/** Namespace of the admin dictionaries, routes and file prefixes. */
export const DPD_NS = "dpd"

/** `identifier` of the fulfillment provider. Registered as `{ id: "dpd" }` it becomes `dpd_dpd`. */
export const PROVIDER_IDENTIFIER = "dpd"

/** The provider id Medusa stores on a fulfillment of this provider (`dpd_dpd`, or `dpd_<other id>`). */
export const PROVIDER_ID_PATTERN = /^dpd_/

export function isDpdProviderId(providerId: unknown): boolean {
  return typeof providerId === "string" && PROVIDER_ID_PATTERN.test(providerId)
}

/** DPDServices REST: shipments, labels, protocols, courier orders. The sandbox host is not in the `servers` block of the spec. */
export const DPDSERVICES_HOSTS = {
  live: "https://dpdservices.dpd.com.pl",
  sandbox: "https://dpdservicesdemo.dpd.com.pl",
} as const

/** InfoServices SOAP (statuses). Production only: DPD has no test host for it, so the sandbox simulates statuses. */
export const INFOSERVICES_URL = "https://dpdinfoservices.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents"

/** MyPudoAPI v2 (Pickup points). Production only, no test host. */
export const MYPUDO_URL = "https://mypudo.dpd.com.pl/api/v2/"

/** PudoFinder: the point map widget for the storefront (a key per domain, answers only the point id). */
export const PUDOFINDER_URL = "https://pudofinder.dpd.com.pl"

/** The three modes: everything simulated, the DPD demo host with test credentials, production. */
export const MODES = ["demo", "sandbox", "live"] as const
export type DpdMode = (typeof MODES)[number]

/** Where the customer gets the parcel; `return` is the return option of the admin. */
export type OptionKind = "courier" | "pickup" | "return"

/**
 * The five fulfillment options. The ids are a contract with the shipping
 * options a store creates (their `data.id`) and Medusa never lets them change
 * in an existing shipping option, so they are frozen. The country and the
 * DPD session (DOMESTIC or INTERNATIONAL) come from the address; zones with
 * other prices are other shipping options with the same id.
 */
export const OPTION_IDS = ["dpd-courier", "dpd-courier-cod", "dpd-pickup", "dpd-pickup-cod", "dpd-return"] as const
export type DpdOptionId = (typeof OPTION_IDS)[number]

export type OptionSpec = {
  id: DpdOptionId
  kind: OptionKind
  cod: boolean
  name: string
  description: string
}

export const OPTION_SPECS: readonly OptionSpec[] = [
  {
    id: "dpd-courier",
    kind: "courier",
    cod: false,
    name: "DPD courier",
    description: "Delivery by a DPD courier to the shipping address.",
  },
  {
    id: "dpd-courier-cod",
    kind: "courier",
    cod: true,
    name: "DPD courier, cash on delivery",
    description: "Delivery by a DPD courier, paid by the customer to the courier.",
  },
  {
    id: "dpd-pickup",
    kind: "pickup",
    cod: false,
    name: "DPD Pickup point",
    description: "Delivery to a DPD Pickup point chosen by the customer.",
  },
  {
    id: "dpd-pickup-cod",
    kind: "pickup",
    cod: true,
    name: "DPD Pickup point, cash on delivery",
    description: "Delivery to a DPD Pickup point in Poland, paid by the customer at collection.",
  },
  {
    id: "dpd-return",
    kind: "return",
    cod: false,
    name: "DPD return",
    description: "A return to the store with a DPD return label.",
  },
]

/** Cash on delivery currencies DPDServices accepts (the COD service, attribute CURRENCY). */
export const COD_CURRENCIES = ["PLN", "EUR", "RON", "CZK"] as const
export type CodCurrency = (typeof COD_CURRENCIES)[number]

/** The default of `codCountries`: cash on delivery in Poland, in PLN. Abroad it needs an agreement with DPD. */
export const DEFAULT_COD_COUNTRIES: Readonly<Record<string, readonly CodCurrency[]>> = { PL: ["PLN"] }

/** The member states of the EU (ISO alpha-2), the default of `countries`. Countries outside the EU are outside v1 (customs data). */
export const EU_COUNTRIES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
] as const

/** Cash on delivery at a Pickup point works in Poland only. */
export const PICKUP_COD_COUNTRY = "PL"

/**
 * The label page: `A4` (a sheet for an office printer) or `LBL_PRINTER` (a
 * label printer). DPD has no A6 by that name.
 */
export const LABEL_PAGES = ["A4", "LBL_PRINTER"] as const
export type LabelPage = (typeof LABEL_PAGES)[number]
export const DEFAULT_LABEL_PAGE: LabelPage = "A4"

/** How statuses are read (stage 5): per waybill (default), or the customer queue of a channel given to Medusa alone. */
export const TRACKING_MODES = ["waybill", "queue"] as const
export type TrackingMode = (typeof TRACKING_MODES)[number]

/**
 * A DPD Pickup point id: the country prefix (ISO alpha-2) and a digit, then
 * letters or digits, 5 to 18 characters in all, like PL14509 or PL11726 (the
 * examples of MyPudoAPI and DPDServices). DPD documents no formal pattern, so
 * this only refuses what cannot be an id; whether the point exists and is
 * active is checked with MyPudoAPI in stage 3.
 */
export const PUDO_ID_PATTERN = /^[A-Z]{2}\d[A-Z0-9]{2,15}$/

/** The rows of the plugin: a shipment of a fulfillment, or a return. */
export const SHIPMENT_KINDS = ["outbound", "return"] as const
export type ShipmentKind = (typeof SHIPMENT_KINDS)[number]

/**
 * The states of a shipment row (`dpd_shipment.state`):
 *
 *   pending            recorded, nothing sent to DPD
 *   creating           claimed for generatePackagesNumbers (a lease runs)
 *   created            DPD gave the waybills, no label yet
 *   labeling           claimed for generateSpedLabels (it advises the parcels)
 *   labeled            the label is stored in dpd_document
 *   failed             DPD refused clearly; a person fixes and tries again
 *   unknown            no clear answer (timeout, 5xx on a write): resolved
 *                      by a lookup before anything is sent again
 *   ambiguous          DPD's waybills do not match what was sent (their
 *                      number or set), or DPD reports the reference taken
 *                      and finds no shipment under it: for a person
 *   abandoned_unknown  canceled while unknown: the parcel may exist in DPD
 *   skipped            shipped outside Medusa
 *   canceled           the fulfillment or the shipment was canceled
 */
export const SHIPMENT_STATES = [
  "pending",
  "creating",
  "created",
  "labeling",
  "labeled",
  "failed",
  "unknown",
  "ambiguous",
  "abandoned_unknown",
  "skipped",
  "canceled",
] as const
export type ShipmentState = (typeof SHIPMENT_STATES)[number]

/**
 * Where a parcel is, for the shop (`dpd_shipment.stage`), mapped from the
 * InfoServices event codes in stage 5. An unknown code reads as in_transit
 * for the panel and never triggers a write in Medusa.
 */
export const SHIPMENT_STAGES = ["preparing", "ready", "in_transit", "in_point", "delivered", "problem", "returned", "canceled"] as const
export type ShipmentStage = (typeof SHIPMENT_STAGES)[number]

/** The states of a handover to the courier (`dpd_dispatch.state`). An unknown courier order is never retried by itself: a second courier costs money. */
export const DISPATCH_STATES = ["pending", "ordering", "ordered", "unknown", "canceled"] as const
export type DispatchState = (typeof DISPATCH_STATES)[number]

/** The documents kept in `dpd_document`. */
export const DOCUMENT_TYPES = ["label", "return_label", "protocol"] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

/** Labels and protocols are kept this many days by default (reprints without a second advice). */
export const DEFAULT_DOCUMENT_RETENTION_DAYS = 90

/** The heaviest box a courier order takes (DPD `maxWeight` of a parcel in packagesPickupCall). */
export const COURIER_ORDER_MAX_KG = 50

/** Weight limits of one box in DPDServices: 0.01 kg to 700 kg in Poland, 315 kg abroad. */
export const BOX_WEIGHT_MIN_KG = 0.01
export const BOX_WEIGHT_MAX_KG = 700
/** Each side of a box: 1 to 300 cm. */
export const BOX_SIDE_MIN_CM = 1
export const BOX_SIDE_MAX_CM = 300

/** The rows the demo builds from the store's newest orders. */
export const DEMO_ROWS = 16

/* ------------------------------------------------------------------ */
/* Stage 2: the courier in Poland, labels, cash on delivery            */
/* ------------------------------------------------------------------ */

/** The client never waits longer than this for its pacing slot: it sends nothing and answers rate_limited instead. */
export const PACING_MAX_WAIT_MS = 15_000
/**
 * A claim of generatePackagesNumbers (and the adoption label call in the
 * same claim) lasts this long. It must exceed 2 x (TIMEOUT_MAX_MS +
 * PACING_MAX_WAIT_MS): two calls, each waiting for its slot at most and
 * then for its answer at most.
 */
export const CREATE_LEASE_MS = 180_000
/** A claim of generateSpedLabels, the same bound as CREATE_LEASE_MS. */
export const LABEL_LEASE_MS = 180_000
/** An unclear row is looked up in DPD only this long after it last changed (updated_at). */
export const UNKNOWN_SETTLE_MS = 120_000
export const DEFAULT_TIMEOUT_MS = 20_000
export const TIMEOUT_MIN_MS = 5_000
export const TIMEOUT_MAX_MS = 45_000
export const DEFAULT_REQUESTS_PER_MINUTE = 60
/** The lowest requestsPerMinute: a slower pace would make the pacing wait longer than PACING_MAX_WAIT_MS. */
export const REQUESTS_PER_MINUTE_MIN = 10
export const REQUESTS_PER_MINUTE_MAX = 600
export const DEFAULT_AUTO_CREATE_MAX_AGE_HOURS = 24
export const AUTO_CREATE_MAX_AGE_HOURS_MAX = 720
/** The shipment pass: expire leases, look up unclear rows, auto create. Stage 5 adds statuses to the same job. */
export const SYNC_SCHEDULE = "*/5 * * * *"
export const LOOKUP_BATCH = 20
export const AUTO_BATCH = 10
/** The pass asks again for the label of a row claimed at most this many times (attempts counts the create claim too); past it a person asks. */
export const AUTO_LABEL_MAX_ATTEMPTS = 5
/** Parcels (boxes) in one package: DPDServices SinglePackage.parcels maxItems. */
export const MAX_BOXES = 100
/** package.reference and parcel.reference: at most 50 characters. */
export const REFERENCE_MAX = 50
/** Text limits of SenderOrReceiver in DPDServices. */
export const DPD_TEXT_LIMITS = { company: 100, name: 100, address: 100, city: 50, email: 100, ref: 100 } as const
/** The payer FID of the simulated requests of demo mode (never sent anywhere). */
export const DEMO_PAYER_FID = 1
/** The label every stage 2 call asks for. */
export const LABEL_OUTPUT = { outputDocFormat: "PDF", outputType: "BIC3", variant: "STANDARD" } as const
export const DPDSERVICES_PATHS = {
  numbers: "/public/shipment/v1/generatePackagesNumbers",
  labels: "/public/shipment/v1/generateSpedLabels",
} as const
