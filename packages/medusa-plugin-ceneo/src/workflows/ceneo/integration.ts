import { ADMIN_PATH, CENEO_EXTERNAL_HOSTS, ceneoCounters, kupTerazSummary, productSummary, writesNeedPerson, type KupTerazRowLite, type OfferRowLite } from "../../modules/ceneo/lib/integration"
import { integrationEn, integrationPl } from "../../modules/ceneo/lib/integration-texts"
import { KIT_META } from "../../modules/ceneo/lib/kit-meta"
import { integrationRoutes, type MessageDraft, type SummaryDraft } from "../../modules/ceneo/lib/kit-routes"
import { ORDER_TABLE } from "../../modules/ceneo/lib/constants"
import { feedGaps } from "../../modules/ceneo/lib/options"
import type { CeneoWrites } from "../../modules/ceneo/lib/order-input"
import { ceneoSvc, type CeneoServiceLike, type Row } from "../../modules/ceneo/lib/store"
import { rowsOf, type SqlRunner } from "../../modules/ceneo/lib/import-claim"
import { IMPORT_MAX_ATTEMPTS, WRITE_MAX_ATTEMPTS } from "../../modules/ceneo/lib/order-input"
import { WRITER_KEYS, writerState, type WriterKey, type WriterRow } from "../../modules/ceneo/lib/writers"

/**
 * koda.integration/1 for Ceneo: the manifest, one line per Medusa order
 * that came from Kup Teraz and per product in the feed, and the board
 * counters, read from the plugin's tables. Reads only: no Ceneo call, no
 * write.
 *
 *   GET /admin/ceneo/integration
 *   GET /admin/ceneo/integration/summary?entity=order&id=order_...
 *   GET /admin/ceneo/integration/attention?scope=orders
 */

const ORDER_LITE = ["id", "ceneo_order_id", "displayed_order_id", "import_status", "import_attempts", "medusa_order_id", "ceneo_writes", "synced_at"]
/** Without the database connection (tests): imported orders scanned for writes that need a person; a full scan reads as "capped". */
const WRITES_SCAN = 1000
/* ContainerRegistrationKeys.PG_CONNECTION, spelled out: this file stays free of runtime imports from Medusa. */
const PG_CONNECTION = "__pg_connection__"

function sqlOrNull(scope: { resolve: (key: string) => unknown }): SqlRunner | null {
  try {
    const sql = scope.resolve(PG_CONNECTION) as SqlRunner | undefined
    return sql && typeof sql.raw === "function" ? sql : null
  } catch {
    return null
  }
}

/** Imported orders whose writes wait for a person, counted in the database (every row, no cap). */
async function writesAttention(svc: CeneoServiceLike, sql: SqlRunner | null, demo: boolean): Promise<{ count: number; capped: boolean }> {
  if (sql) {
    const result = await sql.raw(
      `select count(*)::int as "n" from "${ORDER_TABLE}"
       where "demo" = ? and "import_status" = 'imported' and "deleted_at" is null
         and ("ceneo_writes"->>'attention' is not null or coalesce(("ceneo_writes"->>'attempts')::int, 0) >= ?)`,
      [demo, WRITE_MAX_ATTEMPTS],
    )
    return { count: Number(rowsOf<{ n: number }>(result)[0]?.n ?? 0), capped: false }
  }
  const rows = await svc.listCeneoOrders({ demo, import_status: "imported" }, { take: WRITES_SCAN, order: { updated_at: "DESC" }, select: ["id", "ceneo_writes"] })
  return { count: rows.filter((r) => writesNeedPerson(writesOf(r))).length, capped: rows.length >= WRITES_SCAN }
}

async function writerStates(svc: CeneoServiceLike) {
  const o = svc.getOptions()
  const rows = new Map(((await svc.listCeneoWriters({ id: [...WRITER_KEYS] }, { take: null })) as unknown as WriterRow[]).map((r) => [r.id as WriterKey, r]))
  return WRITER_KEYS.map((key) => {
    const row = rows.get(key) ?? null
    const s = writerState({ key, allowed: o.writes[key], row, mode: o.demo ? "demo" : "live", hasKey: Boolean(o.apiKey), importStates: o.orders.importStates, maxBid: o.cpc.maxBid })
    return { ...s, tripped: Boolean(row?.tripped_at) }
  })
}

const writesOf = (r: Row): CeneoWrites | null => (r.ceneo_writes && typeof r.ceneo_writes === "object" ? (r.ceneo_writes as CeneoWrites) : null)

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null)

export const ceneoIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: ADMIN_PATH,
  entities: ["order", "product"],
  attention: ["orders", "products", "integration"],
  widgets: [
    { id: "ceneo.order", zone: "order.details" },
    { id: "ceneo.product", zone: "product.details" },
  ],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [...CENEO_EXTERNAL_HOSTS],

  async status(ctx) {
    const svc = ceneoSvc(ctx.scope)
    const o = svc.getOptions()
    const writers = await writerStates(svc)
    const feedReady = !feedGaps(o).some((g) => g === "token" || g === "product_url")
    const problems: MessageDraft[] = []
    if (o.demo) problems.push({ key: "integration.problem.demo" })
    else {
      if (!feedReady) problems.push({ key: "integration.problem.not_configured" })
      if (!o.apiKey) problems.push({ key: "integration.problem.no_api_key" })
    }
    if (writers.some((w) => w.tripped)) problems.push({ key: "integration.problem.writer_tripped" })
    if (!o.demo && o.writes.status && !o.orders.carrierId) problems.push({ key: "integration.problem.no_carrier" })
    const [last] = await svc.listCeneoOrders({ demo: o.demo }, { take: 1, order: { synced_at: "DESC" }, select: ["id", "synced_at"] })
    return {
      mode: o.demo ? "demo" : feedReady || o.apiKey ? "live" : "off",
      configured: o.demo || feedReady,
      writers: { armed: writers.filter((w) => w.effective).length, total: writers.length },
      lastSyncAt: iso(last?.synced_at),
      problems,
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    const svc = ceneoSvc(ctx.scope)
    const o = svc.getOptions()
    if (entity === "order") {
      /* The order is Ceneo's when a row of the current mode names it: never order metadata. */
      const rows = await svc.listCeneoOrders({ demo: o.demo, medusa_order_id: ids }, { take: ids.length * 2, select: ORDER_LITE })
      const statusArmed = (await writerStates(svc)).find((w) => w.key === "status")?.effective ?? false
      for (const r of rows) {
        const id = String(r.medusa_order_id ?? "")
        if (!id || out.has(id)) continue
        const lite: KupTerazRowLite = {
          id: String(r.id),
          ceneo_order_id: String(r.ceneo_order_id ?? ""),
          displayed_order_id: typeof r.displayed_order_id === "string" ? r.displayed_order_id : null,
          import_status: typeof r.import_status === "string" ? r.import_status : null,
          import_attempts: typeof r.import_attempts === "number" ? r.import_attempts : null,
          ceneo_writes: writesOf(r),
          synced_at: iso(r.synced_at),
        }
        out.set(id, kupTerazSummary(lite, { statusArmed, demo: o.demo }))
      }
    } else if (entity === "product") {
      const offers = await svc.listCeneoOffers({ product_id: ids, retired_at: null }, { take: ids.length * 100, select: ["product_id", "state", "in_feed"] })
      for (const id of ids) {
        const own: OfferRowLite[] = offers.filter((r) => r.product_id === id).map((r) => ({ state: String(r.state ?? ""), in_feed: r.in_feed === true }))
        const draft = productSummary(own)
        if (draft) out.set(id, draft)
      }
    }
    return out
  },

  async count(ctx) {
    const svc = ceneoSvc(ctx.scope)
    const demo = svc.getOptions().demo
    const [[, held], [, exhausted], writes, [, offerErrors], writers] = await Promise.all([
      svc.listAndCountCeneoOrders({ demo, import_status: "held" }, { take: 1, select: ["id"] }),
      /* A failed import still retrying is not a person's job yet. */
      svc.listAndCountCeneoOrders({ demo, import_status: "failed", import_attempts: { $gte: IMPORT_MAX_ATTEMPTS } }, { take: 1, select: ["id"] }),
      writesAttention(svc, sqlOrNull(ctx.scope as unknown as { resolve: (key: string) => unknown }), demo),
      svc.listAndCountCeneoOffers({ state: "error", retired_at: null }, { take: 1, select: ["id"] }),
      writerStates(svc),
    ])
    return ceneoCounters({
      importsHeld: held + exhausted,
      writesAttention: writes.count,
      writesCapped: writes.capped,
      offerErrors,
      writersTripped: writers.filter((w) => w.tripped).length,
    })
  },
})
