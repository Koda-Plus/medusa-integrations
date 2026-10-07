import type { ImportRow, InvoiceRow, OrderRow, PlanItemRow, ProductRow, StockChangeRow } from "../../modules/baselinker/lib/dto"
import {
  BASELINKER_EXTERNAL_HOSTS,
  ORDER_WIDGET,
  PRODUCT_WIDGET,
  baselinkerCounters,
  inventorySummary,
  orderSummary,
  productSummary,
} from "../../modules/baselinker/lib/integration"
import { integrationEn, integrationPl } from "../../modules/baselinker/lib/integration-texts"
import { KIT_META } from "../../modules/baselinker/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/baselinker/lib/kit-routes"
import { normalizeEan, normalizeSku } from "../../modules/baselinker/lib/matching"
import { demoPrepared } from "./demo"
import { baselinkerService, queryOf } from "./runtime"
import { loadWriters } from "./settings"

/**
 * koda.integration/1 for BaseLinker: the manifest, one line per order,
 * product and inventory item, and the board counters, read from the
 * plugin's tables (and from Medusa records read by id: the variants of a
 * product or of an inventory item). Reads only: no demo seeding, no call to
 * BaseLinker, no write, one query per table for a whole batch.
 *
 *   GET /admin/baselinker/integration
 *   GET /admin/baselinker/integration/summary?entity=order|product|inventory_item&id= (or ids=)
 *   GET /admin/baselinker/integration/attention?scope=orders,products,inventory
 */

type Svc = ReturnType<typeof baselinkerService>

async function rows<T>(p: Promise<unknown>): Promise<T[]> {
  return (await p) as T[]
}

const STOCK_STATES = ["planned", "over_cap", "failed"]

type Change = { field: string; from: string | number | null; to: string | number | null }

/** The field changes of a plan item (stored as JSON). */
function changesOf(item: Pick<PlanItemRow, "changes">): Change[] {
  return Array.isArray(item.changes) ? (item.changes as Change[]).filter((c) => c && typeof c.field === "string") : []
}

/** Delta of a stock push item: its stock change, to minus from. */
function pushDelta(item: Pick<PlanItemRow, "changes">): number {
  const c = changesOf(item).find((x) => x.field === "stock")
  return Number(c?.to ?? 0) - Number(c?.from ?? 0)
}

async function orderDrafts(svc: Svc, ids: string[]): Promise<Map<string, SummaryDraft>> {
  const demo = svc.isDemo()
  const [exported, imported, invoices] = await Promise.all([
    rows<OrderRow>(svc.listBaseLinkerOrders({ order_id: ids, demo } as never, { take: ids.length * 2 } as never)),
    rows<ImportRow>(svc.listBaseLinkerImports({ order_id: ids, demo } as never, { take: ids.length * 2 } as never)),
    rows<InvoiceRow>(svc.listBaseLinkerInvoices({ order_id: ids, demo, status: "written" } as never, { take: ids.length * 10 } as never)),
  ])
  const out = new Map<string, SummaryDraft>()
  for (const id of ids) {
    const draft = orderSummary(
      {
        exported: exported.find((r) => r.order_id === id) ?? null,
        imported: imported.find((r) => r.order_id === id) ?? null,
        invoices: invoices.filter((r) => r.order_id === id),
      },
      { demo },
    )
    if (draft) out.set(id, draft)
  }
  return out
}

async function productDrafts(svc: Svc, scope: Parameters<typeof queryOf>[0], ids: string[]): Promise<Map<string, SummaryDraft>> {
  const demo = svc.isDemo()
  const { data } = await queryOf(scope).graph({ entity: "product_variant", fields: ["id", "sku", "ean", "barcode", "product_id"], filters: { product_id: ids } })
  const variants = data as Array<{ id: string; sku?: string | null; ean?: string | null; barcode?: string | null; product_id: string }>
  const keyOf = (v: (typeof variants)[number]) => [normalizeSku(v.sku), normalizeEan(v.ean), normalizeEan(v.barcode)].filter((k): k is string => Boolean(k))
  const keys = [...new Set(variants.flatMap(keyOf))]
  const variantIds = variants.map((v) => v.id)
  const or: Array<Record<string, unknown>> = [{ product_id: ids }]
  if (variantIds.length > 0) or.push({ variant_id: variantIds })
  if (keys.length > 0) or.push({ match_key: keys })
  const cards = await rows<ProductRow>(svc.listBaseLinkerProducts({ demo, $or: or } as never, { take: 5000 } as never))

  const linkedCardIds = cards.filter((c) => c.variant_id && !c.conflict).map((c) => c.bl_product_id)
  const itemKeys = [
    ...variantIds.map((v) => `variant:${v}`),
    ...linkedCardIds.map((c) => `card:${c}`),
    ...ids.map((p) => `medusa:${p}`),
    ...cards.map((c) => c.parent_id).filter((p): p is string => Boolean(p) && p !== "0").map((p) => `bl:${p}`),
  ]
  const [quarantine, changes, pushes] = await Promise.all([
    itemKeys.length > 0
      ? rows<{ item_key: string }>(svc.listBaseLinkerQuarantines({ demo, quarantined_at: { $ne: null }, item_key: [...new Set(itemKeys)] } as never, { take: 1000, select: ["item_key"] } as never))
      : Promise.resolve([] as Array<{ item_key: string }>),
    rows<Pick<StockChangeRow, "product_id" | "delta">>(
      svc.listBaseLinkerStockChanges({ demo, product_id: ids, status: STOCK_STATES } as never, { take: 5000, select: ["product_id", "delta"] } as never),
    ),
    rows<Pick<PlanItemRow, "product_id" | "changes">>(
      svc.listBaseLinkerPlanItems({ demo, kind: "stock_push", product_id: ids, action: "update", status: STOCK_STATES } as never, {
        take: 5000,
        select: ["product_id", "changes"],
      } as never),
    ),
  ])
  const held = new Set(quarantine.map((q) => q.item_key))

  const out = new Map<string, SummaryDraft>()
  for (const id of ids) {
    const own = variants.filter((v) => v.product_id === id)
    const ownKeys = new Set(own.flatMap(keyOf))
    const ownVariants = new Set(own.map((v) => v.id))
    const ownCards = cards.filter((c) => c.product_id === id || (c.variant_id && ownVariants.has(c.variant_id)) || (c.conflict && c.match_key && ownKeys.has(c.match_key)))
    const ownKeysHeld = [
      ...own.map((v) => `variant:${v.id}`),
      ...ownCards.filter((c) => c.variant_id && !c.conflict).map((c) => `card:${c.bl_product_id}`),
      `medusa:${id}`,
      ...ownCards.map((c) => c.parent_id).filter((p): p is string => Boolean(p) && p !== "0").map((p) => `bl:${p}`),
    ].filter((k) => held.has(k))
    const stock = [
      ...changes.filter((c) => c.product_id === id).map((c) => ({ delta: c.delta })),
      ...pushes.filter((p) => p.product_id === id).map((p) => ({ delta: pushDelta(p) })),
    ]
    const draft = productSummary(id, { variants: own, cards: ownCards, quarantined: [...new Set(ownKeysHeld)], stockChanges: stock })
    if (draft) out.set(id, draft)
  }
  return out
}

async function inventoryDrafts(svc: Svc, scope: Parameters<typeof queryOf>[0], ids: string[]): Promise<Map<string, SummaryDraft>> {
  const demo = svc.isDemo()
  const { data } = await queryOf(scope).graph({ entity: "inventory_item", fields: ["id", "sku", "variants.id"], filters: { id: ids } })
  const items = data as Array<{ id: string; sku?: string | null; variants?: Array<{ id: string } | null> | null }>
  const variantsOf = new Map(items.map((i) => [i.id, (i.variants ?? []).map((v) => v?.id).filter((v): v is string => Boolean(v))]))
  const variantIds = [...new Set([...variantsOf.values()].flat())]

  const [cards, changes, pushes, writers] = await Promise.all([
    variantIds.length > 0
      ? rows<ProductRow>(svc.listBaseLinkerProducts({ demo, variant_id: variantIds, conflict: null } as never, { take: variantIds.length * 2 + 10 } as never))
      : Promise.resolve([] as ProductRow[]),
    rows<StockChangeRow>(svc.listBaseLinkerStockChanges({ demo, inventory_item_id: ids } as never, { take: ids.length * 5 + 10 } as never)),
    variantIds.length > 0
      ? rows<PlanItemRow>(svc.listBaseLinkerPlanItems({ demo, kind: "stock_push", variant_id: variantIds, action: "update" } as never, { take: variantIds.length * 2 + 10 } as never))
      : Promise.resolve([] as PlanItemRow[]),
    loadWriters(svc),
  ])
  const cardKeys = cards.map((c) => `card:${c.bl_product_id}`)
  const quarantine =
    cardKeys.length > 0
      ? await rows<{ item_key: string }>(
          svc.listBaseLinkerQuarantines({ demo, kind: "stock_push", quarantined_at: { $ne: null }, item_key: cardKeys } as never, { take: 1000, select: ["item_key"] } as never),
        )
      : []
  const held = new Set(quarantine.map((q) => q.item_key))
  const writerKey = writers.directions.stock === "medusa" ? "stockToBaseLinker" : "stockToMedusa"
  const armed = Boolean(writers.writers.find((w) => w.key === writerKey)?.live)

  const out = new Map<string, SummaryDraft>()
  for (const id of ids) {
    const variants = new Set(variantsOf.get(id) ?? [])
    const ownCards = cards.filter((c) => c.variant_id && variants.has(c.variant_id))
    const sku = items.find((i) => i.id === id)?.sku ?? ownCards[0]?.sku ?? null
    const draft = inventorySummary({
      sku,
      cards: ownCards,
      changes: changes.filter((c) => c.inventory_item_id === id),
      pushes: pushes.filter((p) => p.variant_id && variants.has(p.variant_id)).map((p) => ({ status: p.status, changes: changesOf(p) })),
      quarantined: ownCards.some((c) => held.has(`card:${c.bl_product_id}`)),
      armed,
    })
    if (draft) out.set(id, draft)
  }
  return out
}

async function countOf(p: Promise<unknown>): Promise<number> {
  const [, n] = (await p) as [unknown[], number]
  return n
}

export const baselinkerIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/baselinker",
  entities: ["order", "product", "inventory_item"],
  attention: ["orders", "products", "inventory"],
  widgets: [
    { id: ORDER_WIDGET, zone: "order.details" },
    { id: PRODUCT_WIDGET, zone: "product.details" },
  ],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [...BASELINKER_EXTERNAL_HOSTS],

  async status(ctx) {
    const svc = baselinkerService(ctx.scope)
    const o = svc.getOptions()
    const [{ writers }, runs, prepared] = await Promise.all([
      loadWriters(svc),
      rows<{ started_at: Date | string | null; finished_at: Date | string | null }>(
        svc.listBaseLinkerSyncRuns({ source: o.demo ? "demo" : "api" } as never, { take: 1, order: { started_at: "DESC" }, select: ["started_at", "finished_at"] } as never),
      ),
      o.demo ? demoPrepared(svc) : Promise.resolve(true),
    ])
    const configured = o.demo || svc.isConfigured()
    const problems = o.demo
      ? [{ key: "integration.problem.demo" }, ...(prepared ? [] : [{ key: "integration.problem.demo_not_prepared" }])]
      : configured
        ? []
        : [{ key: "integration.problem.not_configured", params: { missing: svc.missingOptions().join(", ") } }]
    return {
      mode: o.demo ? "demo" : o.apiToken ? "live" : "off",
      configured,
      writers: { armed: writers.filter((w) => w.armed).length, total: writers.length },
      lastSyncAt: runs[0]?.finished_at ?? runs[0]?.started_at ?? null,
      problems,
    }
  },

  async summarize(ctx, entity, ids) {
    const svc = baselinkerService(ctx.scope)
    if (entity === "order") return orderDrafts(svc, ids)
    if (entity === "product") return productDrafts(svc, ctx.scope, ids)
    if (entity === "inventory_item") return inventoryDrafts(svc, ctx.scope, ids)
    return new Map()
  },

  async count(ctx, scopes) {
    const svc = baselinkerService(ctx.scope)
    const demo = svc.isDemo()
    const one = { take: 1, select: ["id"] }
    const [failed, importsFailed, quarantined, cardsConflict] = await Promise.all([
      scopes.includes("orders")
        ? ((await svc.listAndCountBaseLinkerOrders({ demo, status: "failed" } as never, { take: 20, select: ["order_id"], order: { updated_at: "DESC" } } as never)) as unknown as [
            Array<{ order_id: string }>,
            number,
          ])
        : ([[], 0] as [Array<{ order_id: string }>, number]),
      scopes.includes("orders") ? countOf(svc.listAndCountBaseLinkerImports({ demo, status: "failed" } as never, one as never)) : Promise.resolve(0),
      scopes.includes("inventory") ? countOf(svc.listAndCountBaseLinkerQuarantines({ demo, quarantined_at: { $ne: null } } as never, one as never)) : Promise.resolve(0),
      scopes.includes("products") ? countOf(svc.listAndCountBaseLinkerProducts({ demo, conflict: { $ne: null } } as never, one as never)) : Promise.resolve(0),
    ])
    return baselinkerCounters(
      { ordersFailed: failed[1], importsFailed, quarantined, cardsConflict, failedOrderIds: failed[0].map((r) => r.order_id) },
      scopes,
    )
  },
})
