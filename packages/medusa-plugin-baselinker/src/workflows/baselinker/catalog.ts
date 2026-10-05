/**
 * ONE CATALOG RUN: read the BaseLinker cards (the API, or the simulated
 * account in demo mode), link them to Medusa variants, store the snapshot,
 * then run the plans of the directions in force:
 *
 *   stock      BaseLinker to Medusa (the 0.1 plan), or Medusa to the
 *              BaseLinker warehouse (`stockSource: "medusa"`)
 *   catalog    BaseLinker products into Medusa (`catalogSource:
 *              "baselinker"`), or Medusa variants into BaseLinker cards
 *   prices     Medusa prices into the BaseLinker price group (when the
 *              catalog lives in Medusa)
 *
 * Every plan is stored for the admin; only an armed writer applies it.
 *
 * THE COMPLETE-READ RULE (the same as the OLX plugin). A card missing from an
 * incomplete list looks exactly like a deleted one. So a complete read
 * replaces the snapshot, while an incomplete read only adds and updates: rows
 * it did not see stay as they were and keep their links, and no plan is made
 * from it. Positive evidence (the card IS on the list with a new SKU) is
 * always applied.
 *
 * VARIANTS (since 0.2). The list is read with `include_variants`. A main
 * product that has variants is a container: it is stored (so the admin can
 * show it) but never linked; its variants are what is sold and linked.
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { containerIds, parseProductsList, type CardInput, type CatalogRead } from "../../modules/baselinker/lib/catalog"
import type { RunDto, RunTrigger } from "../../modules/baselinker/lib/contract"
import { buildDemoProducts, DEMO_WAREHOUSE_ID, type DemoOverlay, type DemoVariant } from "../../modules/baselinker/lib/demo"
import type { ProductRow } from "../../modules/baselinker/lib/dto"
import { matchCards, normalizeEan, type CardMatch, type CatalogVariant, type MatchSummary } from "../../modules/baselinker/lib/matching"
import { toNumber } from "../../modules/baselinker/lib/numbers"
import { canPlanStock, canPushPrices, canPushStock, canReadCatalog, isValidWarehouseId } from "../../modules/baselinker/lib/options"
import type { StockCard, StockLevel, StockVariant } from "../../modules/baselinker/lib/stock"
import { runCardsPlan } from "./cards"
import { runCatalogImportPlan } from "./catalog-import"
import { runPricePushPlan } from "./prices"
import { baselinkerService, clientFor, exclusive, queryOf, recordRun, type QueryLike, type Scope } from "./runtime"
import { loadDemoState, loadDirections } from "./settings"
import { loadLevels, resolveLocation, runStockPlan, type LocationChoice } from "./stock"
import { runStockPushPlan } from "./stock-push"

export type CatalogTrigger = RunTrigger

export interface CatalogSyncInput {
  trigger?: CatalogTrigger
}

export interface CatalogSyncResult {
  run: RunDto | null
  stockRun: RunDto | null
  skipped: null | "running" | "not_configured"
  /** 0.2: the runs of the direction plans made after this read. */
  planRuns?: RunDto[]
}

/** `match_source` of a main card that has variants: stored, never linked. */
export const CONTAINER_SOURCE = "parent"

/* ------------------------------------------------------------------ */
/* Medusa variants                                                     */
/* ------------------------------------------------------------------ */

interface VariantRecord {
  id: string
  title?: string | null
  sku?: string | null
  ean?: string | null
  barcode?: string | null
  upc?: string | null
  product_id?: string | null
  manage_inventory?: boolean | null
  product?: { title?: string | null; description?: string | null; thumbnail?: string | null; categories?: Array<{ name?: string | null }> | null } | null
  inventory_items?: Array<{ inventory_item_id?: string | null; required_quantity?: unknown }> | null
}

export interface LoadedVariants {
  catalog: CatalogVariant[]
  stock: StockVariant[]
  titles: Map<string, string>
  /** What the demo account needs to look like a real one. */
  info: Map<string, { productTitle: string | null; variantTitle: string | null; description: string | null; image: string | null; category: string | null }>
}

const DEFAULT_TITLES = new Set(["default variant", "default", "domyślny", "domyślny wariant"])

/** Every variant, 500 per query, with what the matching and the stock plan need. */
export async function loadVariants(query: QueryLike): Promise<LoadedVariants> {
  const out: LoadedVariants = { catalog: [], stock: [], titles: new Map(), info: new Map() }
  const take = 500
  for (let skip = 0; skip < 1_000_000; skip += take) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "title",
        "sku",
        "ean",
        "barcode",
        "upc",
        "product_id",
        "manage_inventory",
        "product.title",
        "product.description",
        "product.thumbnail",
        "product.categories.name",
        "inventory_items.inventory_item_id",
        "inventory_items.required_quantity",
      ],
      pagination: { skip, take, order: { id: "ASC" } },
    })
    for (const v of data as VariantRecord[]) {
      const productTitle = v.product?.title ?? null
      out.catalog.push({ id: v.id, productId: v.product_id ?? "", sku: v.sku ?? null, codes: [v.ean, v.barcode, v.upc], productTitle })
      out.stock.push({
        id: v.id,
        productId: v.product_id ?? null,
        sku: v.sku ?? null,
        productTitle,
        manageInventory: v.manage_inventory !== false,
        inventoryItems: (v.inventory_items ?? [])
          .filter((ii) => ii?.inventory_item_id)
          .map((ii) => ({ inventoryItemId: ii.inventory_item_id as string, requiredQuantity: toNumber(ii.required_quantity) || 1 })),
      })
      const variantTitle = v.title && !DEFAULT_TITLES.has(v.title.trim().toLowerCase()) && v.title !== productTitle ? v.title : null
      const title = [productTitle, variantTitle].filter(Boolean).join(" ")
      if (title) out.titles.set(v.id, title)
      out.info.set(v.id, {
        productTitle,
        variantTitle,
        description: v.product?.description ?? null,
        image: v.product?.thumbnail ?? null,
        category: (v.product?.categories ?? []).map((c) => c?.name ?? "").find(Boolean) ?? null,
      })
    }
    if (data.length < take) break
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Reading the cards                                                   */
/* ------------------------------------------------------------------ */

async function liveRead(svc: BaseLinkerModuleService): Promise<CatalogRead> {
  const o = svc.getOptions()
  const warehouse = isValidWarehouseId(o.warehouseId) ? o.warehouseId : null
  return clientFor(svc).readCatalog(o.inventoryId as number, warehouse)
}

/** Prices of the variants used by the demo, PLN first. Decoration only: no prices, no problem. */
async function demoPrices(query: QueryLike, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  try {
    const { data } = await query.graph({ entity: "product_variant", fields: ["id", "prices.amount", "prices.currency_code"], filters: { id: ids } })
    for (const raw of data as Array<{ id: string; prices?: Array<{ amount?: unknown; currency_code?: string | null }> | null }>) {
      const prices = (raw.prices ?? []).filter((p) => p && p.amount != null)
      const pick = prices.find((p) => String(p.currency_code ?? "").toLowerCase() === "pln") ?? prices[0]
      if (pick) out.set(raw.id, toNumber(pick.amount))
    }
  } catch {
    /* prices are decoration in demo mode */
  }
  return out
}

export interface DemoRead {
  read: CatalogRead
  list: Record<string, Record<string, unknown>>
  variants: DemoVariant[]
}

/** The simulated account: built from the store's own variants and what the simulated writers did, read through the real parser. */
export async function demoRead(svc: BaseLinkerModuleService, query: QueryLike, variants: LoadedVariants, levels: StockLevel[]): Promise<DemoRead> {
  const available = new Map(levels.map((l) => [l.inventoryItemId, Math.max(0, l.stockedQuantity - l.reservedQuantity)]))
  const withSku = variants.stock.filter((v) => v.sku && v.sku.trim())
  const prices = await demoPrices(
    query,
    withSku.slice(0, 200).map((v) => v.id),
  )
  const catalogById = new Map(variants.catalog.map((v) => [v.id, v]))
  const demoVariants: DemoVariant[] = withSku.map((v) => {
    const single = v.manageInventory && v.inventoryItems.length === 1 ? v.inventoryItems[0].inventoryItemId : null
    const codes = catalogById.get(v.id)?.codes ?? []
    const ean = codes.map((c) => normalizeEan(c)).find((c): c is string => Boolean(c)) ?? null
    const info = variants.info.get(v.id)
    return {
      sku: (v.sku as string).trim(),
      ean,
      title: variants.titles.get(v.id) ?? (v.sku as string),
      available: single !== null ? available.get(single) ?? 0 : null,
      price: prices.get(v.id) ?? null,
      productId: v.productId,
      productTitle: info?.productTitle ?? null,
      variantTitle: info?.variantTitle ?? null,
      description: info?.description ?? null,
      image: info?.image ?? null,
      category: info?.category ?? null,
    }
  })
  const state = await loadDemoState(svc)
  const overlay: DemoOverlay = { cards: state.cards, cardUpdates: state.cardUpdates, stock: state.stock, prices: state.prices }
  const list = buildDemoProducts(demoVariants, overlay)
  const page = parseProductsList(list, DEMO_WAREHOUSE_ID)
  return { read: { cards: page.cards, complete: true, pages: 1, reason: null }, list, variants: demoVariants }
}

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

type ProductData = Omit<ProductRow, "id" | "updated_at">

function rowToCard(r: ProductRow): CardInput {
  return {
    blProductId: r.bl_product_id,
    parentId: r.parent_id ?? null,
    sku: r.sku ?? null,
    ean: r.ean ?? null,
    name: r.name ?? "",
    stock: r.stock ?? null,
    prices: r.price ?? null,
  }
}

function desiredRow(card: CardInput, m: CardMatch | undefined, demo: boolean, container: boolean): ProductData {
  return {
    bl_product_id: card.blProductId,
    parent_id: card.parentId,
    sku: card.sku,
    ean: card.ean,
    name: card.name,
    stock: card.stock,
    price: card.prices,
    match_key: container ? null : m?.key ?? null,
    match_source: container ? CONTAINER_SOURCE : m?.source ?? null,
    variant_id: container ? null : m?.variant?.id ?? null,
    product_id: container ? null : m?.variant?.productId || null,
    variant_sku: container ? null : m?.variant?.sku ?? null,
    product_title: container ? null : m?.variant?.productTitle ?? null,
    conflict: container ? null : m?.conflict ?? null,
    demo,
  }
}

const COMPARED = [
  "parent_id",
  "sku",
  "ean",
  "name",
  "stock",
  "match_key",
  "match_source",
  "variant_id",
  "product_id",
  "variant_sku",
  "product_title",
  "conflict",
] as const

function changed(row: ProductRow, want: ProductData): boolean {
  for (const f of COMPARED) if ((row[f] ?? null) !== (want[f] ?? null)) return true
  if (Boolean(row.demo) !== want.demo) return true
  return !sameJson(row.price, want.price)
}

/**
 * JSON with keys sorted at every level. Postgres jsonb stores object keys in
 * its own order (shorter keys first), so a stored price map compared with a
 * fresh one through JSON.stringify would look changed on every sync.
 */
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === "object" && !(v instanceof Date)) {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
      )
    }
    return v ?? null
  }
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null))
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export interface Applied {
  summary: MatchSummary
  created: number
  updated: number
  removed: number
  stockCards: StockCard[]
  /** Every card of this read and of the kept snapshot (containers included). */
  cards: CardInput[]
  /** Card id to linked variant id (containers and conflicts left out). */
  links: Map<string, string>
  /** Card id to its conflict. */
  conflicts: Map<string, string>
  containers: number
}

async function applyRead(svc: BaseLinkerModuleService, read: CatalogRead, variants: CatalogVariant[], demo: boolean): Promise<Applied> {
  const stored = (await svc.listBaseLinkerProducts({}, { take: null } as never)) as unknown as ProductRow[]
  const sameMode = stored.filter((r) => Boolean(r.demo) === demo)
  const otherMode = stored.filter((r) => Boolean(r.demo) !== demo)
  const fresh = new Map(read.cards.map((c) => [c.blProductId, c]))
  const byId = new Map(sameMode.map((r) => [r.bl_product_id, r]))

  const universe: Array<{ card: CardInput; row: ProductRow | null }> = read.cards.map((c) => ({ card: c, row: byId.get(c.blProductId) ?? null }))
  /* Incomplete read: what we did not see stays exactly as it was. */
  if (!read.complete) for (const r of sameMode) if (!fresh.has(r.bl_product_id)) universe.push({ card: rowToCard(r), row: r })

  /* Demo rows go when a real account syncs (and the other way round). */
  const removeIds = otherMode.map((r) => r.id)
  if (read.complete) for (const r of sameMode) if (!fresh.has(r.bl_product_id)) removeIds.push(r.id)

  /* A main card with variants is a container: never matched. */
  const parents = containerIds(universe.map((u) => u.card))
  const sellable = universe.filter((u) => !parents.has(u.card.blProductId))
  const { matches, summary } = matchCards(
    sellable.map((u) => u.card),
    variants,
  )

  const creates: ProductData[] = []
  const updates: Array<ProductData & { id: string }> = []
  for (const u of universe) {
    const want = desiredRow(u.card, matches.get(u.card.blProductId), demo, parents.has(u.card.blProductId))
    if (!u.row) creates.push(want)
    else if (changed(u.row, want)) updates.push({ id: u.row.id, ...want })
  }

  for (const part of chunks(removeIds, 500)) await svc.deleteBaseLinkerProducts(part)
  for (const part of chunks(creates, 200)) await svc.createBaseLinkerProducts(part as never)
  for (const part of chunks(updates, 200)) await svc.updateBaseLinkerProducts(part as never)

  const links = new Map<string, string>()
  const conflicts = new Map<string, string>()
  const stockCards: StockCard[] = sellable.map((u) => {
    const m = matches.get(u.card.blProductId)
    if (m?.variant && !m.conflict) links.set(u.card.blProductId, m.variant.id)
    if (m?.conflict) conflicts.set(u.card.blProductId, m.conflict)
    return { blProductId: u.card.blProductId, variantId: m?.variant?.id ?? null, conflict: m?.conflict ?? null, stock: u.card.stock }
  })
  return {
    summary,
    created: creates.length,
    updated: updates.length,
    removed: removeIds.length,
    stockCards,
    cards: universe.map((u) => u.card),
    links,
    conflicts,
    containers: parents.size,
  }
}

/** What Medusa can still sell per variant (single inventory item, level at the location). */
function availableByVariant(variants: readonly StockVariant[], levels: readonly StockLevel[]): Map<string, number> {
  const byItem = new Map(levels.map((l) => [l.inventoryItemId, Math.max(0, l.stockedQuantity - Math.max(0, l.reservedQuantity))]))
  const out = new Map<string, number>()
  for (const v of variants) {
    if (!v.manageInventory || v.inventoryItems.length !== 1 || v.inventoryItems[0].requiredQuantity !== 1) continue
    const qty = byItem.get(v.inventoryItems[0].inventoryItemId)
    if (qty !== undefined) out.set(v.id, qty)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function runCatalogSync(scope: Scope, input: CatalogSyncInput = {}): Promise<CatalogSyncResult> {
  const result = await exclusive("catalog", async (): Promise<CatalogSyncResult> => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const trigger: CatalogTrigger = input.trigger ?? "manual"
    if (!canReadCatalog(o)) return { run: null, stockRun: null, skipped: "not_configured" }
    const startedAt = new Date()
    try {
      const query = queryOf(scope)
      const directions = await loadDirections(svc)
      const variants = await loadVariants(query)
      const planning = o.stockSync !== "off" && (directions.stock === "medusa" ? canPushStock(o) : canPlanStock(o))
      let location: LocationChoice = { id: null, reason: "no_location" }
      let levels: StockLevel[] = []
      if (planning || o.demo) {
        location = await resolveLocation(scope, o.stockLocationId, o.demo)
        if (location.id) levels = await loadLevels(scope, location.id)
      }

      const demo = o.demo ? await demoRead(svc, query, variants, levels) : null
      const read = demo ? demo.read : await liveRead(svc)
      const applied = await applyRead(svc, read, variants.catalog, o.demo)
      const s = applied.summary
      const status = read.complete ? "ok" : read.pages === 0 ? "error" : "partial"
      const run = await recordRun(svc, {
        kind: "catalog",
        trigger,
        status,
        complete: read.complete,
        startedAt,
        counts: {
          pages: read.pages,
          cards: s.cards,
          containers: applied.containers,
          linked: s.linked,
          linkedBySku: s.linkedBySku,
          linkedByEan: s.linkedByEan,
          unmatched: s.unmatched,
          conflicts: s.conflicts,
          duplicateSku: s.duplicateSku,
          duplicateEan: s.duplicateEan,
          ambiguousVariant: s.ambiguousVariant,
          noSku: s.noSku,
          onlyInMedusa: s.onlyInMedusa,
          onlyInMedusaSkus: s.onlyInMedusaSkus,
          duplicateSkus: s.duplicateSkus,
          created: applied.created,
          updated: applied.updated,
          removed: applied.removed,
        },
        message: read.complete ? null : read.reason,
      })
      svc
        .getLogger()
        .info(
          `[baselinker] catalog ${o.demo ? "demo" : "api"}/${trigger} ${status}: cards=${s.cards} linked=${s.linked} ` +
            `conflicts=${s.conflicts} unmatched=${s.unmatched} only_in_medusa=${s.onlyInMedusa}` +
            (read.complete ? "" : ` incomplete: ${svc.mask(read.reason ?? "unknown reason")}`),
        )

      /* Stock: one direction at a time. */
      let stockRun: RunDto | null = null
      if (planning) {
        stockRun =
          directions.stock === "medusa"
            ? await runStockPushPlan(scope, { trigger, read, stockCards: applied.stockCards, variants: variants.stock, location, levels })
            : await runStockPlan(scope, { trigger, complete: read.complete, cards: applied.stockCards, variants: variants.stock, location, levels })
      }
      const demoData = demo ? { list: demo.list, variants: demo.variants } : undefined

      /* Catalog and prices. A failure here is recorded on its own run and never fails the read. */
      const planRuns: RunDto[] = []
      const guard = async (what: string, fn: () => Promise<RunDto | null>) => {
        try {
          const r = await fn()
          if (r) planRuns.push(r)
        } catch (err) {
          svc.getLogger().error(`[baselinker] ${what} plan failed: ${svc.mask((err as Error)?.message ?? String(err))}`)
        }
      }
      if (directions.catalog === "baselinker") {
        await guard("catalog import", () => runCatalogImportPlan(scope, { trigger, read, links: applied.links, demo: demoData }))
      } else {
        const available = availableByVariant(variants.stock, levels)
        await guard("cards", () => runCardsPlan(scope, { trigger, read, cards: applied.cards, links: applied.links, conflicts: applied.conflicts, available }))
        if (canPushPrices(o)) {
          await guard("prices", () => runPricePushPlan(scope, { trigger, read, cards: applied.cards, links: applied.links, conflicts: applied.conflicts, demo: demoData }))
        }
      }
      return { run, stockRun, skipped: null, planRuns }
    } catch (err) {
      /* A BaseLinker failure is not a store failure: record it and move on. */
      const message = svc.mask(err instanceof Error ? err.message : String(err))
      svc.getLogger().error(`[baselinker] catalog sync failed: ${message}`)
      const run = await recordRun(svc, { kind: "catalog", trigger, status: "error", startedAt, message }).catch(() => null)
      return { run, stockRun: null, skipped: null }
    }
  })
  return result ?? { run: null, stockRun: null, skipped: "running" }
}
