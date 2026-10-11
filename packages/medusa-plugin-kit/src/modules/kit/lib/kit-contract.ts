// GENERATED from kit/contract.ts (kit 1.0.1) by scripts/kit.mjs. Do not edit here: change the kit and run `npm run kit:sync`.
/**
 * koda.integration/1: what every Koda Plus plugin answers about itself and
 * about the records of a store, so that a host (an app that shows all
 * plugins in one place, like medusa.koda.plus) never needs to know the
 * inside of a plugin.
 *
 * Three read-only routes under /admin/<ns>/integration:
 *   GET /admin/<ns>/integration                         IntegrationManifest
 *   GET /admin/<ns>/integration/summary?entity=&id=     EntitySummary
 *   GET /admin/<ns>/integration/summary?entity=&ids=    EntitySummaryBatch (up to 50)
 *   GET /admin/<ns>/integration/attention?scope=        AttentionResponse
 * and one registry in the admin, where plugin cards announce themselves and
 * a host takes their zones over (see kit/admin/kit.tsx).
 *
 * Rules: reads only (no writes, no events, no outside calls other than a
 * cached GET); facts come from the plugin's own tables and from Medusa
 * records read by id, never from order or cart metadata, which a shopper sets
 * through the Store API; the same auth and data scope as the plugin's pages.
 *
 * Zero imports: the admin bundle and the server both use this file.
 */

export const KODA_CONTRACT = "koda.integration/1" as const
export const KODA_CONTRACT_HEADER = "x-koda-contract"

export type EntityKind = "order" | "product" | "variant" | "customer" | "inventory_item"
export type AttentionScope = "orders" | "products" | "customers" | "inventory" | "integration"
export type Tone = "green" | "blue" | "orange" | "red" | "grey"
export type SummaryState = "ok" | "active" | "attention" | "failed" | "none" | "off" | "unavailable"
export type FactSlot = "channel" | "payment" | "document" | "delivery" | "buyer" | "stock" | "listing"
export type HostZone =
  | "order.details"
  | "product.details"
  | "customer.details"
  | "inventory_item.details"
  | "order.list"
  | "product.list"
  | "customer.list"
  | "inventory_item.list"

export const ENTITY_KINDS: readonly EntityKind[] = ["order", "product", "variant", "customer", "inventory_item"]
export const ATTENTION_SCOPES: readonly AttentionScope[] = ["orders", "products", "customers", "inventory", "integration"]
export const SUMMARY_STATES: readonly SummaryState[] = ["ok", "active", "attention", "failed", "none", "off", "unavailable"]
export const FACT_SLOTS: readonly FactSlot[] = ["channel", "payment", "document", "delivery", "buyer", "stock", "listing"]
export const HOST_ZONES: readonly HostZone[] = [
  "order.details",
  "product.details",
  "customer.details",
  "inventory_item.details",
  "order.list",
  "product.list",
  "customer.list",
  "inventory_item.list",
]

/** The tone always follows the state: a host can sort and color without knowing the plugin. */
export const TONE_OF: Record<SummaryState, Tone> = {
  ok: "green",
  active: "blue",
  attention: "orange",
  failed: "red",
  none: "grey",
  off: "grey",
  unavailable: "grey",
}

/** Red first: what went wrong, then what waits for a person, then what is under way. */
export const TONE_RANK: Record<Tone, number> = { red: 0, orange: 1, blue: 2, green: 3, grey: 4 }

/** Text a host translates with the plugin dictionary, or shows as it is. */
export interface Message {
  /** Relative to the plugin namespace and always under "integration.", e.g. "integration.order.paidFee". */
  key: string
  /** Display-ready values: money and dates formatted on the server in `lang`. `count` only as a number, for plurals. */
  params?: Record<string, string | number>
  /** The sentence in `lang` (English when the plugin has no such text), for hosts without the dictionary. */
  fallback: string
}

export interface Link {
  kind: "admin" | "external"
  /** admin: a dashboard route without the /app base, one leading "/", never "//". external: https only, host on the plugin allowlist. */
  href: string
  label?: Message
}

/** One line of an overview card. A host shows, per slot, the fact with the highest priority. */
export interface Fact {
  slot: FactSlot
  /** 80: the system of record (Fakturownia for its invoice, InPost for its parcel); 50: a mirror (BaseLinker tracking); 20: a hint. */
  priority: number
  /**
   * A stable code for hosts that act on the fact, not only show it
   * (kit 1.0.1). Payment: "cod" (cash on delivery: the order may be fulfilled
   * unpaid), "paid", "pending", "refunded", "failed". Channel: the
   * marketplace, e.g. "allegro". Lowercase letters, digits and _.
   */
  code?: string
  value: Message
  sub?: Message
  tone?: Tone
  link?: Link
}

export interface IntegrationManifest {
  contract: typeof KODA_CONTRACT
  /** Every contract version this plugin answers, newest last. */
  contracts: string[]
  ns: string
  package: string
  version: string
  /** The kit version the generated contract code comes from. */
  kit: string
  /** The brand, never translated: "OLX", "Fakturownia". */
  name: string
  kind: "integration" | "module"
  mode: "live" | "sandbox" | "demo" | "off"
  configured: boolean
  /** Dashboard route of the plugin page, e.g. "/olx". */
  adminPath: string
  entities: EntityKind[]
  attention: AttentionScope[]
  widgets: Array<{ id: string; zone: HostZone }>
  writers?: { armed: number; total: number }
  lastSyncAt: string | null
  problems: Message[]
}

export interface EntitySummary {
  contract: typeof KODA_CONTRACT
  ns: string
  entity: EntityKind
  id: string
  state: SummaryState
  /** Always TONE_OF[state]; sent so a host can sort without the table. */
  tone: Tone
  title: Message
  detail?: Message
  facts: Fact[]
  counts: Record<string, number>
  /** links[0] opens the plugin page filtered to this record. */
  links: Link[]
  /** Registry id of the plugin card for this record, e.g. "stripe.order", or null. */
  widget: string | null
  /** When the plugin last heard from the outside system about this record. */
  updatedAt: string | null
  /** Served from the plugin cache after an outside read failed. */
  stale: boolean
}

export interface EntitySummaryBatch {
  contract: typeof KODA_CONTRACT
  ns: string
  entity: EntityKind
  /** One item per requested id, same order; nothing known means state "none". */
  items: EntitySummary[]
}

export interface AttentionCounter {
  /** Stable key, e.g. "parcels_to_create", "payments_failed". */
  key: string
  scope: AttentionScope
  count: number
  /** count is a lower bound: the plugin stopped counting at its cap. */
  capped: boolean
  tone: "red" | "orange" | "blue"
  /** params.count = count, for plurals. */
  label: Message
  /** The plugin list with this filter, e.g. "/inpost?view=panel&filter=to_create". */
  link: Link
  entity?: EntityKind
  /** Up to 20 record ids for the rows under a board tile, only when they come for free. */
  ids?: string[]
}

export interface AttentionResponse {
  contract: typeof KODA_CONTRACT
  ns: string
  generatedAt: string
  /** Every counter the plugin knows for the asked scopes, zeros included. */
  items: AttentionCounter[]
}

/* ------------------------------------------------------------------ */
/* Safety helpers, shared by the server (when it builds links) and by  */
/* hosts (before they render a link that came over the wire).          */
/* ------------------------------------------------------------------ */

/** A dashboard route: one leading "/", no scheme, no "//", no backslash, no control characters. */
export function safeAdminPath(href: unknown): string | null {
  if (typeof href !== "string") return null
  const s = href.trim()
  if (!s.startsWith("/") || s.startsWith("//") || s.length > 512) return null
  if (/[\\\u0000-\u001f\u007f]/.test(s)) return null
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(s)) return null
  return s
}

/** An https URL whose host is on the list (exact host or a subdomain of it). */
export function safeExternalUrl(href: unknown, allowlist: readonly string[]): string | null {
  if (typeof href !== "string" || href.length > 2048) return null
  let url: URL
  try {
    url = new URL(href.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  const ok = allowlist.some((allowed) => {
    const a = allowed.toLowerCase().replace(/^\.+/, "")
    return a.length > 0 && (host === a || host.endsWith(`.${a}`))
  })
  return ok ? url.toString() : null
}

/** A link that came over the wire, checked again before a host renders it. */
export function safeLink(link: Link | null | undefined, allowlist: readonly string[] = []): Link | null {
  if (!link || typeof link !== "object") return null
  if (link.kind === "admin") {
    const href = safeAdminPath(link.href)
    return href ? { ...link, href } : null
  }
  if (link.kind === "external") {
    const href = safeExternalUrl(link.href, allowlist)
    return href ? { ...link, href } : null
  }
  return null
}

/** Unknown states (a newer plugin) read as unavailable; unknown slots are skipped by the caller. */
export function stateOf(value: unknown): SummaryState {
  return typeof value === "string" && (SUMMARY_STATES as readonly string[]).includes(value) ? (value as SummaryState) : "unavailable"
}

/** Identifiers in the query: Medusa ids and plugin ids, nothing else. */
export const ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/
export const MAX_BATCH = 50

/* ------------------------------------------------------------------ */
/* Words every plugin carries in its `integration` texts                */
/* ------------------------------------------------------------------ */

/** The state names, spread by each plugin into its `integration` texts (`...STATE_TEXTS.en`). */
export const STATE_TEXTS = {
  en: {
    state: {
      ok: "Done",
      active: "Under way",
      attention: "Waits for a person",
      failed: "Went wrong",
      none: "Nothing here",
      off: "Not set up",
      unavailable: "Could not check",
    },
  },
  pl: {
    state: {
      ok: "Gotowe",
      active: "W toku",
      attention: "Czeka na człowieka",
      failed: "Nie wyszło",
      none: "Nic tu nie ma",
      off: "Nieskonfigurowane",
      unavailable: "Nie udało się sprawdzić",
    },
  },
}
