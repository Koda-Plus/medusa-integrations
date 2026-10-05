/**
 * CATALOG IMPORT PLAN: BASELINKER PRODUCTS INTO MEDUSA. Pure; the only
 * imports are other pure files of this folder.
 *
 * For stores whose catalog lives in BaseLinker (`catalogSource: "baselinker"`).
 * The plan says, product by product, what an armed writer would do in
 * Medusa: create the product with its variants, update fields one by one
 * (from what, to what), turn a product removed in BaseLinker into a draft,
 * or leave it alone, with the reason. Nothing is ever deleted.
 *
 * WHY SO CAREFUL. At a tyre retailer with about 11 000 cards, 4 438 SKU pairs
 * turned out to be the same physical item entered twice. Importing blindly
 * would have made two products of one tyre, with two stocks and two prices.
 * So a SKU or an EAN that appears on more than one sellable card is a
 * conflict: reported, never imported, until a person merges the cards.
 *
 * IDEMPOTENT. A product is matched to Medusa by the card links (SKU, then
 * EAN) and by SKU; a product the import created also carries its BaseLinker
 * id in `metadata.baselinker_product_id`. Medusa refuses a second variant
 * with the same SKU, so even a crash between creating a product and storing
 * the link cannot make a duplicate: the next run finds it by SKU.
 *
 * WHAT IS SKIPPED, with the reason in the plan: bundles (kits), products with
 * a variant without a SKU, units whose SKU or EAN is duplicated, a SKU used
 * by two Medusa variants, a BaseLinker product whose variants sit on
 * different Medusa products. An incomplete read plans nothing at all.
 */

import type { ProductDetails } from "./catalog"
import type { PlanChange } from "./contract"
import { normalizeEan, normalizeSku } from "./matching"
import { round } from "./numbers"

export type ImportAction = "create" | "update" | "draft" | "skip" | "conflict"

export type ImportReason =
  | "bundle"
  | "no_sku"
  | "duplicate_sku"
  | "duplicate_ean"
  | "ambiguous_variant"
  | "split_product"
  | "removed_in_baselinker"
  | "new_variant_needs_options"
  | "category_missing"

/** One sellable unit of a BaseLinker product: the product itself, or one of its variants. */
export interface ImportUnit {
  blId: string
  sku: string | null
  ean: string | null
  /** Variant name, or the product name for a product without variants. */
  name: string
  /** Gross price in the configured price group, or null. */
  price: number | null
}

/** One BaseLinker main product, with what the import needs. */
export interface ImportGroup {
  blId: string
  name: string
  description: string | null
  images: string[]
  weightKg: number | null
  /** Category name in BaseLinker, already resolved from its id. */
  category: string | null
  /** Manufacturer name, already resolved from its id. */
  manufacturer: string | null
  isBundle: boolean
  hasVariants: boolean
  /** VAT rate of the BaseLinker product (special values are below zero), or null. */
  taxRate: number | null
  units: ImportUnit[]
}

export interface MedusaVariantLite {
  id: string
  productId: string
  sku: string | null
  ean: string | null
  title: string | null
  weight: number | null
  /** Base price (no rules, no price list) in the configured currency, major units. */
  price: number | null
}

export interface MedusaProductLite {
  id: string
  title: string
  handle: string | null
  description: string | null
  status: string
  images: string[]
  categoryIds: string[]
  categoryNames: string[]
  /**
   * Manufacturer as the store keeps it (metadata or a tag, per the option).
   * With tags: the tag that names a BaseLinker manufacturer, never just any tag.
   */
  manufacturer: string | null
  /** The product's tags, so a manufacturer change replaces only the manufacturer tag. */
  tags?: Array<{ id: string; value: string }>
  /** `metadata.baselinker_product_id`: set on products the import created. */
  blProductId: string | null
  options: Array<{ id: string; title: string; values: string[] }>
}

export interface ImportOptions {
  /**
   * Medusa prices of the currency include tax. BaseLinker prices are gross:
   * for net prices the gross price is divided by the product's VAT rate, and
   * a product without a rate gets no price change at all (never guessed).
   */
  taxInclusive: boolean
  /** A price group is configured, so prices can be compared at all. */
  priceGroup: boolean
  createMissingCategories: boolean
  draftRemoved: boolean
  weightUnit: "g" | "kg"
  optionTitle: string
}

export interface ImportPlanInput {
  groups: readonly ImportGroup[]
  /** Whether the BaseLinker read (list and details) was complete. */
  complete: boolean
  variants: readonly MedusaVariantLite[]
  products: readonly MedusaProductLite[]
  /** BaseLinker unit id to Medusa variant id, from the card links. */
  links: ReadonlyMap<string, string>
  /** Medusa categories by lowercased name. */
  categories: ReadonlyMap<string, string>
  options: ImportOptions
}

export interface ImportVariantSpec {
  blId: string
  title: string
  sku: string
  ean: string | null
  weight: number | null
  price: number | null
  /** Value of the import option (products with several variants), or null. */
  optionValue: string | null
}

export interface ImportCreate {
  title: string
  handle: string
  description: string | null
  images: string[]
  category: { id: string | null; name: string } | null
  manufacturer: string | null
  /** Option title for products with several variants; null for one variant. */
  optionTitle: string | null
  variants: ImportVariantSpec[]
}

export interface ImportUpdate {
  productId: string
  title?: string
  description?: string
  images?: string[]
  /** Category to add, by id, or by name when it must be created first. */
  category?: { id: string | null; name: string; keep: string[] }
  manufacturer?: string
  variants: Array<{ variantId: string; title?: string; ean?: string; weight?: number; price?: number }>
  /** New BaseLinker variants of a product the import created: the option gets the new values first. */
  newVariants: ImportVariantSpec[]
  option: { id: string; title: string; values: string[] } | null
}

export interface ImportItem {
  /** `bl:<main product id>`, or `medusa:<product id>` for a product removed in BaseLinker. */
  key: string
  action: ImportAction
  reason: ImportReason | null
  label: string
  sku: string | null
  blProductId: string | null
  productId: string | null
  variantId: string | null
  changes: PlanChange[]
  create?: ImportCreate
  update?: ImportUpdate
}

export interface ImportPlanStats {
  groups: number
  units: number
  create: number
  update: number
  draft: number
  unchanged: number
  skip: number
  conflict: number
  bundles: number
  noSku: number
  duplicateSku: number
  duplicateEan: number
  ambiguous: number
  split: number
  removed: number
  /** Prices left out entirely: no price group is set. */
  pricesSkipped: null | "no_price_group"
  /** Products whose price was left out: Medusa keeps net prices and BaseLinker has no VAT rate for them. */
  netWithoutRate: number
}

export interface ImportPlan {
  skipped: null | "incomplete_read"
  /** Applicable items first (update, create, draft), then skips and conflicts. */
  items: ImportItem[]
  stats: ImportPlanStats
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const POLISH: Record<string, string> = { ł: "l", Ł: "l", ß: "ss", æ: "ae", ø: "o" }

/** URL handle: ASCII, lowercase, dashes, at most 60 characters. */
export function slugify(text: string): string {
  const ascii = text
    .replace(/[łŁßæø]/g, (c) => POLISH[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
  return ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "") || "product"
}

/**
 * With `manufacturerAs: "tag"`, the manufacturer of a product is the tag that
 * names one of `knownManufacturers` (BaseLinker's list, lowercased): never just
 * the first tag, so a tag like "sale" is not mistaken for a manufacturer.
 */
export function tagManufacturer(tags: ReadonlyArray<{ value: string }>, knownManufacturers: ReadonlySet<string> | undefined): string | null {
  if (!knownManufacturers || knownManufacturers.size === 0) return null
  return tags.find((t) => knownManufacturers.has(t.value.trim().toLowerCase()))?.value ?? null
}

/**
 * Tags after a manufacturer change: every tag of the product stays, except
 * one naming another BaseLinker manufacturer; the new manufacturer's tag is
 * added. A store's own tags ("sale", "summer") are never dropped.
 */
export function manufacturerTagIds(current: ReadonlyArray<{ id: string; value: string }>, knownManufacturers: ReadonlySet<string>, newTagId: string): string[] {
  const kept = current.filter((t) => !knownManufacturers.has(t.value.trim().toLowerCase())).map((t) => t.id)
  return [...new Set([...kept, newTagId])]
}

/** BaseLinker kilograms in the unit of Medusa weights. */
export function toMedusaWeight(kg: number | null, unit: "g" | "kg"): number | null {
  if (kg === null || !Number.isFinite(kg) || kg <= 0) return null
  return unit === "g" ? Math.round(kg * 1000) : Math.round(kg * 1000) / 1000
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").replace(/\s+/g, " ").trim() === (b ?? "").replace(/\s+/g, " ").trim()
}

function samePrice(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 0.005
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function emptyStats(): ImportPlanStats {
  return {
    groups: 0,
    units: 0,
    create: 0,
    update: 0,
    draft: 0,
    unchanged: 0,
    skip: 0,
    conflict: 0,
    bundles: 0,
    noSku: 0,
    duplicateSku: 0,
    duplicateEan: 0,
    ambiguous: 0,
    split: 0,
    removed: 0,
    pricesSkipped: null,
    netWithoutRate: 0,
  }
}

/** BaseLinker VAT rate as a percentage: the special values (exempt, NP, reverse charge) are below zero and count as 0 %. */
export function vatPercent(rate: number | null): number | null {
  if (rate === null || !Number.isFinite(rate)) return null
  return rate < 0 ? 0 : rate
}

/** A BaseLinker gross price as Medusa keeps it: as is for tax-inclusive prices, net otherwise. */
export function toMedusaPrice(gross: number | null, rate: number | null, taxInclusive: boolean): number | null {
  if (gross === null || !Number.isFinite(gross)) return null
  if (taxInclusive) return round(gross, 2)
  const pct = vatPercent(rate)
  return pct === null ? null : round(gross / (1 + pct / 100), 2)
}

/** A Medusa price as BaseLinker keeps it (gross). */
export function toBaseLinkerPrice(amount: number | null, rate: number | null, taxInclusive: boolean): number | null {
  if (amount === null || !Number.isFinite(amount)) return null
  if (taxInclusive) return round(amount, 2)
  const pct = vatPercent(rate)
  return pct === null ? null : round(amount * (1 + pct / 100), 2)
}

/**
 * Main products of `getInventoryProductsData` into import groups: a product
 * with variants sells its variants, a product without them sells itself.
 * Variants (`parent_id` set) are only read through their main product.
 */
export function buildImportGroups(
  details: readonly ProductDetails[],
  opts: {
    priceGroupId: number | null
    categories: ReadonlyMap<number, { name: string }>
    manufacturers: ReadonlyMap<number, string>
  },
): ImportGroup[] {
  const group = opts.priceGroupId !== null ? String(opts.priceGroupId) : null
  const price = (prices: Record<string, number> | null) => (group && prices && typeof prices[group] === "number" ? prices[group] : null)
  return details
    .filter((d) => !d.parentId)
    .map((d) => ({
      blId: d.blProductId,
      name: d.name,
      description: d.description,
      images: d.images,
      weightKg: d.weightKg,
      category: d.categoryId !== null ? opts.categories.get(d.categoryId)?.name ?? null : null,
      manufacturer: d.manufacturerId !== null ? opts.manufacturers.get(d.manufacturerId) ?? null : null,
      isBundle: d.isBundle,
      hasVariants: d.variants.length > 0,
      taxRate: d.taxRate,
      units:
        d.variants.length > 0
          ? d.variants.map((v) => ({ blId: v.blProductId, sku: v.sku, ean: v.ean, name: v.name, price: price(v.prices) }))
          : [{ blId: d.blProductId, sku: d.sku, ean: d.ean, name: d.name, price: price(d.prices) }],
    }))
}

/** Option values of one product must be unique and not empty; a clash gets the SKU appended. */
function optionValues(units: readonly ImportUnit[]): string[] {
  const seen = new Set<string>()
  return units.map((u) => {
    let value = (u.name || "").trim().slice(0, 100) || (u.sku ?? u.blId)
    if (seen.has(value.toLowerCase())) value = `${value} (${u.sku ?? u.blId})`
    seen.add(value.toLowerCase())
    return value
  })
}

/* ------------------------------------------------------------------ */
/* Planner                                                             */
/* ------------------------------------------------------------------ */

export function planCatalogImport(input: ImportPlanInput): ImportPlan {
  const stats = emptyStats()
  if (!input.complete) return { skipped: "incomplete_read", items: [], stats }
  const o = input.options
  stats.pricesSkipped = !o.priceGroup ? "no_price_group" : null

  /* Duplicates among the sellable units of the whole read. */
  const skuCount = new Map<string, number>()
  const eanCount = new Map<string, number>()
  for (const g of input.groups) {
    for (const u of g.units) {
      const sku = normalizeSku(u.sku)
      const ean = normalizeEan(u.ean)
      if (sku) skuCount.set(sku, (skuCount.get(sku) ?? 0) + 1)
      if (ean) eanCount.set(ean, (eanCount.get(ean) ?? 0) + 1)
    }
  }

  /* Medusa side. */
  const variants = new Map(input.variants.map((v) => [v.id, v]))
  const products = new Map(input.products.map((p) => [p.id, p]))
  const bySku = new Map<string, MedusaVariantLite[]>()
  for (const v of input.variants) {
    const sku = normalizeSku(v.sku)
    if (!sku) continue
    const list = bySku.get(sku)
    if (list) list.push(v)
    else bySku.set(sku, [v])
  }
  const handles = new Set(input.products.map((p) => (p.handle ?? "").toLowerCase()).filter(Boolean))

  const applicable: ImportItem[] = []
  const info: ImportItem[] = []
  const seenGroups = new Set<string>()

  for (const g of input.groups) {
    stats.groups += 1
    stats.units += g.units.length
    seenGroups.add(g.blId)
    const firstSku = g.units.find((u) => u.sku)?.sku ?? null
    const base = { key: `bl:${g.blId}`, label: g.name || firstSku || g.blId, sku: firstSku, blProductId: g.blId, productId: null, variantId: null, changes: [] as PlanChange[] }

    if (g.isBundle) {
      stats.bundles += 1
      stats.skip += 1
      info.push({ ...base, action: "skip", reason: "bundle" })
      continue
    }
    if (g.units.length === 0 || g.units.some((u) => !normalizeSku(u.sku))) {
      stats.noSku += 1
      stats.skip += 1
      info.push({ ...base, action: "skip", reason: "no_sku" })
      continue
    }
    const dupSku = g.units.find((u) => (skuCount.get(normalizeSku(u.sku) as string) ?? 0) > 1)
    if (dupSku) {
      stats.duplicateSku += 1
      stats.conflict += 1
      info.push({ ...base, action: "conflict", reason: "duplicate_sku", sku: dupSku.sku, changes: [{ field: "sku", from: dupSku.sku, to: null }] })
      continue
    }
    const dupEan = g.units.find((u) => {
      const ean = normalizeEan(u.ean)
      return ean !== null && (eanCount.get(ean) ?? 0) > 1
    })
    if (dupEan) {
      stats.duplicateEan += 1
      stats.conflict += 1
      info.push({ ...base, action: "conflict", reason: "duplicate_ean", changes: [{ field: "ean", from: normalizeEan(dupEan.ean), to: null }] })
      continue
    }

    /* Which Medusa variant each unit is: the card link first, then the SKU. */
    let ambiguous = false
    const matched = new Map<string, MedusaVariantLite>()
    for (const u of g.units) {
      const linked = input.links.get(u.blId)
      if (linked && variants.has(linked)) {
        matched.set(u.blId, variants.get(linked) as MedusaVariantLite)
        continue
      }
      const found = bySku.get(normalizeSku(u.sku) as string) ?? []
      if (found.length > 1) ambiguous = true
      else if (found.length === 1) matched.set(u.blId, found[0])
    }
    if (ambiguous) {
      stats.ambiguous += 1
      stats.conflict += 1
      info.push({ ...base, action: "conflict", reason: "ambiguous_variant" })
      continue
    }
    const productIds = new Set([...matched.values()].map((v) => v.productId))
    if (productIds.size > 1) {
      stats.split += 1
      stats.conflict += 1
      info.push({ ...base, action: "conflict", reason: "split_product", changes: [...productIds].map((id) => ({ field: "product", from: id, to: null })) })
      continue
    }

    const weight = toMedusaWeight(g.weightKg, o.weightUnit)
    /* Prices: gross as is for tax-inclusive Medusa prices, net through the VAT rate otherwise, never guessed. */
    const rateKnown = o.taxInclusive || vatPercent(g.taxRate) !== null
    const pricesOk = o.priceGroup && rateKnown
    if (o.priceGroup && !rateKnown) stats.netWithoutRate += 1
    const priceOf = (u: ImportUnit): number | null => (pricesOk ? toMedusaPrice(u.price, g.taxRate, o.taxInclusive) : null)
    const categoryId = g.category ? input.categories.get(g.category.trim().toLowerCase()) ?? null : null
    const categoryWanted = g.category && (categoryId || o.createMissingCategories) ? { id: categoryId, name: g.category.trim() } : null

    /* ---- Create ------------------------------------------------------ */
    if (productIds.size === 0) {
      let handle = slugify(g.name || firstSku || g.blId)
      if (handles.has(handle)) handle = `${handle.slice(0, 48)}-${g.blId}`.slice(0, 60)
      handles.add(handle)
      const values = g.hasVariants ? optionValues(g.units) : []
      const specs: ImportVariantSpec[] = g.units.map((u, i) => ({
        blId: u.blId,
        title: g.hasVariants ? values[i] : g.name || (u.sku as string),
        sku: (u.sku as string).trim(),
        ean: normalizeEan(u.ean),
        weight,
        price: priceOf(u),
        optionValue: g.hasVariants ? values[i] : null,
      }))
      const changes: PlanChange[] = [
        { field: "title", from: null, to: g.name },
        { field: "variants", from: null, to: specs.length },
      ]
      if (pricesOk && specs.some((s) => s.price !== null)) changes.push({ field: "price", from: null, to: specs.find((s) => s.price !== null)?.price ?? null })
      if (g.images.length > 0) changes.push({ field: "images", from: null, to: g.images.length })
      if (categoryWanted) changes.push({ field: categoryWanted.id ? "category" : "category_new", from: null, to: categoryWanted.name })
      if (g.manufacturer) changes.push({ field: "manufacturer", from: null, to: g.manufacturer })
      stats.create += 1
      applicable.push({
        ...base,
        action: "create",
        reason: g.category && !categoryWanted ? "category_missing" : null,
        changes,
        create: {
          title: g.name || (firstSku as string),
          handle,
          description: g.description,
          images: g.images,
          category: categoryWanted,
          manufacturer: g.manufacturer,
          optionTitle: g.hasVariants ? o.optionTitle : null,
          variants: specs,
        },
      })
      continue
    }

    /* ---- Update ------------------------------------------------------ */
    const productId = [...productIds][0]
    const product = products.get(productId)
    if (!product) {
      /* A linked variant whose product the read of Medusa did not return: plan nothing for it. */
      continue
    }
    const changes: PlanChange[] = []
    const update: ImportUpdate = { productId, variants: [], newVariants: [], option: null }
    if (g.name && !same(g.name, product.title)) {
      changes.push({ field: "title", from: product.title, to: g.name })
      update.title = g.name
    }
    if (g.description && !same(g.description, product.description)) {
      changes.push({ field: "description", from: product.description ? product.description.slice(0, 80) : null, to: g.description.slice(0, 80) })
      update.description = g.description
    }
    if (g.images.length > 0 && !sameList(g.images, product.images)) {
      changes.push({ field: "images", from: product.images.length, to: g.images.length })
      update.images = g.images
    }
    if (categoryWanted && !product.categoryNames.some((n) => same(n.toLowerCase(), categoryWanted.name.toLowerCase()))) {
      changes.push({ field: categoryWanted.id ? "category" : "category_new", from: product.categoryNames[0] ?? null, to: categoryWanted.name })
      update.category = { ...categoryWanted, keep: product.categoryIds }
    }
    if (g.manufacturer && !same(g.manufacturer, product.manufacturer)) {
      changes.push({ field: "manufacturer", from: product.manufacturer, to: g.manufacturer })
      update.manufacturer = g.manufacturer
    }

    const values = g.hasVariants ? optionValues(g.units) : []
    const unmatched: Array<{ unit: ImportUnit; value: string }> = []
    g.units.forEach((u, i) => {
      const v = matched.get(u.blId)
      if (!v) {
        unmatched.push({ unit: u, value: values[i] ?? u.name })
        return
      }
      const patch: ImportUpdate["variants"][number] = { variantId: v.id }
      const label = v.sku ?? v.id
      if (g.hasVariants && values[i] && !same(values[i], v.title)) {
        changes.push({ field: `variant_title:${label}`, from: v.title, to: values[i] })
        patch.title = values[i]
      }
      const ean = normalizeEan(u.ean)
      if (ean && ean !== normalizeEan(v.ean)) {
        changes.push({ field: `ean:${label}`, from: v.ean, to: ean })
        patch.ean = ean
      }
      if (weight !== null && (v.weight === null || Math.abs(v.weight - weight) > (o.weightUnit === "g" ? 0.5 : 0.0005))) {
        changes.push({ field: `weight:${label}`, from: v.weight, to: weight })
        patch.weight = weight
      }
      const price = priceOf(u)
      if (price !== null && !samePrice(price, v.price)) {
        changes.push({ field: `price:${label}`, from: v.price, to: price })
        patch.price = price
      }
      if (Object.keys(patch).length > 1) update.variants.push(patch)
    })

    let reason: ImportReason | null = g.category && !categoryWanted ? "category_missing" : null
    if (unmatched.length > 0) {
      const ours = product.blProductId === g.blId
      const option = ours && product.options.length === 1 && product.options[0].title === o.optionTitle ? product.options[0] : null
      if (option) {
        const all = [...option.values]
        for (const { unit, value } of unmatched) {
          const spec: ImportVariantSpec = {
            blId: unit.blId,
            title: value,
            sku: (unit.sku as string).trim(),
            ean: normalizeEan(unit.ean),
            weight,
            price: priceOf(unit),
            optionValue: value,
          }
          if (!all.includes(value)) all.push(value)
          update.newVariants.push(spec)
          changes.push({ field: `variant_new:${spec.sku}`, from: null, to: value })
        }
        update.option = { id: option.id, title: option.title, values: all }
      } else {
        reason = "new_variant_needs_options"
      }
    }

    if (changes.length === 0) {
      if (reason === "new_variant_needs_options") {
        stats.skip += 1
        info.push({ ...base, action: "skip", reason, productId })
      } else stats.unchanged += 1
      continue
    }
    stats.update += 1
    applicable.push({
      ...base,
      action: "update",
      reason,
      productId,
      variantId: g.hasVariants ? null : matched.get(g.units[0].blId)?.id ?? null,
      changes,
      update,
    })
  }

  /* ---- Removed in BaseLinker ----------------------------------------- */
  for (const p of input.products) {
    if (!p.blProductId || seenGroups.has(p.blProductId)) continue
    if (p.status === "draft") continue
    stats.removed += 1
    const item: ImportItem = {
      key: `medusa:${p.id}`,
      action: o.draftRemoved ? "draft" : "skip",
      reason: "removed_in_baselinker",
      label: p.title,
      sku: null,
      blProductId: p.blProductId,
      productId: p.id,
      variantId: null,
      changes: o.draftRemoved ? [{ field: "status", from: p.status, to: "draft" }] : [],
    }
    if (o.draftRemoved) {
      stats.draft += 1
      applicable.push(item)
    } else {
      stats.skip += 1
      info.push(item)
    }
  }

  /* Updates first (they fix what customers see now), then creates, then drafts. */
  const rank = (a: ImportAction) => (a === "update" ? 0 : a === "create" ? 1 : 2)
  applicable.sort((a, b) => rank(a.action) - rank(b.action) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return { skipped: null, items: [...applicable, ...info], stats }
}
