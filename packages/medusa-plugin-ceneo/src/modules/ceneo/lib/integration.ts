import type { OfferState } from "./constants"
import type { CounterDraft, FactDraft, SummaryDraft } from "./kit-routes"
import { IMPORT_MAX_ATTEMPTS, WRITE_MAX_ATTEMPTS, type CeneoWrites } from "./order-input"

/**
 * Ceneo in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows (testable without a database): one line per Medusa
 * order that came from Kup Teraz, one line per product as the feed sees
 * it, and the board counters.
 *
 * Nothing comes from order metadata. An order is Ceneo's when a
 * `ceneo_order` row names it (`medusa_order_id`). Links stay inside the
 * admin, on the Ceneo page.
 */

export const CENEO_EXTERNAL_HOSTS: readonly string[] = []

export const ADMIN_PATH = "/ceneo"

export type KupTerazRowLite = {
  id: string
  ceneo_order_id: string
  displayed_order_id?: string | null
  state_id?: number | null
  import_status?: string | null
  import_attempts?: number | null
  ceneo_writes?: CeneoWrites | null
  synced_at?: string | Date | null
}

export type KupTerazContext = {
  /** The status writer is allowed and armed: Ceneo hears about shipments. */
  statusArmed: boolean
  demo: boolean
}

const t = (key: string, params?: Record<string, string | number>) => ({ key: `integration.order.${key}`, ...(params ? { params } : {}) })
const p = (key: string, params?: Record<string, string | number>) => ({ key: `integration.product.${key}`, ...(params ? { params } : {}) })

type Line = Pick<SummaryDraft, "state" | "title">

/** Where the order stands between Medusa and Ceneo, the most urgent first. */
export function kupTerazLine(row: KupTerazRowLite): Line {
  const w = row.ceneo_writes ?? {}
  if (row.import_status === "held" || importExhausted(row)) return { state: "attention", title: t("importHeld") }
  if (row.import_status === "failed") return { state: "active", title: t("importRetrying") }
  if (row.import_status === "importing") return { state: "active", title: t("importing") }
  /* Out of attempts before the note: afterWriteFailure writes both. */
  if ((w.attempts ?? 0) >= WRITE_MAX_ATTEMPTS) return { state: "failed", title: t("writeFailed") }
  if (w.attention) return { state: "attention", title: t("writeAttention") }
  if (w.canceled_by_ceneo_at) return { state: "none", title: t("canceledAtCeneo") }
  if (w.cancel?.sent_at) return { state: "none", title: t("cancelSent") }
  if (w.cancel) return { state: "active", title: t("cancelQueued") }
  if (w.sent_at) return { state: "ok", title: t("sent") }
  if (w.shipment || w.send_requested_at) return { state: "active", title: t("shipmentQueued") }
  if (w.confirmed_at) return { state: "active", title: t("confirmed") }
  return { state: "active", title: t("imported") }
}

/** A failed import with no attempt left: it waits for a person like a held one. */
export function importExhausted(row: Pick<KupTerazRowLite, "import_status" | "import_attempts">): boolean {
  return row.import_status === "failed" && (row.import_attempts ?? 0) >= IMPORT_MAX_ATTEMPTS
}

/** The line of one Medusa order from its Ceneo row. */
export function kupTerazSummary(row: KupTerazRowLite, ctx: KupTerazContext): SummaryDraft {
  const line = kupTerazLine(row)
  const w = row.ceneo_writes ?? {}
  let detail: SummaryDraft["detail"]
  if (line.state === "active" && !ctx.statusArmed && row.import_status === "imported") detail = t("notArmed")
  else if (w.error && line.state === "active") detail = t("lastError")
  if (ctx.demo) detail = detail ?? t("demo")
  const fact: FactDraft = {
    slot: "channel",
    priority: 80,
    code: "ceneo",
    value: { key: "integration.fact.channel", params: { number: row.displayed_order_id || row.ceneo_order_id } },
    link: { kind: "admin", href: ADMIN_PATH },
  }
  return {
    ...line,
    ...(detail ? { detail } : {}),
    facts: [fact],
    links: [{ kind: "admin", href: ADMIN_PATH }],
    widget: "ceneo.order",
    updatedAt: row.synced_at ?? null,
  }
}

export type OfferRowLite = { state: OfferState | string; in_feed?: boolean | null }

/** The line of one product: its variants as the last build of the feed saw them; undefined when the feed never saw it. */
export function productSummary(offers: readonly OfferRowLite[]): SummaryDraft | undefined {
  if (offers.length === 0) return undefined
  const count = (s: string) => offers.filter((o) => o.state === s).length
  const errors = count("error")
  const warnings = count("warning")
  const excluded = count("excluded")
  const inFeed = offers.filter((o) => o.in_feed).length
  const total = offers.length
  let line: Line
  if (errors > 0) line = { state: "failed", title: p("errors", { count: errors }) }
  else if (warnings > 0) line = { state: "attention", title: p("warnings", { count: warnings }) }
  else if (excluded === total) line = { state: "none", title: p("excluded") }
  else if (inFeed < total) line = { state: "ok", title: p("inFeedSome", { done: inFeed, total }) }
  else line = { state: "ok", title: p("inFeed") }
  return {
    ...line,
    facts: [{ slot: "listing", priority: 50, code: "ceneo", value: { key: "integration.fact.listing", params: { done: inFeed, total } }, link: { kind: "admin", href: ADMIN_PATH } }],
    links: [{ kind: "admin", href: ADMIN_PATH }],
    widget: "ceneo.product",
  }
}

export type CeneoCounts = {
  /** Kup Teraz imports that wait for a person: held, or failed with no attempt left. */
  importsHeld: number
  /** Imported orders whose writes to Ceneo need a person. */
  writesAttention: number
  /** Whether `writesAttention` stopped at the scan limit. */
  writesCapped: boolean
  /** Offers with an error: they never reach the feed. */
  offerErrors: number
  /** Writers stopped by their breaker. */
  writersTripped: number
}

/** Board counters of the current mode. */
export function ceneoCounters(c: CeneoCounts): CounterDraft[] {
  const link = { kind: "admin" as const, href: ADMIN_PATH }
  return [
    { key: "imports_held", scope: "orders", count: c.importsHeld, tone: "red", link, entity: "order" },
    { key: "writes_attention", scope: "orders", count: c.writesAttention, ...(c.writesCapped ? { capped: true } : {}), tone: "orange", link, entity: "order" },
    { key: "offer_errors", scope: "products", count: c.offerErrors, tone: "red", link, entity: "product" },
    { key: "writers_tripped", scope: "integration", count: c.writersTripped, tone: "red", link },
  ]
}

/** An imported order whose writes need a person (the same rule as the line's "attention" and "failed"). */
export function writesNeedPerson(w: CeneoWrites | null | undefined): boolean {
  return Boolean(w?.attention) || (w?.attempts ?? 0) >= WRITE_MAX_ATTEMPTS
}
