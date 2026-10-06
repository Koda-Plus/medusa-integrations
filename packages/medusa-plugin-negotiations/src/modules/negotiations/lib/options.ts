import {
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_MAX_ACTIVE_PER_CUSTOMER,
  DEFAULT_MAX_DRAFT_ORDERS_PER_RUN,
  DEFAULT_MAX_MESSAGE_LENGTH,
  DEFAULT_MAX_QUANTITY,
  DEFAULT_MESSAGES_PER_HOUR,
  DEFAULT_OPEN_PER_HOUR,
  MAX_EXPIRY_DAYS,
  MAX_MESSAGE_LENGTH_LIMIT,
  MAX_QUANTITY_LIMIT,
  MIN_MESSAGE_LENGTH_LIMIT,
} from "./constants"
import { normalizeCurrency } from "./money"
import { normalizeReferences, type NegotiationsReference, type NegotiationsReferenceOption } from "./references"
import { WRITERS, type WriterKey } from "./writers"

/**
 * Options of `@koda-plus/medusa-plugin-negotiations`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-negotiations", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting: a
 * value that does not make sense falls back to its default. Numbers may come
 * as strings (environment variables).
 */
export interface NegotiationsPluginOptions {
  /** Sample threads built from your catalog, for evaluation. Default false. */
  demo?: boolean | string
  /** Days without activity after which an open thread expires. 0 turns expiry off. Default 14. */
  expiryDays?: number | string
  /** Currency of threads that name none (a product thread without `currency_code`). Default: the store's default currency. */
  defaultCurrency?: string
  /** Negotiated prices include tax (gross). Default false: net prices, the B2B way. Used for draft order lines and shown in the admin. */
  taxInclusive?: boolean | string
  /** The Store API (`/store/negotiations`). Default true. */
  storeApi?: boolean | string
  /** Customers may accept a counter offer in the store. Default true. */
  customerAccept?: boolean | string
  /** Longest message, in characters. Default 2000. */
  maxMessageLength?: number | string
  /** Largest quantity of a thread. Default 100000. */
  maxQuantity?: number | string
  /** Open threads (open or counter offered) one customer may have at once. Default 20. */
  maxActivePerCustomer?: number | string
  /** New threads one customer may open per hour. Default 10. */
  openPerHour?: number | string
  /** Messages, accepts and declines one customer may send per hour. Default 60. */
  messagesPerHour?: number | string
  /**
   * WRITERS, hard switches. Default false in live mode (true in demo mode,
   * where they act on the simulation only). `false` wins: the admin cannot
   * arm a writer the options turn off.
   */
  writers?: { draftOrders?: boolean | string }
  /** The draft order writer: the region and sales channel of the drafts, and the cap of one run. */
  draftOrders?: { regionId?: string; salesChannelId?: string; maxPerRun?: number | string }
  /**
   * Stores running the plugin, shown on the admin page and in the setup
   * guide. Empty by default. `soon: true` lists a store that starts on Medusa
   * soon, with a "Soon" badge and no link (its `url` is optional).
   */
  references?: NegotiationsReferenceOption[]
}

export interface ResolvedNegotiationsOptions {
  demo: boolean
  expiryDays: number
  defaultCurrency: string | null
  taxInclusive: boolean
  storeApi: boolean
  customerAccept: boolean
  maxMessageLength: number
  maxQuantity: number
  maxActivePerCustomer: number
  openPerHour: number
  messagesPerHour: number
  /** Hard switches after the demo default. */
  writers: Record<WriterKey, boolean>
  draftOrders: { regionId: string | null; salesChannelId: string | null; maxPerRun: number }
  references: NegotiationsReference[]
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "")

/** true / false from booleans and the usual strings; null when the value says neither. */
export function boolOrNull(v: unknown): boolean | null {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^(1|true|yes|on)$/i.test(v.trim())) return true
    if (/^(0|false|no|off)$/i.test(v.trim())) return false
  }
  return null
}

function bool(v: unknown, fallback: boolean): boolean {
  return boolOrNull(v) ?? fallback
}

/** An integer within bounds; the fallback for anything that is not a number. */
export function bounded(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v)
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function id(v: unknown): string | null {
  const s = str(v)
  return /^[A-Za-z0-9_]{1,100}$/.test(s) ? s : null
}

/** A hard switch: explicit true allows, explicit false forbids; left out, it follows the mode. */
function writerSwitch(v: unknown, demo: boolean): boolean {
  return boolOrNull(v) ?? demo
}

export function resolveOptions(o: NegotiationsPluginOptions | undefined | null): ResolvedNegotiationsOptions {
  const opts = o ?? {}
  const demo = bool(opts.demo, false)
  const writers = opts.writers && typeof opts.writers === "object" && !Array.isArray(opts.writers) ? (opts.writers as Record<string, unknown>) : {}
  const draft = opts.draftOrders && typeof opts.draftOrders === "object" && !Array.isArray(opts.draftOrders) ? (opts.draftOrders as Record<string, unknown>) : {}
  const switches = {} as Record<WriterKey, boolean>
  for (const key of WRITERS) switches[key] = writerSwitch(writers[key], demo)
  return {
    demo,
    expiryDays: bounded(opts.expiryDays, DEFAULT_EXPIRY_DAYS, 0, MAX_EXPIRY_DAYS),
    defaultCurrency: normalizeCurrency(opts.defaultCurrency),
    taxInclusive: bool(opts.taxInclusive, false),
    storeApi: bool(opts.storeApi, true),
    customerAccept: bool(opts.customerAccept, true),
    maxMessageLength: bounded(opts.maxMessageLength, DEFAULT_MAX_MESSAGE_LENGTH, MIN_MESSAGE_LENGTH_LIMIT, MAX_MESSAGE_LENGTH_LIMIT),
    maxQuantity: bounded(opts.maxQuantity, DEFAULT_MAX_QUANTITY, 1, MAX_QUANTITY_LIMIT),
    maxActivePerCustomer: bounded(opts.maxActivePerCustomer, DEFAULT_MAX_ACTIVE_PER_CUSTOMER, 1, 1000),
    openPerHour: bounded(opts.openPerHour, DEFAULT_OPEN_PER_HOUR, 1, 1000),
    messagesPerHour: bounded(opts.messagesPerHour, DEFAULT_MESSAGES_PER_HOUR, 1, 10_000),
    writers: switches,
    draftOrders: {
      regionId: id(draft.regionId),
      salesChannelId: id(draft.salesChannelId),
      maxPerRun: bounded(draft.maxPerRun, DEFAULT_MAX_DRAFT_ORDERS_PER_RUN, 1, 100),
    },
    references: normalizeReferences(opts.references),
  }
}
