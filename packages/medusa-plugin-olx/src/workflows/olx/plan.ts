/**
 * THE PLAN: ALERTS, AND WHAT EACH WRITER WOULD DO. Reads our advert snapshot
 * and the Medusa catalog, never the OLX advert list (that is the sync's job).
 * Publishing reads the category definitions of OLX (cached for a day).
 *
 * Runs after every sync and every 15 minutes. Writes:
 *
 *   olx_alert         the four kinds of disagreement (lib/alerts.ts)
 *   olx_plan_item     one row per advert for the lifecycle and price writers,
 *                     merged with what is already there (lib/writers.ts)
 *   olx_publication   one row per variant for publishing, inserted exactly once
 *   olx_state         plan:<mode>, the summary the admin shows
 *
 * Every change to a row the writers may hold goes through a conditional
 * statement (`from` the state that was read), so a plan never overwrites a
 * row a writer claimed in between.
 *
 * DEMO MODE: the same steps on the simulated account, plus a simulated stock
 * overlay (two variants sold out, one product unpublished), the simulated
 * history of one advert the plugin paused, simulated publish settings, and a
 * reset of demo writes older than a day so the public demo keeps its story.
 */

import { generateEntityId } from "@medusajs/framework/utils"
import type OlxModuleService from "../../modules/olx/service"
import { computeAlerts, emptyAlertCounts, type Alert, type AlertCounts } from "../../modules/olx/lib/alerts"
import { isConnected } from "../../modules/olx/lib/connection"
import { CATEGORY_CACHE_MS, DEMO_RESET_MS, WRITERS } from "../../modules/olx/lib/constants"
import type { OlxPlanSummaryDto } from "../../modules/olx/lib/contract"
import {
  demoCandidateMetadata,
  demoCategoryRaw,
  demoPublishDefaults,
  demoScenario,
  type DemoScenario,
} from "../../modules/olx/lib/demo"
import type { AdvertRow, AlertRow, PlanItemRow, PublicationRow } from "../../modules/olx/lib/dto"
import { planLifecycle } from "../../modules/olx/lib/lifecycle"
import type { ResolvedPublishOptions } from "../../modules/olx/lib/options"
import { readCategory, readCategoryAttributes } from "../../modules/olx/lib/partner-api"
import { planPrices } from "../../modules/olx/lib/pricing"
import {
  parseAttributeDefs,
  parseCategory,
  planPublication,
  resolveCategory,
  type CategoryDefinition,
  type PublishCandidate,
} from "../../modules/olx/lib/publish"
import { hasStock, isPublished } from "../../modules/olx/lib/stock"
import {
  createPlanItemStore,
  createPublicationStore,
  PUBLICATION_UNSENT,
  type PlanItemStore,
  type PublicationStore,
} from "../../modules/olx/lib/store"
import { reconcilePlan, stableJson, toggleKey, type DesiredItem, type PlanRowLike, type WriterToggle } from "../../modules/olx/lib/writers"
import { loadCandidateDetails, loadPlanCatalog, marketCurrency, type PlanCatalog, type PlanVariant } from "./catalog"
import { chunks, errorText, getState, modeKey, olxServiceOf, queryOf, setState, sqlOf, withLock, type QueryLike, type Scope } from "./runtime"

export interface StoredPlanSummary extends OlxPlanSummaryDto {
  alerts: AlertCounts
  simulation: { soldOut: string[]; unpublished: string[]; paused: string[]; missingAttribute: string | null } | null
}

export interface PlanResult {
  summary: StoredPlanSummary | null
  skipped: null | "running" | "not_configured"
}

/** At most this many publish candidates are planned per run (the first by SKU). */
const MAX_PUBLISH_CANDIDATES = 500

export function planStateKey(demo: boolean): string {
  return `plan:${modeKey(demo)}`
}

/* ------------------------------------------------------------------ */
/* Category definitions, cached per process                            */
/* ------------------------------------------------------------------ */

const CACHE_KEY = Symbol.for("koda.olx.categoryCache")
type CacheHolder = typeof globalThis & { [CACHE_KEY]?: Map<string, { at: number; def: CategoryDefinition }> }

function categoryCache(): Map<string, { at: number; def: CategoryDefinition }> {
  const holder = globalThis as CacheHolder
  if (!holder[CACHE_KEY]) holder[CACHE_KEY] = new Map()
  return holder[CACHE_KEY] as Map<string, { at: number; def: CategoryDefinition }>
}

async function categoryDefinition(svc: OlxModuleService, categoryId: number, demo: boolean, now: number): Promise<CategoryDefinition> {
  if (demo) {
    const raw = demoCategoryRaw(svc.getOptions().market)
    return { category: parseCategory(raw.category), attributes: parseAttributeDefs(raw.attributes), error: null }
  }
  const key = `${svc.getOptions().market}:${categoryId}`
  const cached = categoryCache().get(key)
  if (cached && now - cached.at < CATEGORY_CACHE_MS && !cached.def.error) return cached.def
  let def: CategoryDefinition
  try {
    const category = parseCategory(await readCategory(svc, categoryId))
    const attributes = parseAttributeDefs(await readCategoryAttributes(svc, categoryId))
    def = { category, attributes, error: null }
  } catch (err) {
    def = { category: null, attributes: null, error: errorText(svc, err) }
  }
  categoryCache().set(key, { at: now, def })
  return def
}

/* ------------------------------------------------------------------ */
/* Demo upkeep                                                         */
/* ------------------------------------------------------------------ */

async function demoMaintenance(svc: OlxModuleService, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DEMO_RESET_MS)
  const oldItems = (await svc.listOlxPlanItems({ demo: true, updated_at: { $lt: cutoff } } as never, {
    take: null,
    select: ["id", "state"],
  })) as unknown as Array<{ id: string; state: string }>
  const removable = oldItems.filter((r) => r.state !== "applying").map((r) => r.id)
  for (const part of chunks(removable, 200)) await svc.deleteOlxPlanItems(part)
  const oldPublications = (await svc.listOlxPublications({ demo: true, updated_at: { $lt: cutoff } } as never, {
    take: null,
    select: ["id", "state"],
  })) as unknown as Array<{ id: string; state: string }>
  const removablePub = oldPublications.filter((r) => r.state !== "publishing").map((r) => r.id)
  for (const part of chunks(removablePub, 200)) await svc.deleteOlxPublications(part)
  for (const writer of WRITERS) {
    const key = toggleKey(writer, true)
    const toggle = await getState<WriterToggle>(svc, key)
    const changed = toggle?.changedAt ? new Date(toggle.changedAt).getTime() : 0
    if (toggle?.armed && changed < cutoff.getTime()) {
      await setState(svc, key, { armed: false, changedBy: "demo reset", changedAt: now.toISOString() } satisfies WriterToggle)
    }
  }
}

/** The simulated history: one advert the plugin paused three days ago, now back in stock. */
async function seedDemoHistory(svc: OlxModuleService, adverts: AdvertRow[], rows: PlanItemRow[], scenario: DemoScenario, now: Date): Promise<PlanItemRow[]> {
  const created: PlanItemRow[] = []
  const known = new Set(rows.map((r) => r.olx_id))
  for (const sku of scenario.paused) {
    const advert = adverts.find((a) => a.sku === sku && a.status === "removed_by_user")
    if (!advert || known.has(advert.olx_id)) continue
    const at = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    try {
      const row = (await svc.createOlxPlanItems({
        writer: "lifecycle",
        olx_id: advert.olx_id,
        action: "deactivate",
        reason: "sold_out",
        from_value: "active",
        to_value: "removed_by_user",
        state: "done",
        attempts: 0,
        note: "simulated_history",
        planned_at: at,
        done_at: at,
        paused_at: at,
        title: advert.title,
        variant_id: advert.variant_id,
        product_id: advert.product_id,
        sku: advert.sku,
        demo: true,
      } as never)) as unknown as PlanItemRow
      created.push(row)
    } catch {
      /* A parallel plan seeded it first. */
    }
  }
  return created
}

function applyDemoStock(catalog: PlanCatalog, scenario: DemoScenario): void {
  for (const v of catalog.variants.values()) {
    if (!v.sku) continue
    if (scenario.soldOut.includes(v.sku)) v.stock = { kind: "tracked", available: 0 }
    if (scenario.unpublished.includes(v.sku)) v.productStatus = "draft"
  }
}

/* ------------------------------------------------------------------ */
/* Writing the pieces                                                  */
/* ------------------------------------------------------------------ */

async function storeAlerts(svc: OlxModuleService, alerts: Alert[], demo: boolean, now: Date): Promise<void> {
  const existing = (await svc.listOlxAlerts({ demo } as never, { take: null })) as unknown as AlertRow[]
  const byKey = new Map(existing.map((r) => [r.key, r]))
  const wanted = new Set(alerts.map((a) => a.key))
  const creates: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  for (const a of alerts) {
    const data = {
      key: a.key,
      kind: a.kind,
      variant_id: a.variantId,
      product_id: a.productId,
      sku: a.sku,
      product_title: a.productTitle,
      olx_id: a.olxId,
      advert_title: a.advertTitle,
      advert_url: a.advertUrl,
      advert_status: a.advertStatus,
      stock: a.stock,
      product_status: a.productStatus,
      demo,
    }
    const row = byKey.get(a.key)
    if (!row) {
      creates.push({ ...data, first_seen_at: now })
      continue
    }
    const differs = (Object.keys(data) as Array<keyof typeof data>).some((k) => ((row as unknown as Record<string, unknown>)[k] ?? null) !== (data[k] ?? null))
    if (differs) updates.push({ id: row.id, ...data })
  }
  const removeIds = existing.filter((r) => !wanted.has(r.key)).map((r) => r.id)
  for (const part of chunks(removeIds, 500)) await svc.deleteOlxAlerts(part)
  for (const part of chunks(creates, 200)) await svc.createOlxAlerts(part as never)
  for (const part of chunks(updates, 200)) await svc.updateOlxAlerts(part as never)
}

async function writePlan(
  svc: OlxModuleService,
  store: PlanItemStore,
  writer: "lifecycle" | "price",
  demo: boolean,
  rows: PlanItemRow[],
  desired: DesiredItem[],
  now: Date,
  resumed?: Set<string>,
): Promise<void> {
  const { creates, updates } = reconcilePlan(rows as unknown as PlanRowLike[], desired, { now, resumed })
  const stateById = new Map(rows.map((r) => [r.id, r.state]))
  for (const c of creates) {
    try {
      await svc.createOlxPlanItems({ ...c, writer, demo } as never)
    } catch (err) {
      svc.getLogger().warn(`[olx] plan ${writer}: could not add the row of advert ${c.olx_id}: ${errorText(svc, err)}`)
    }
  }
  for (const u of updates) {
    const from = stateById.get(u.id)
    if (!from) continue
    await store.transition(u.id, [from], u.patch as Record<string, unknown>)
  }
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

function publishOptionsFor(o: ResolvedPublishOptions, demo: boolean, market: string): ResolvedPublishOptions {
  if (!demo) return o
  const d = demoPublishDefaults(market)
  return {
    ...o,
    location: o.location ?? d.location,
    contact: o.contact ?? d.contact,
    attributes: { ...d.attributes, ...o.attributes },
  }
}

/** Label of the SKU line in published descriptions; it matches the default `skuPatterns`. */
const SKU_LABEL: Record<string, string> = { pl: "Kod produktu" }

async function planPublishing(args: {
  svc: OlxModuleService
  query: QueryLike
  store: PublicationStore
  demo: boolean
  now: Date
  catalog: PlanCatalog
  adverts: AdvertRow[]
  scenario: DemoScenario | null
}): Promise<OlxPlanSummaryDto["publish"]> {
  const { svc, demo, now, catalog, scenario } = args
  const o = svc.getOptions()
  const options = publishOptionsFor(o.publish, demo, o.market)
  const mapped = demo || options.categories.length > 0
  if (!demo && !(await isConnected(svc))) return { mapped, candidates: 0, ready: 0, blocked: 0, reason: "not_connected" }
  if (!catalog.complete || !catalog.stockComplete || !catalog.pricesComplete) {
    return { mapped, candidates: 0, ready: 0, blocked: 0, reason: "catalog_incomplete" }
  }

  const linked = new Set(args.adverts.map((a) => a.variant_id).filter((v): v is string => Boolean(v)))
  const rows = (await svc.listOlxPublications({ demo } as never, { take: null })) as unknown as PublicationRow[]
  const byVariant = new Map(rows.map((r) => [r.variant_id, r]))
  const settled = new Set(rows.filter((r) => !PUBLICATION_UNSENT.includes(r.state)).map((r) => r.variant_id))

  const toCandidate = (v: PlanVariant): PublishCandidate => ({
    variantId: v.id,
    productId: v.productId,
    sku: v.sku as string,
    productTitle: v.productTitle ?? (v.sku as string),
    variantTitle: v.title,
    multiVariant: catalog.multiVariant.has(v.productId),
    description: null,
    images: [],
    price: v.price,
    categoryIds: v.categoryIds,
    categoryHandles: v.categoryHandles,
    productMetadata: demo && scenario ? { ...(v.productMetadata ?? {}), ...demoCandidateMetadata(v.sku as string, scenario) } : v.productMetadata,
    variantMetadata: v.metadata,
  })

  const candidates: PublishCandidate[] = []
  const sorted = [...catalog.variants.values()].sort((a, b) => String(a.sku ?? "").localeCompare(String(b.sku ?? "")))
  for (const v of sorted) {
    if (!v.sku || !isPublished(v.productStatus) || !hasStock(v.stock)) continue
    if (linked.has(v.id) || settled.has(v.id)) continue
    if (demo && scenario && !scenario.candidates.includes(v.sku)) continue
    const c = toCandidate(v)
    if (!resolveCategory(c, options)) continue
    candidates.push(c)
    if (candidates.length >= MAX_PUBLISH_CANDIDATES) break
  }

  const details = await loadCandidateDetails(args.query, candidates.map((c) => c.productId))
  for (const c of candidates) {
    const d = details.get(c.productId)
    c.description = d?.description ?? null
    c.images = d?.images ?? []
  }

  const definitions = new Map<number, CategoryDefinition>()
  for (const c of candidates) {
    const cat = resolveCategory(c, options)
    if (cat && !definitions.has(cat.olxCategoryId)) {
      definitions.set(cat.olxCategoryId, await categoryDefinition(svc, cat.olxCategoryId, demo, now.getTime()))
    }
  }

  const ctx = {
    options,
    currency: marketCurrencyUpper(o.market),
    skuLabel: SKU_LABEL[o.market] ?? "SKU",
    definitions,
  }
  let ready = 0
  let blocked = 0
  const wanted = new Set<string>()
  for (const c of candidates) {
    const item = planPublication(c, ctx)
    wanted.add(c.variantId)
    if (item.ready) ready += 1
    else blocked += 1
    const state = item.ready ? "planned" : "blocked"
    const row = byVariant.get(c.variantId)
    if (!row) {
      await args.store.insertIgnore({
        variant_id: c.variantId,
        product_id: c.productId,
        sku: c.sku,
        title: item.title,
        olx_category_id: item.olxCategoryId,
        state,
        payload: item.payload,
        missing: item.missing,
        warnings: item.warnings,
        demo,
        planned_at: now,
      })
      continue
    }
    const preview = { title: item.title, olx_category_id: item.olxCategoryId, payload: item.payload, missing: item.missing, warnings: item.warnings }
    const samePreview =
      row.title === preview.title &&
      (row.olx_category_id ?? null) === (preview.olx_category_id ?? null) &&
      stableJson(row.payload ?? null) === stableJson(preview.payload ?? null) &&
      stableJson(row.missing ?? []) === stableJson(preview.missing) &&
      stableJson(row.warnings ?? []) === stableJson(preview.warnings)
    if (row.state === "planned" || row.state === "blocked") {
      if (!samePreview || row.state !== state) {
        await args.store.transition(row.id, [row.state], { ...preview, state, ...(row.state !== state && state === "planned" ? { planned_at: now } : {}) })
      }
    } else if (row.state === "failed") {
      const next = item.ready ? "failed" : "blocked"
      if (!samePreview || next !== row.state) await args.store.transition(row.id, ["failed"], { ...preview, state: next })
    } else if (row.state === "quarantined") {
      if (!samePreview) await args.store.transition(row.id, ["quarantined"], preview)
    }
  }
  const stale = rows.filter((r) => PUBLICATION_UNSENT.includes(r.state) && !wanted.has(r.variant_id)).map((r) => r.id)
  await args.store.deleteUnsent(stale)
  return {
    mapped,
    candidates: candidates.length,
    ready,
    blocked,
    reason: !mapped && candidates.length === 0 ? "no_mapping" : null,
  }
}

function marketCurrencyUpper(market: Parameters<typeof marketCurrency>[0]): string {
  return marketCurrency(market).toUpperCase()
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function runOlxPlan(scope: Scope, input: { trigger?: string } = {}): Promise<PlanResult> {
  const svc = olxServiceOf(scope)
  const o = svc.getOptions()
  const demo = o.demo
  if (!demo && !svc.isConfigured()) return { summary: null, skipped: "not_configured" }
  const result = await withLock("plan", async (): Promise<PlanResult> => {
    const now = new Date()
    const query = queryOf(scope)
    const sql = sqlOf(scope)
    const planStore = createPlanItemStore(sql)
    const publicationStore = createPublicationStore(sql, () => generateEntityId(undefined, "olxpub"))
    const messages: string[] = []

    if (demo) await demoMaintenance(svc, now)

    const adverts = (await svc.listOlxAdverts({ demo } as never, { take: null })) as unknown as AdvertRow[]
    const lastRuns = (await svc.listOlxSyncRuns({ source: demo ? "demo" : "api" } as never, {
      take: 1,
      order: { started_at: "DESC" },
    })) as unknown as Array<{ complete: boolean }>
    /* No read yet: every variant would look "never on OLX". The latest read
     * incomplete: the snapshot may miss adverts. Either way nothing new is
     * concluded from the snapshot; the previous alerts and rows stay. */
    const noRead = lastRuns.length === 0
    const readComplete = Boolean(lastRuns[0]?.complete)

    if (noRead) {
      /* Not connected yet, or never synced: there is nothing to compare, so
       * the catalog is not even loaded. */
      const kept = (await getState<StoredPlanSummary>(svc, planStateKey(demo))) ?? null
      const summary: StoredPlanSummary = {
        plannedAt: now.toISOString(),
        readComplete: false,
        stockComplete: false,
        lifecycleSkipped: "no_read",
        guard: { held: false, endings: 0, liveLinked: 0, limit: 0 },
        price: { noPrice: 0, otherCurrency: 0, skipped: "incomplete_read" },
        publish: { mapped: demo || o.publish.categories.length > 0, candidates: 0, ready: 0, blocked: 0, reason: "no_read" },
        message: null,
        alerts: kept?.alerts ?? emptyAlertCounts(),
        simulation: null,
      }
      await setState(svc, planStateKey(demo), summary)
      return { summary, skipped: null }
    }

    const catalog = await loadPlanCatalog(query, o)
    if (catalog.message) messages.push(catalog.message)
    const skus = [...catalog.variants.values()].map((v) => v.sku).filter((s): s is string => Boolean(s))
    const scenario = demo ? demoScenario(skus) : null
    if (scenario) applyDemoStock(catalog, scenario)
    const stockComplete = catalog.complete && catalog.stockComplete

    /* Alerts */
    let alertCounts = emptyAlertCounts()
    if (stockComplete && readComplete) {
      const { alerts, counts } = computeAlerts(
        adverts.map((a) => ({ olxId: a.olx_id, title: a.title, url: a.url, status: a.status, variantId: a.variant_id })),
        catalog.variants,
      )
      await storeAlerts(svc, alerts, demo, now)
      alertCounts = counts
    } else {
      const kept = (await svc.listOlxAlerts({ demo } as never, { take: null, select: ["kind"] })) as unknown as Array<{ kind: keyof AlertCounts }>
      for (const k of kept) if (k.kind in alertCounts) alertCounts[k.kind] += 1
    }

    /* Lifecycle */
    let lifecycleRows = (await svc.listOlxPlanItems({ writer: "lifecycle", demo } as never, { take: null })) as unknown as PlanItemRow[]
    if (scenario) lifecycleRows = [...lifecycleRows, ...(await seedDemoHistory(svc, adverts, lifecycleRows, scenario, now))]
    const paused = new Set(lifecycleRows.filter((r) => r.paused_at).map((r) => r.olx_id))
    const lifecycle = planLifecycle({
      adverts: adverts.map((a) => ({ olxId: a.olx_id, status: a.status, variantId: a.variant_id, title: a.title, url: a.url })),
      variants: catalog.variants,
      pausedByPlugin: paused,
      readComplete,
      stockComplete,
    })
    if (!lifecycle.skipped) {
      await writePlan(
        svc,
        planStore,
        "lifecycle",
        demo,
        lifecycleRows,
        lifecycle.actions.map((a) => ({
          olxId: a.olxId,
          action: a.command,
          reason: a.reason,
          from: a.fromStatus,
          to: a.toStatus,
          held: false,
          variantId: a.variantId,
          productId: a.productId,
          sku: a.sku,
          title: a.title,
        })),
        now,
        new Set(lifecycle.resumed),
      )
    }

    /* Prices */
    const priceRows = (await svc.listOlxPlanItems({ writer: "price", demo } as never, { take: null })) as unknown as PlanItemRow[]
    const prices = planPrices({
      adverts: adverts.map((a) => ({ olxId: a.olx_id, status: a.status, variantId: a.variant_id, title: a.title, price: a.price })),
      variants: catalog.variants,
      currency: marketCurrencyUpper(o.market),
      maxChangePercent: o.maxPriceChangePercent,
      readComplete,
      catalogComplete: stockComplete && catalog.pricesComplete,
    })
    if (!prices.skipped) {
      await writePlan(
        svc,
        planStore,
        "price",
        demo,
        priceRows,
        prices.actions.map((a) => ({
          olxId: a.olxId,
          action: "price",
          reason: "price_changed",
          from: a.from,
          to: a.to,
          held: a.held,
          variantId: a.variantId,
          productId: a.productId,
          sku: a.sku,
          title: a.title,
        })),
        now,
      )
    }

    /* Publishing */
    let publish: OlxPlanSummaryDto["publish"]
    try {
      publish = readComplete
        ? await planPublishing({ svc, query, store: publicationStore, demo, now, catalog, adverts, scenario })
        : { mapped: demo || o.publish.categories.length > 0, candidates: 0, ready: 0, blocked: 0, reason: "incomplete_read" }
    } catch (err) {
      messages.push(`Publish plan: ${errorText(svc, err)}`)
      publish = { mapped: demo || o.publish.categories.length > 0, candidates: 0, ready: 0, blocked: 0, reason: "error" }
    }

    const summary: StoredPlanSummary = {
      plannedAt: now.toISOString(),
      readComplete,
      stockComplete,
      lifecycleSkipped: lifecycle.skipped,
      guard: lifecycle.guard,
      price: { noPrice: prices.noPrice, otherCurrency: prices.otherCurrency, skipped: prices.skipped },
      publish,
      message: messages.length > 0 ? messages.join(" ") : null,
      alerts: alertCounts,
      simulation: scenario
        ? { soldOut: scenario.soldOut, unpublished: scenario.unpublished, paused: scenario.paused, missingAttribute: scenario.missingAttribute }
        : null,
    }
    await setState(svc, planStateKey(demo), summary)
    if (input.trigger === "manual") svc.getLogger().info(`[olx] plan ${modeKey(demo)}: ${JSON.stringify(alertCounts)}`)
    return { summary, skipped: null }
  })
  return result ?? { summary: null, skipped: "running" }
}
