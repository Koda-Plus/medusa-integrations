/**
 * PRODUCTS AND PRICES FROM SUBIEKT: read, plan, store, and apply only through
 * armed writers.
 *
 * 1. READ every page of `/v1/products` (one bridge snapshot). A read that
 *    stops early (an error, or the page limit with pages left) plans NOTHING
 *    and keeps the previous plan.
 * 2. PLAN with `lib/products.ts`: price changes from and to, products to
 *    create, conflicts. Stored in `subiekt_catalog_change`, replacing the
 *    previous plan, so the admin always shows what Subiekt would do now.
 * 3. APPLY, per item, only when the writer is allowed by its option AND armed
 *    by a person: at most `maxPriceChangesPerRun` prices and
 *    `maxProductsPerRun` products a run (the rest is `over_cap`, next run).
 *    Every item is read again right before it is written; when Medusa changed
 *    in between, the item is `stale` and waits for the next plan. An item that
 *    fails three runs in a row is quarantined until a person releases it.
 *
 * Prices of a variant are written with Medusa's `upsertVariantPricesWorkflow`,
 * sending back EVERY existing price of the variant by id (only the target one
 * with a new amount): the pricing module deletes the prices a price set update
 * does not mention, so this keeps other currencies and region prices intact.
 * Price lists use `batchPriceListPricesWorkflow` (create or update one price).
 * New products are drafts with one variant, created with
 * `createProductsWorkflow`; a person completes and publishes them.
 *
 * Demo mode: armed writers "apply" against the simulation, rows say
 * `simulated`, the demo catalog is never changed.
 */

import { batchPriceListPricesWorkflow, createProductsWorkflow, upsertVariantPricesWorkflow } from "@medusajs/medusa/core-flows"
import { ProductStatus } from "@medusajs/framework/utils"
import { PRODUCTS_MAX_PAGES, PRODUCTS_PAGE_SIZE, QUARANTINE_AFTER_FAILURES } from "../../modules/subiekt/lib/constants"
import type { BridgeHealth, CatalogChangeKind, PriceLevel, ProductItem } from "../../modules/subiekt/lib/contract"
import { supports } from "../../modules/subiekt/lib/capabilities"
import { round, toNumber } from "../../modules/subiekt/lib/numbers"
import {
  currentPrice,
  gramsFromKg,
  handleFor,
  nextQuarantine,
  planCatalog,
  type ApplyOutcome,
  type CatalogPlan,
  type CatalogVariant,
} from "../../modules/subiekt/lib/products"
import { bridgeFor, getConnection, queryOf, subiektService, type Scope } from "./runtime"
import { writerActive } from "./writers"

type Svc = ReturnType<typeof subiektService>

export interface CatalogRow {
  id: string
  kind: CatalogChangeKind
  status: string
  symbol: string
  sku: string | null
  ean: string | null
  title: string | null
  variant_id: string | null
  product_id: string | null
  price_id: string | null
  currency: string
  from_minor: number | null
  to_minor: number | null
  level: string | null
  matched_by: string | null
  data: Record<string, unknown> | null
  attempts: number
  last_error: string | null
  applied_at: Date | string | null
}

interface QuarantineRow {
  id: string
  kind: string
  item_key: string
  failures: number
  quarantined: boolean
}

export interface ProductsRead {
  complete: boolean
  pages: number
  snapshotAt: string | null
  levels: PriceLevel[]
  items: ProductItem[]
}

/** Every page of one bridge snapshot. `complete` is false when the page limit stopped the read. */
export async function readBridgeProducts(scope: Scope): Promise<ProductsRead> {
  const bridge = bridgeFor(scope)
  const items: ProductItem[] = []
  let levels: PriceLevel[] = []
  let snapshotAt: string | null = null
  let cursor: string | null = null
  let pages = 0
  do {
    const page = await bridge.listProducts(cursor, PRODUCTS_PAGE_SIZE)
    pages += 1
    snapshotAt = snapshotAt ?? page.snapshot_at
    if (pages === 1) levels = page.price_levels ?? []
    items.push(...(page.items ?? []))
    cursor = page.next_cursor
  } while (cursor && pages < PRODUCTS_MAX_PAGES)
  return { complete: !cursor, pages, snapshotAt, levels, items }
}

interface VariantRecord {
  id: string
  product_id?: string | null
  sku?: string | null
  barcode?: string | null
  ean?: string | null
  upc?: string | null
  title?: string | null
  product?: { title?: string | null } | null
  price_set?: { id?: string | null } | null
  prices?: Array<{
    id: string
    amount?: unknown
    currency_code?: string | null
    price_list_id?: string | null
    rules_count?: unknown
    min_quantity?: unknown
    max_quantity?: unknown
  }> | null
}

const VARIANT_FIELDS = ["id", "product_id", "sku", "barcode", "ean", "upc", "title", "product.title", "price_set.id", "prices.*"]

function toCatalogVariant(v: VariantRecord): CatalogVariant {
  const quantity = (q: unknown) => (q === null || q === undefined || q === "" ? null : toNumber(q))
  return {
    id: v.id,
    productId: v.product_id ?? "",
    sku: v.sku ?? null,
    codes: [v.ean, v.barcode, v.upc],
    title: v.title ?? null,
    productTitle: v.product?.title ?? null,
    prices: (v.prices ?? []).map((p) => ({
      id: p.id,
      amount: toNumber(p.amount),
      currency: (p.currency_code ?? "").toLowerCase(),
      priceListId: p.price_list_id ?? null,
      rulesCount: toNumber(p.rules_count),
      minQuantity: quantity(p.min_quantity),
      maxQuantity: quantity(p.max_quantity),
    })),
  }
}

/** Every variant with its prices. Whole relations (`prices.*`): amounts are BigNumbers. */
export async function loadCatalogVariants(scope: Scope): Promise<CatalogVariant[]> {
  const query = queryOf(scope)
  const out: CatalogVariant[] = []
  const take = 500
  for (let skip = 0; skip < 500_000; skip += take) {
    const { data } = await query.graph({ entity: "product_variant", fields: VARIANT_FIELDS, pagination: { skip, take, order: { id: "ASC" } } })
    for (const v of data as VariantRecord[]) out.push(toCatalogVariant(v))
    if (data.length < take) break
  }
  return out
}

export interface CatalogPlanResult {
  skipped: null | "disabled" | "not_configured" | "not_supported" | "incomplete"
  message: string | null
  plan: CatalogPlan | null
  snapshotAt: string | null
  pages: number
}

export async function planCatalogFromBridge(scope: Scope): Promise<CatalogPlanResult> {
  const svc = subiektService(scope)
  const o = svc.getOptions()
  const none = { plan: null, snapshotAt: null, pages: 0 }
  if (!o.productSyncEnabled) return { ...none, skipped: "disabled", message: "Products from Subiekt are off (productSyncEnabled: false)." }
  if (!o.demo && !svc.isConfigured()) return { ...none, skipped: "not_configured", message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` }
  if (!o.demo) {
    const health = ((await getConnection(svc)).health as unknown as BridgeHealth | null) ?? null
    if (!supports(health, "products")) {
      return {
        ...none,
        skipped: "not_supported",
        message: health
          ? "The bridge does not report products: it speaks contract 1.0. Update the bridge to 0.2.0 or newer."
          : "The bridge was not checked yet. Check the connection first.",
      }
    }
  }

  const read = await readBridgeProducts(scope)
  if (!read.complete) {
    return {
      plan: null,
      snapshotAt: read.snapshotAt,
      pages: read.pages,
      skipped: "incomplete",
      message: `The bridge sent ${read.pages} pages and more were waiting: an incomplete read plans nothing.`,
    }
  }
  const variants = await loadCatalogVariants(scope)
  const plan = planCatalog(
    read.items,
    variants,
    { target: o.priceTarget, priceListId: o.priceListId || null, level: o.priceLevel, type: o.priceType, currency: o.priceCurrency },
    read.levels,
  )
  return { skipped: null, message: null, plan, snapshotAt: read.snapshotAt, pages: read.pages }
}

const minor = (n: number | null): number | null => (n === null ? null : Math.round(n * 100))

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Replaces the stored plan of this mode with a new one. */
export async function storeCatalogPlan(svc: Svc, plan: CatalogPlan, runKey: string): Promise<CatalogRow[]> {
  const demo = svc.isDemo()
  const old = (await svc.listSubiektCatalogChanges({ demo } as never, { take: null, select: ["id"] } as never)) as unknown as Array<{ id: string }>
  for (const part of chunks(old.map((r) => r.id), 500)) await svc.deleteSubiektCatalogChanges(part)

  const data = [
    ...plan.prices.map((p) => ({
      run_id: runKey,
      kind: "price",
      status: "planned",
      symbol: p.symbol,
      sku: p.sku,
      ean: p.ean,
      title: p.title,
      variant_id: p.variantId,
      product_id: p.productId,
      price_id: p.priceId,
      currency: p.currency,
      from_minor: minor(p.from),
      to_minor: minor(p.to),
      level: p.level,
      matched_by: p.matchedBy,
      data: null,
      demo,
    })),
    ...plan.creates.map((c) => ({
      run_id: runKey,
      kind: "create",
      status: "planned",
      symbol: c.symbol,
      sku: c.symbol,
      ean: c.ean,
      title: c.title,
      variant_id: null,
      product_id: null,
      price_id: null,
      currency: c.currency,
      from_minor: null,
      to_minor: minor(c.to),
      level: c.level,
      matched_by: null,
      data: { unit: c.unit, vatRate: c.vatRate, weightKg: c.weightKg, manageInventory: c.manageInventory },
      demo,
    })),
  ]
  const rows: CatalogRow[] = []
  for (const part of chunks(data, 500)) {
    const created = (await svc.createSubiektCatalogChanges(part as never)) as unknown as CatalogRow[]
    rows.push(...created)
  }
  return rows
}

/** The quarantine key of a plan row: the variant for a price, the Subiekt symbol for a new product. */
export function quarantineKey(row: Pick<CatalogRow, "kind" | "variant_id" | "symbol">): string {
  return row.kind === "price" ? row.variant_id ?? row.symbol : row.symbol
}

async function applyVariantPrice(scope: Scope, row: CatalogRow, target: "variant" | "price_list", priceListId: string | null): Promise<ApplyOutcome> {
  const { data } = await queryOf(scope).graph({ entity: "product_variant", fields: VARIANT_FIELDS, filters: { id: row.variant_id } })
  const record = data[0] as VariantRecord | undefined
  if (!record) return "stale"
  const variant = toCatalogVariant(record)
  const current = currentPrice(variant, { target, priceListId, currency: row.currency })
  const from = row.from_minor === null ? null : row.from_minor / 100
  if ((current ? round(current.amount, 2) : null) !== from) return "stale"
  const to = (row.to_minor ?? 0) / 100

  if (target === "price_list" && priceListId) {
    await batchPriceListPricesWorkflow(scope as never).run({
      input: {
        data: {
          id: priceListId,
          create: current ? [] : [{ amount: to, currency_code: row.currency, variant_id: variant.id }],
          update: current ? [{ id: current.id, amount: to, currency_code: row.currency, variant_id: variant.id }] : [],
          delete: [],
        },
      },
    })
    return "applied"
  }

  // Every price of the variant goes back by id, so the update deletes nothing.
  const own = (record.prices ?? []).filter((p) => !p.price_list_id)
  const prices: Array<{ id?: string; amount?: number; currency_code?: string }> = own.map((p) =>
    p.id === current?.id ? { id: p.id, amount: to, currency_code: p.currency_code ?? row.currency } : { id: p.id },
  )
  if (!current) prices.push({ amount: to, currency_code: row.currency })
  await upsertVariantPricesWorkflow(scope as never).run({
    input: {
      variantPrices: [{ variant_id: variant.id, product_id: variant.productId, prices: prices as never }],
      previousVariantIds: record.price_set?.id ? [variant.id] : [],
    },
  })
  return "applied"
}

async function applyCreate(scope: Scope, row: CatalogRow): Promise<ApplyOutcome> {
  const query = queryOf(scope)
  const bySku = await query.graph({ entity: "product_variant", fields: ["id"], filters: { sku: row.symbol } })
  if (bySku.data.length > 0) return "stale"
  if (row.ean) {
    const byEan = await query.graph({ entity: "product_variant", fields: ["id"], filters: { ean: row.ean } })
    if (byEan.data.length > 0) return "stale"
  }
  const d = (row.data ?? {}) as { unit?: string | null; vatRate?: number | null; weightKg?: number | null; manageInventory?: boolean }
  const title = row.title ?? row.symbol
  await createProductsWorkflow(scope as never).run({
    input: {
      products: [
        {
          title,
          handle: handleFor(title, row.symbol),
          status: ProductStatus.DRAFT,
          options: [{ title: "Default option", values: ["Default option value"] }],
          variants: [
            {
              title,
              sku: row.symbol,
              ...(row.ean ? { ean: row.ean, barcode: row.ean } : {}),
              manage_inventory: d.manageInventory !== false,
              ...(gramsFromKg(d.weightKg ?? null) ? { weight: gramsFromKg(d.weightKg ?? null) } : {}),
              prices: [{ amount: (row.to_minor ?? 0) / 100, currency_code: row.currency }],
              options: { "Default option": "Default option value" },
            },
          ],
          metadata: { subiekt_symbol: row.symbol, subiekt_unit: d.unit ?? null, subiekt_vat_rate: d.vatRate ?? null },
        },
      ],
    } as never,
  })
  return "applied"
}

export interface ApplyStats {
  pricesActive: boolean
  productsActive: boolean
  applied: number
  simulated: number
  stale: number
  failed: number
  overCap: number
  quarantined: number
}

/** Applies the stored plan through the armed writers. Never throws for one item: failures land in the row. */
export async function applyCatalogPlan(scope: Scope, rows: CatalogRow[]): Promise<ApplyStats> {
  const svc = subiektService(scope)
  const o = svc.getOptions()
  const demo = svc.isDemo()
  const stats: ApplyStats = {
    pricesActive: await writerActive(scope, "prices"),
    productsActive: await writerActive(scope, "products"),
    applied: 0,
    simulated: 0,
    stale: 0,
    failed: 0,
    overCap: 0,
    quarantined: 0,
  }
  const quarantine = new Map<string, QuarantineRow>()
  for (const q of (await svc.listSubiektCatalogQuarantines({ demo } as never, { take: null } as never)) as unknown as QuarantineRow[]) {
    quarantine.set(`${q.kind}:${q.item_key}`, q)
  }

  const statusUpdates = new Map<string, string[]>()
  const mark = (id: string, status: string) => statusUpdates.set(status, [...(statusUpdates.get(status) ?? []), id])

  for (const kind of ["price", "create"] as const) {
    const active = kind === "price" ? stats.pricesActive : stats.productsActive
    if (!active) continue
    const cap = kind === "price" ? o.maxPriceChangesPerRun : o.maxProductsPerRun
    let done = 0
    for (const row of rows.filter((r) => r.kind === kind)) {
      const key = `${kind}:${quarantineKey(row)}`
      const q = quarantine.get(key)
      if (q?.quarantined) {
        stats.quarantined += 1
        mark(row.id, "quarantined")
        continue
      }
      if (done >= cap) {
        stats.overCap += 1
        mark(row.id, "over_cap")
        continue
      }
      done += 1
      if (demo) {
        // The demo writer "succeeds" against the simulation; the demo catalog is never changed.
        stats.simulated += 1
        await svc.updateSubiektCatalogChanges({ id: row.id, status: "simulated", applied_at: new Date(), attempts: (row.attempts ?? 0) + 1 } as never)
        continue
      }
      let outcome: ApplyOutcome
      let error: string | null = null
      try {
        outcome = kind === "price" ? await applyVariantPrice(scope, row, o.priceTarget, o.priceListId || null) : await applyCreate(scope, row)
      } catch (err) {
        outcome = "failed"
        error = svc.mask((err as Error)?.message ?? String(err)).slice(0, 1000)
      }
      if (outcome === "applied") stats.applied += 1
      else if (outcome === "stale") stats.stale += 1
      else stats.failed += 1
      await svc.updateSubiektCatalogChanges({
        id: row.id,
        status: outcome,
        applied_at: outcome === "applied" ? new Date() : null,
        attempts: (row.attempts ?? 0) + 1,
        last_error: error,
      } as never)

      const next = nextQuarantine(q?.failures ?? 0, outcome, QUARANTINE_AFTER_FAILURES)
      if (q) await svc.updateSubiektCatalogQuarantines({ id: q.id, failures: next.failures, quarantined: next.quarantined, last_error: error } as never)
      else if (outcome === "failed") {
        await svc.createSubiektCatalogQuarantines({ kind, item_key: quarantineKey(row), failures: next.failures, quarantined: next.quarantined, last_error: error, demo } as never)
      }
    }
  }
  for (const [status, ids] of statusUpdates) {
    for (const part of chunks(ids, 500)) await svc.updateSubiektCatalogChanges(part.map((id) => ({ id, status })) as never)
  }
  return stats
}
