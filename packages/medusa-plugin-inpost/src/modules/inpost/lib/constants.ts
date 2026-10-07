/**
 * Constants of InPost by Koda Plus. Zero imports, so the admin bundle and the
 * unit tests load this file as it is.
 *
 * What comes from InPost (verified in the ShipX documentation and the public
 * dictionaries, see docs/shipx-api-notes.md): the hosts, the two services, the
 * parcel templates, the sending methods and the tracking page.
 */

/** Container key of the data module (and the namespace of tables, routes and files). */
export const INPOST_MODULE = "inpost"

/** `identifier` of the fulfillment provider. Registered as `{ id: "inpost" }` it becomes `inpost_inpost`. */
export const PROVIDER_IDENTIFIER = "inpost"

/** ShipX hosts. NOT api.inpost.pl / sandbox-api.inpost.pl: that is another API, which answers 403 to a ShipX token. */
export const SHIPX_HOSTS = {
  production: "https://api-shipx-pl.easypack24.net",
  sandbox: "https://sandbox-api-shipx-pl.easypack24.net",
} as const

/** InPost Manager (Manager Paczek): tokens, the organization id, webhooks, locker shipments. */
export const MANAGER_URLS = {
  production: "https://manager.paczkomaty.pl",
  sandbox: "https://sandbox-manager.paczkomaty.pl",
} as const

/** WebTrucker: courier shipments after they are created, and their cancellation. */
export const WEBTRUCKER_URL = "https://kurier.inpost.pl"

/** Geowidget v5: the locker map for the storefront (a separate, public token). */
export const GEOWIDGET_URLS = {
  production: "https://geowidget.inpost.pl",
  sandbox: "https://sandbox-easy-geowidget-sdk.easypack24.net",
} as const

/** The public tracking page; the number is appended URI-encoded. */
export const TRACKING_URL = "https://inpost.pl/sledzenie-przesylek?number="

export const LOCKER_SERVICE = "inpost_locker_standard"
export const COURIER_SERVICE = "inpost_courier_standard"
export type InpostService = typeof LOCKER_SERVICE | typeof COURIER_SERVICE

export type ParcelKind = "locker" | "courier"

/**
 * The four fulfillment options. The ids are a contract with existing shipping
 * options (their `data.id`), so they never change: a store that registered an
 * earlier InPost provider as `{ id: "inpost" }` keeps its shipping options.
 */
export const OPTION_IDS = ["inpost-paczkomat", "inpost-paczkomat-cod", "inpost-kurier", "inpost-kurier-cod"] as const
export type InpostOptionId = (typeof OPTION_IDS)[number]

export interface OptionSpec {
  id: InpostOptionId
  kind: ParcelKind
  cod: boolean
  service: InpostService
  /** The `type` earlier storefronts read from the shipping option data. */
  legacyType: "paczkomat" | "kurier"
  name: string
  description: string
}

export const OPTION_SPECS: readonly OptionSpec[] = [
  {
    id: "inpost-paczkomat",
    kind: "locker",
    cod: false,
    service: LOCKER_SERVICE,
    legacyType: "paczkomat",
    name: "InPost Paczkomat",
    description: "Delivery to an InPost Paczkomat parcel locker, collected by the customer 24/7.",
  },
  {
    id: "inpost-paczkomat-cod",
    kind: "locker",
    cod: true,
    service: LOCKER_SERVICE,
    legacyType: "paczkomat",
    name: "InPost Paczkomat, cash on delivery",
    description: "Delivery to an InPost Paczkomat parcel locker, paid by the customer at collection.",
  },
  {
    id: "inpost-kurier",
    kind: "courier",
    cod: false,
    service: COURIER_SERVICE,
    legacyType: "kurier",
    name: "InPost courier",
    description: "Delivery by an InPost courier to the shipping address.",
  },
  {
    id: "inpost-kurier-cod",
    kind: "courier",
    cod: true,
    service: COURIER_SERVICE,
    legacyType: "kurier",
    name: "InPost courier, cash on delivery",
    description: "Delivery by an InPost courier, paid by the customer to the courier.",
  },
]

/** Parcel templates A, B and C (ShipX `template`), with the size InPost gives them, in millimetres. */
export const PARCEL_SIZES = ["small", "medium", "large"] as const
export type ParcelSize = (typeof PARCEL_SIZES)[number]

export const SIZE_LETTER: Record<ParcelSize, "A" | "B" | "C"> = { small: "A", medium: "B", large: "C" }

/** Height x width x length of the templates: A 8 x 38 x 64 cm, B 19 x 38 x 64 cm, C 41 x 38 x 64 cm. */
export const SIZE_DIMENSIONS_MM: Record<ParcelSize, { length: number; width: number; height: number }> = {
  small: { length: 640, width: 380, height: 80 },
  medium: { length: 640, width: 380, height: 190 },
  large: { length: 640, width: 380, height: 410 },
}

/** The heaviest parcel InPost takes: 25 kg in a locker template, 30 kg by courier. */
export const MAX_WEIGHT_KG: Record<ParcelKind, number> = { locker: 25, courier: 30 }

/** Label sizes the admin offers. A4 is ShipX `normal`; courier labels exist only as A6. */
export const LABEL_SIZES = ["A6", "A4"] as const
export type LabelSize = (typeof LABEL_SIZES)[number]

/** ShipX sending methods (public dictionary GET /v1/sending_methods). */
export const SENDING_METHODS = ["parcel_locker", "pok", "pop", "courier_pok", "branch", "dispatch_order", "any_point"] as const
export type SendingMethod = (typeof SENDING_METHODS)[number]

/** Defaults of the options. */
export const DEFAULT_PARCEL_SIZE: ParcelSize = "medium"
export const DEFAULT_LABEL_SIZE: LabelSize = "A6"
export const DEFAULT_REFERENCE_TEMPLATE = "Order {display_id}"
export const DEFAULT_WEIGHT_KG = 1
export const DEFAULT_REQUESTS_PER_MINUTE = 60
export const MAX_REQUESTS_PER_MINUTE = 600
export const DEFAULT_TIMEOUT_MS = 20_000
export const DEFAULT_POLL_MAX_AGE_DAYS = 30
export const DEFAULT_POINTS_PER_MINUTE = 60

/** The status pass: webhooks first, this as the fallback. Minutes 7, 22, 37 and 52. */
export const SYNC_SCHEDULE = "7,22,37,52 * * * *"

/** How long a claim on a row may last before the row is treated as unknown (the process died mid-request). */
export const CREATE_LEASE_MS = 2 * 60 * 1000

/** A row in `unknown` is looked up in ShipX; with nothing found after this long, a person may try again. */
export const UNKNOWN_SETTLE_MS = 15 * 60 * 1000

/** Rows a status pass reads at most, and how often one row is read again. */
export const SYNC_BATCH = 100
export const SYNC_EVERY_MS = 25 * 60 * 1000

/** Events kept per mode (status history, webhooks, actions, runs). */
export const EVENTS_RETENTION_DAYS = 120

/** ShipX limits of free text fields. */
export const REFERENCE_MIN = 3
export const REFERENCE_MAX = 100

/** The rows the demo builds from the store's newest orders. */
export const DEMO_ROWS = 16
