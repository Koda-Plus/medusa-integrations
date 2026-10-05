/**
 * CATALOG IMPORT RUN (catalogSource: "baselinker"): BaseLinker products into
 * Medusa, plan first.
 *
 *   1. read the details of every main product (100 per request), the
 *      categories and the manufacturers; one failed batch means no plan;
 *   2. plan with `lib/catalog-import.ts` against the Medusa catalog;
 *   3. only when the `catalogImport` writer is armed: apply, updates first,
 *      within `maxCatalogChangesPerRun`, creates in batches through Medusa's
 *      own `createProductsWorkflow` (a failed batch is retried product by
 *      product, so one bad product does not stop the others), prices through
 *      the Pricing module (only the base price of the configured currency),
 *      nothing ever deleted;
 *   4. store the plan with the outcome of every item, count failures per
 *      item and quarantine an item after `quarantineAfter` failed runs.
 *
 * In demo mode the catalog is never written: an applied item is recorded in
 * the demo state and shown as applied in the simulation.
 */

import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createProductTagsWorkflow,
  createProductVariantsWorkflow,
  updateProductOptionsWorkflow,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"
import type { IPricingModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type BaseLinkerModuleService from "../../modules/baselinker/service"
import {
  parseCategories,
  parseManufacturers,
  parseProductsData,
  type CardInput,
  type CatalogRead,
  type ProductDetails,
} from "../../modules/baselinker/lib/catalog"
import {
  buildImportGroups,
  manufacturerTagIds,
  planCatalogImport,
  type ImportItem,
  type ImportVariantSpec,
} from "../../modules/baselinker/lib/catalog-import"
import { IMPORT_APPLY_BATCH, PLUGIN_EVENTS, PRODUCT_METADATA } from "../../modules/baselinker/lib/constants"
import type { RunDto, RunTrigger } from "../../modules/baselinker/lib/contract"
import { buildDemoDetails, DEMO_PRICE_GROUP, type DemoVariant } from "../../modules/baselinker/lib/demo"
import { describeError } from "../../modules/baselinker/lib/errors"
import { normalizeSku } from "../../modules/baselinker/lib/matching"
import { selectForApply } from "../../modules/baselinker/lib/quarantine"
import { writerState } from "../../modules/baselinker/lib/writers"
import { loadCategoryIndex, loadMedusaCatalog, defaultSalesChannelId, defaultShippingProfileId, pricesIncludeTax, type MedusaCatalog } from "./medusa-catalog"
import { noteFailures, noteSuccesses, quarantinedKeys, quarantineRows, replacePlan, type PlanItemData } from "./plans"
import { baselinkerService, clientFor, emitEvent, exclusive, queryOf, recordRun, type Scope } from "./runtime"
import { loadDemoState, loadWriters, updateDemoState } from "./settings"

export interface ImportRunInput {
  trigger: RunTrigger
  read: CatalogRead
  /** BaseLinker unit id to Medusa variant id, from the card links of this read. */
  links: ReadonlyMap<string, string>
  /** Demo mode: the simulated list and the store variants it was built from. */
  demo?: { list: Record<string, Record<string, unknown>>; variants: DemoVariant[] }
}

/* ------------------------------------------------------------------ */
/* Reading BaseLinker                                                  */
/* ------------------------------------------------------------------ */

interface ImportSource {
  details: ProductDetails[]
  categories: Map<number, { name: string; parentId: number | null }>
  manufacturers: Map<number, string>
}

async function readSource(svc: BaseLinkerModuleService, input: ImportRunInput): Promise<ImportSource> {
  const o = svc.getOptions()
  if (o.demo && input.demo) {
    const raw = buildDemoDetails(input.demo.variants, input.demo.list)
    return { details: parseProductsData(raw.products), categories: parseCategories(raw.categories), manufacturers: parseManufacturers(raw.manufacturers) }
  }
  const client = clientFor(svc)
  const mainIds = input.read.cards.filter((c: CardInput) => !c.parentId).map((c) => c.blProductId)
  const details = await client.getInventoryProductsData(o.inventoryId as number, mainIds)
  const categories = await client.getInventoryCategories(o.inventoryId as number)
  const manufacturers = await client.getInventoryManufacturers()
  return { details, categories, manufacturers }
}

/* ------------------------------------------------------------------ */
/* Applying (live)                                                     */
/* ------------------------------------------------------------------ */

interface ApplyContext {
  scope: Scope
  svc: BaseLinkerModuleService
  catalog: MedusaCatalog
  categoryIndex: Map<string, string>
  salesChannelId: string | null
  shippingProfileId: string | null
  currency: string
  /** BaseLinker manufacturer names, lowercased: with `manufacturerAs: "tag"` only these tags are replaced. */
  knownManufacturers: ReadonlySet<string>
}

type Outcome = { ok: true } | { ok: false; error: string }

async function ensureCategory(ctx: ApplyContext, name: string): Promise<string> {
  const key = name.trim().toLowerCase()
  const known = ctx.categoryIndex.get(key)
  if (known) return known
  const { result } = await createProductCategoriesWorkflow(ctx.scope as never).run({ input: { product_categories: [{ name: name.trim(), is_active: true }] } })
  const id = (result as Array<{ id: string }>)[0].id
  ctx.categoryIndex.set(key, id)
  return id
}

const tagCache = new WeakMap<object, Map<string, string>>()

async function ensureTag(ctx: ApplyContext, value: string): Promise<string> {
  const cache = tagCache.get(ctx.catalog) ?? new Map<string, string>()
  tagCache.set(ctx.catalog, cache)
  const key = value.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached
  const { data } = await queryOf(ctx.scope).graph({ entity: "product_tag", fields: ["id", "value"], filters: { value: value.trim() } })
  let id = (data as Array<{ id: string }>)[0]?.id
  if (!id) {
    const { result } = await createProductTagsWorkflow(ctx.scope as never).run({ input: { product_tags: [{ value: value.trim() }] } })
    id = (result as Array<{ id: string }>)[0].id
  }
  cache.set(key, id)
  return id
}

function variantInput(spec: ImportVariantSpec, optionTitle: string | null, currency: string) {
  return {
    title: spec.title,
    sku: spec.sku,
    ean: spec.ean,
    weight: spec.weight,
    manage_inventory: true,
    allow_backorder: false,
    options: optionTitle ? { [optionTitle]: spec.optionValue as string } : { "Default option": "Default option value" },
    prices: spec.price !== null ? [{ amount: spec.price, currency_code: currency }] : [],
    metadata: { [PRODUCT_METADATA.productId]: spec.blId },
  }
}

async function createInput(ctx: ApplyContext, item: ImportItem): Promise<Record<string, unknown>> {
  const c = item.create!
  const o = ctx.svc.getOptions()
  const metadata: Record<string, unknown> = { [PRODUCT_METADATA.productId]: item.blProductId }
  if (c.manufacturer && o.manufacturerAs === "metadata") metadata[PRODUCT_METADATA.manufacturer] = c.manufacturer
  const categoryId = c.category ? c.category.id ?? (await ensureCategory(ctx, c.category.name)) : null
  const tagId = c.manufacturer && o.manufacturerAs === "tag" ? await ensureTag(ctx, c.manufacturer) : null
  return {
    title: c.title,
    handle: c.handle,
    description: c.description,
    status: o.catalogImportStatus,
    images: c.images.map((url) => ({ url })),
    thumbnail: c.images[0] ?? null,
    options: c.optionTitle
      ? [{ title: c.optionTitle, values: c.variants.map((v) => v.optionValue as string) }]
      : [{ title: "Default option", values: ["Default option value"] }],
    variants: c.variants.map((v) => variantInput(v, c.optionTitle, ctx.currency)),
    metadata,
    ...(categoryId ? { category_ids: [categoryId] } : {}),
    ...(tagId ? { tag_ids: [tagId] } : {}),
    ...(ctx.salesChannelId ? { sales_channels: [{ id: ctx.salesChannelId }] } : {}),
    ...(ctx.shippingProfileId ? { shipping_profile_id: ctx.shippingProfileId } : {}),
  }
}

async function applyCreates(ctx: ApplyContext, items: ImportItem[]): Promise<Map<string, Outcome>> {
  const out = new Map<string, Outcome>()
  for (let i = 0; i < items.length; i += IMPORT_APPLY_BATCH) {
    const batch = items.slice(i, i + IMPORT_APPLY_BATCH)
    const prepared: Array<{ item: ImportItem; input: Record<string, unknown> }> = []
    for (const item of batch) {
      try {
        prepared.push({ item, input: await createInput(ctx, item) })
      } catch (err) {
        out.set(item.key, { ok: false, error: describeError(err).message })
      }
    }
    if (prepared.length === 0) continue
    try {
      await createProductsWorkflow(ctx.scope as never).run({ input: { products: prepared.map((p) => p.input) as never } })
      for (const p of prepared) out.set(p.item.key, { ok: true })
    } catch {
      /* One bad product rolls the whole batch back: try them one by one, so the error lands on the right one. */
      for (const p of prepared) {
        try {
          await createProductsWorkflow(ctx.scope as never).run({ input: { products: [p.input] as never } })
          out.set(p.item.key, { ok: true })
        } catch (err) {
          out.set(p.item.key, { ok: false, error: describeError(err).message })
        }
      }
    }
  }
  return out
}

async function applyUpdate(ctx: ApplyContext, item: ImportItem): Promise<void> {
  const u = item.update!
  const o = ctx.svc.getOptions()
  const patch: Record<string, unknown> = { id: u.productId }
  if (u.title !== undefined) patch.title = u.title
  if (u.description !== undefined) patch.description = u.description
  if (u.images !== undefined) {
    patch.images = u.images.map((url) => ({ url }))
    patch.thumbnail = u.images[0] ?? null
  }
  if (u.category) patch.category_ids = [...new Set([...u.category.keep, u.category.id ?? (await ensureCategory(ctx, u.category.name))])]
  if (u.manufacturer !== undefined) {
    if (o.manufacturerAs === "metadata") patch.metadata = { ...(ctx.catalog.metadata.get(u.productId) ?? {}), [PRODUCT_METADATA.manufacturer]: u.manufacturer }
    else {
      const current = ctx.catalog.products.find((p) => p.id === u.productId)?.tags ?? []
      patch.tag_ids = manufacturerTagIds(current, ctx.knownManufacturers, await ensureTag(ctx, u.manufacturer))
    }
  }
  if (Object.keys(patch).length > 1) await updateProductsWorkflow(ctx.scope as never).run({ input: { products: [patch] as never } })

  const fields = u.variants
    .map((v) => {
      const p: Record<string, unknown> = { id: v.variantId }
      if (v.title !== undefined) p.title = v.title
      if (v.ean !== undefined) p.ean = v.ean
      if (v.weight !== undefined) p.weight = v.weight
      return p
    })
    .filter((p) => Object.keys(p).length > 1)
  if (fields.length > 0) await updateProductVariantsWorkflow(ctx.scope as never).run({ input: { product_variants: fields as never } })

  /* Prices: the base price of one currency, through the Pricing module, leaving every other price as it is. */
  const priced = u.variants.filter((v) => v.price !== undefined)
  if (priced.length > 0) {
    const pricing = (ctx.scope as { resolve<T>(k: string): T }).resolve<IPricingModuleService>(Modules.PRICING)
    const sets = new Map(ctx.catalog.variants.map((v) => [v.id, v.priceSetId]))
    for (const v of priced) {
      const priceSetId = sets.get(v.variantId)
      if (priceSetId) await pricing.addPrices({ priceSetId, prices: [{ amount: v.price as number, currency_code: ctx.currency }] })
      else {
        await updateProductVariantsWorkflow(ctx.scope as never).run({
          input: { product_variants: [{ id: v.variantId, prices: [{ amount: v.price as number, currency_code: ctx.currency }] }] as never },
        })
      }
    }
  }

  /* New variants of a product the import created: the option gets the values first, then the variants. */
  if (u.newVariants.length > 0 && u.option) {
    await updateProductOptionsWorkflow(ctx.scope as never).run({ input: { selector: { id: u.option.id }, update: { values: u.option.values } } as never })
    await createProductVariantsWorkflow(ctx.scope as never).run({
      input: { product_variants: u.newVariants.map((spec) => ({ ...variantInput(spec, u.option?.title ?? null, ctx.currency), product_id: u.productId })) as never },
    })
  }
}

async function applyDraft(ctx: ApplyContext, item: ImportItem): Promise<void> {
  await updateProductsWorkflow(ctx.scope as never).run({ input: { products: [{ id: item.productId as string, status: "draft" }] as never } })
}

/** Links the snapshot rows of created units to the variants Medusa made, by SKU. */
async function linkCreated(ctx: ApplyContext, items: ImportItem[]): Promise<void> {
  const specs = items.flatMap((i) => i.create?.variants ?? [])
  if (specs.length === 0) return
  const { data } = await queryOf(ctx.scope).graph({
    entity: "product_variant",
    fields: ["id", "sku", "product_id", "product.title"],
    filters: { sku: specs.map((s) => s.sku) },
  })
  const bySku = new Map((data as Array<{ id: string; sku: string | null; product_id: string; product?: { title?: string | null } | null }>).map((v) => [normalizeSku(v.sku), v]))
  const rows = (await ctx.svc.listBaseLinkerProducts({ bl_product_id: specs.map((s) => s.blId), demo: false } as never, {
    take: specs.length * 2,
    select: ["id", "bl_product_id"],
  } as never)) as unknown as Array<{ id: string; bl_product_id: string }>
  const rowOf = new Map(rows.map((r) => [r.bl_product_id, r.id]))
  for (const s of specs) {
    const v = bySku.get(normalizeSku(s.sku))
    const rowId = rowOf.get(s.blId)
    if (!v || !rowId) continue
    await ctx.svc.updateBaseLinkerProducts({
      id: rowId,
      variant_id: v.id,
      product_id: v.product_id,
      variant_sku: v.sku,
      product_title: v.product?.title ?? null,
      match_key: normalizeSku(s.sku),
      match_source: "sku",
      conflict: null,
    } as never)
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const APPLICABLE = new Set(["create", "update", "draft"])

export async function runCatalogImportPlan(scope: Scope, input: ImportRunInput): Promise<RunDto | null> {
  return exclusive("catalog_import", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const startedAt = new Date()

    if (!input.read.complete) {
      return recordRun(svc, {
        kind: "catalog_import",
        trigger: input.trigger,
        status: "partial",
        startedAt,
        message: "The BaseLinker read was incomplete, so nothing was planned or imported. The previous plan stays.",
        counts: { skipped: "incomplete_read" },
      })
    }

    let source: ImportSource
    try {
      source = await readSource(svc, input)
    } catch (err) {
      const message = svc.mask(describeError(err).message)
      return recordRun(svc, {
        kind: "catalog_import",
        trigger: input.trigger,
        status: "error",
        startedAt,
        message: `Product details could not be read, so nothing was planned: ${message}`,
      })
    }

    const priceGroupId = o.demo ? Number(DEMO_PRICE_GROUP) : o.priceGroupId
    const groups = buildImportGroups(source.details, { priceGroupId, categories: source.categories, manufacturers: source.manufacturers })
    const knownManufacturers = new Set([...source.manufacturers.values()].map((name) => name.trim().toLowerCase()).filter(Boolean))
    const [catalog, categoryIndex, taxInclusive, { writers }] = await Promise.all([
      loadMedusaCatalog(scope, { currency: o.priceCurrency, manufacturerAs: o.manufacturerAs, knownManufacturers }),
      loadCategoryIndex(scope),
      pricesIncludeTax(scope, o.priceCurrency),
      loadWriters(svc),
    ])
    const plan = planCatalogImport({
      groups,
      complete: true,
      variants: catalog.variants,
      products: catalog.products,
      links: input.links,
      categories: categoryIndex,
      options: {
        taxInclusive,
        priceGroup: priceGroupId !== null,
        createMissingCategories: o.createMissingCategories,
        draftRemoved: o.draftRemovedProducts,
        weightUnit: o.weightUnit,
        optionTitle: o.catalogImportOptionTitle,
      },
    })

    const writer = writerState(writers, "catalogImport")
    const quarantine = await quarantineRows(svc, "catalog_import")
    const held = quarantinedKeys(quarantine)
    const demoState = o.demo ? await loadDemoState(svc) : null
    /* In the simulation an applied item stays applied: the demo catalog itself never changes. */
    const applicable = plan.items.filter((i) => APPLICABLE.has(i.action) && !demoState?.imported[i.key])
    const selection = writer.live
      ? selectForApply(applicable, (i) => i.key, held, o.maxCatalogChangesPerRun)
      : { apply: [] as ImportItem[], overCap: [] as ImportItem[], quarantined: applicable.filter((i) => held.has(i.key)) }

    const outcomes = new Map<string, Outcome>()
    if (selection.apply.length > 0) {
      if (o.demo) {
        /* The simulation: the catalog of the demo store is never written. */
        const at = new Date().toISOString()
        await updateDemoState(svc, (s) => {
          for (const item of selection.apply) s.imported[item.key] = at
        })
        for (const item of selection.apply) {
          outcomes.set(item.key, { ok: true })
          if (demoState) demoState.imported[item.key] = at
        }
      } else {
        const ctx: ApplyContext = {
          scope,
          svc,
          catalog,
          categoryIndex: new Map(categoryIndex),
          salesChannelId: await defaultSalesChannelId(scope, o.catalogImportSalesChannelId),
          shippingProfileId: await defaultShippingProfileId(scope, o.catalogImportShippingProfileId),
          currency: o.priceCurrency,
          knownManufacturers,
        }
        for (const [key, outcome] of await applyCreates(ctx, selection.apply.filter((i) => i.action === "create"))) outcomes.set(key, outcome)
        for (const item of selection.apply.filter((i) => i.action !== "create")) {
          try {
            if (item.action === "update") await applyUpdate(ctx, item)
            else await applyDraft(ctx, item)
            outcomes.set(item.key, { ok: true })
          } catch (err) {
            outcomes.set(item.key, { ok: false, error: describeError(err).message })
          }
        }
        await linkCreated(
          ctx,
          selection.apply.filter((i) => i.action === "create" && outcomes.get(i.key)?.ok),
        ).catch((err: unknown) => svc.getLogger().warn(`[baselinker] import: created products not linked yet: ${svc.mask(describeError(err).message)}`))
      }
    }

    const failures = selection.apply
      .map((i) => ({ item: i, outcome: outcomes.get(i.key) }))
      .filter((x): x is { item: ImportItem; outcome: { ok: false; error: string } } => x.outcome !== undefined && !x.outcome.ok)
    await noteFailures(
      svc,
      "catalog_import",
      failures.map((f) => ({ key: f.item.key, label: f.item.label, error: f.outcome.error })),
      quarantine,
    )
    await noteSuccesses(
      svc,
      selection.apply.filter((i) => outcomes.get(i.key)?.ok).map((i) => i.key),
      quarantine,
    )

    const overCap = new Set(selection.overCap.map((i) => i.key))
    const now = new Date()
    const rows: PlanItemData[] = plan.items.map((i) => {
      const outcome = outcomes.get(i.key)
      const simulated = demoState?.imported[i.key]
      const status = !APPLICABLE.has(i.action)
        ? "info"
        : outcome
          ? outcome.ok
            ? "applied"
            : "failed"
          : held.has(i.key)
            ? "quarantined"
            : overCap.has(i.key)
              ? "over_cap"
              : simulated
                ? "applied"
                : "planned"
      return {
        itemKey: i.key,
        action: i.action,
        status,
        reason: i.reason,
        label: i.label,
        sku: i.sku,
        productId: i.productId,
        variantId: i.variantId,
        blProductId: i.blProductId,
        changes: i.changes,
        error: outcome && !outcome.ok ? outcome.error : null,
        appliedAt: outcome?.ok ? now : simulated ? new Date(simulated) : null,
      }
    })

    const applied = [...outcomes.values()].filter((x) => x.ok).length
    const s = plan.stats
    const mode = writer.live ? "write" : "plan"
    const run = await recordRun(svc, {
      kind: "catalog_import",
      trigger: input.trigger,
      status: failures.length > 0 ? "partial" : selection.overCap.length > 0 ? "partial" : "ok",
      complete: true,
      startedAt,
      counts: { ...s, mode, applied, failed: failures.length, overCap: selection.overCap.length, quarantined: selection.quarantined.length, taxInclusive },
      message:
        mode === "plan"
          ? `Plan only: ${s.create} to create, ${s.update} to update, ${s.draft} to draft, ${s.conflict} conflict(s), ${s.skip} skipped. Nothing written.`
          : `${applied} applied${failures.length > 0 ? `, ${failures.length} failed` : ""}${selection.overCap.length > 0 ? `, ${selection.overCap.length} left for the next run` : ""}.`,
    })
    await replacePlan(svc, "catalog_import", run.id, rows)
    if (applied > 0) {
      await emitEvent(scope, PLUGIN_EVENTS.planApplied, { kind: "catalog_import", applied, failed: failures.length, demo: o.demo })
    }
    svc.getLogger().info(`[baselinker] catalog import ${mode}: create=${s.create} update=${s.update} conflicts=${s.conflict} applied=${applied}`)
    return run
  })
}
