/**
 * PRODUCTS AND PRICES FROM SUBIEKT, PLANNED. Pure: the input is the complete
 * `/v1/products` read and the Medusa variants with their current prices, the
 * output is what would change, from what to what. Nothing here writes; the
 * writer applies a stored plan, and only when a person armed it.
 *
 * MATCHING. EAN first (any of the variant's EAN, barcode, UPC), then the SKU
 * against the product symbol, case-insensitive. Unlike stock, SKU suffixes are
 * NOT stripped for prices: a `-WH` wholesale variant matched through its retail
 * product would get the retail price. Such a variant stays unmatched here and
 * keeps its price.
 *
 * AMBIGUITY IS NEVER GUESSED. One EAN on two Subiekt products is a conflict:
 * it matches nothing by EAN (the SKU may still match). A level whose currency is
 * not the configured one plans nothing at all.
 *
 * MISSING PRODUCTS. A Subiekt product nothing in Medusa matches becomes a
 * creation candidate when it is meant for the online shop (`active`), has a
 * price in the level and is not a kit (a kit needs its components in Medusa).
 */

import type { PriceLevel, ProductItem } from "./contract"
import { normalizeEan } from "./order-payload"
import { round } from "./numbers"

export interface CatalogPrice {
  id: string
  amount: number
  currency: string
  priceListId: string | null
  rulesCount: number
  minQuantity?: number | null
  maxQuantity?: number | null
}

export interface CatalogVariant {
  id: string
  productId: string
  sku: string | null
  /** EAN, barcode, UPC: whatever the variant has. */
  codes: Array<string | null | undefined>
  title: string | null
  productTitle: string | null
  prices: CatalogPrice[]
}

export interface CatalogPlanOptions {
  target: "variant" | "price_list"
  priceListId: string | null
  /** Symbol or name of the Subiekt price level; empty: the first level the bridge publishes. */
  level: string
  type: "gross" | "net"
  /** Lowercase ISO 4217, for example `pln`. */
  currency: string
  sampleSize?: number
}

export interface PlannedPrice {
  kind: "price"
  symbol: string
  sku: string | null
  ean: string | null
  title: string | null
  variantId: string
  productId: string
  currency: string
  from: number | null
  to: number
  level: string
  matchedBy: "ean" | "sku"
  /** The price row that changes, null when the variant has none in this currency yet. */
  priceId: string | null
}

export interface PlannedCreate {
  kind: "create"
  symbol: string
  ean: string | null
  title: string
  currency: string
  to: number
  level: string
  unit: string | null
  vatRate: number | null
  weightKg: number | null
  manageInventory: boolean
}

export interface CatalogPlan {
  level: PriceLevel | null
  prices: PlannedPrice[]
  creates: PlannedCreate[]
  stats: {
    subiektProducts: number
    variants: number
    matched: number
    matchedByEan: number
    matchedBySku: number
    priceChanges: number
    unchanged: number
    toCreate: number
    conflicts: number
    unmatchedVariants: number
    noPrice: number
    skippedKits: number
    inactive: number
  }
  /** Why nothing was planned, when nothing could be. */
  blocked: null | "no_level" | "currency_mismatch"
  samples: {
    conflicts: string[]
    unmatchedVariants: string[]
    noPrice: string[]
  }
}

const key = (s: string) => s.trim().toUpperCase()

/** The configured price level: by symbol, then by name, case-insensitive; the first one when none is configured. */
export function resolvePriceLevel(levels: readonly PriceLevel[], wanted: string): PriceLevel | null {
  const w = wanted.trim().toLowerCase()
  if (!w) return levels[0] ?? null
  return levels.find((l) => l.symbol.toLowerCase() === w) ?? levels.find((l) => (l.name ?? "").toLowerCase() === w) ?? null
}

/** The price the target holds now for this variant, or null. */
export function currentPrice(variant: CatalogVariant, options: Pick<CatalogPlanOptions, "target" | "priceListId" | "currency">): CatalogPrice | null {
  const currency = options.currency.toLowerCase()
  const candidates = variant.prices.filter((p) => p.currency.toLowerCase() === currency)
  if (options.target === "price_list") return candidates.find((p) => p.priceListId === options.priceListId) ?? null
  return (
    candidates.find((p) => !p.priceListId && (p.rulesCount ?? 0) === 0 && (p.minQuantity ?? null) === null && (p.maxQuantity ?? null) === null) ??
    null
  )
}

export function planCatalog(products: readonly ProductItem[], variants: readonly CatalogVariant[], options: CatalogPlanOptions, levels: readonly PriceLevel[]): CatalogPlan {
  const sample = options.sampleSize ?? 20
  const stats: CatalogPlan["stats"] = {
    subiektProducts: products.length,
    variants: variants.length,
    matched: 0,
    matchedByEan: 0,
    matchedBySku: 0,
    priceChanges: 0,
    unchanged: 0,
    toCreate: 0,
    conflicts: 0,
    unmatchedVariants: 0,
    noPrice: 0,
    skippedKits: 0,
    inactive: 0,
  }
  const samples: CatalogPlan["samples"] = { conflicts: [], unmatchedVariants: [], noPrice: [] }
  const empty = (blocked: CatalogPlan["blocked"], level: PriceLevel | null): CatalogPlan => ({ level, prices: [], creates: [], stats, blocked, samples })

  const level = resolvePriceLevel(levels, options.level)
  if (!level) return empty("no_level", null)
  if (level.currency && level.currency.toLowerCase() !== options.currency.toLowerCase()) return empty("currency_mismatch", level)

  /* Index Subiekt products. A duplicated key is unusable for matching. */
  const byEan = new Map<string, ProductItem | null>()
  const bySymbol = new Map<string, ProductItem | null>()
  for (const p of products) {
    const ean = normalizeEan(p.ean)
    if (ean) {
      if (byEan.has(ean)) {
        if (byEan.get(ean) !== null) {
          stats.conflicts += 1
          if (samples.conflicts.length < sample) samples.conflicts.push(`EAN ${ean}`)
        }
        byEan.set(ean, null)
      } else byEan.set(ean, p)
    }
    const symbol = p.symbol?.trim()
    if (symbol) {
      const k = key(symbol)
      if (bySymbol.has(k)) {
        if (bySymbol.get(k) !== null) {
          stats.conflicts += 1
          if (samples.conflicts.length < sample) samples.conflicts.push(`Symbol ${symbol}`)
        }
        bySymbol.set(k, null)
      } else bySymbol.set(k, p)
    }
  }

  const priceOf = (p: ProductItem): number | null => {
    const entry = p.prices.find((x) => x.level === level.symbol)
    if (!entry) return null
    const value = options.type === "net" ? entry.net : entry.gross
    return Number.isFinite(value) && value >= 0 ? round(value, 2) : null
  }

  const prices: PlannedPrice[] = []
  const used = new Set<string>()
  for (const v of variants) {
    let product: ProductItem | null = null
    let matchedBy: "ean" | "sku" = "ean"
    for (const code of v.codes) {
      const ean = normalizeEan(code)
      if (ean && byEan.get(ean)) {
        product = byEan.get(ean) ?? null
        break
      }
    }
    if (!product && v.sku) {
      product = bySymbol.get(key(v.sku)) ?? null
      matchedBy = "sku"
    }
    if (!product) {
      stats.unmatchedVariants += 1
      if (v.sku && samples.unmatchedVariants.length < sample) samples.unmatchedVariants.push(v.sku)
      continue
    }
    used.add(key(product.symbol))
    stats.matched += 1
    if (matchedBy === "ean") stats.matchedByEan += 1
    else stats.matchedBySku += 1

    const to = priceOf(product)
    if (to === null) {
      stats.noPrice += 1
      if (samples.noPrice.length < sample) samples.noPrice.push(product.symbol)
      continue
    }
    const current = currentPrice(v, options)
    if (current && round(current.amount, 2) === to) {
      stats.unchanged += 1
      continue
    }
    prices.push({
      kind: "price",
      symbol: product.symbol,
      sku: v.sku,
      ean: normalizeEan(product.ean),
      title: [v.productTitle, v.title].filter(Boolean).join(" ") || product.name || null,
      variantId: v.id,
      productId: v.productId,
      currency: options.currency.toLowerCase(),
      from: current ? round(current.amount, 2) : null,
      to,
      level: level.symbol,
      matchedBy,
      priceId: current?.id ?? null,
    })
  }

  /* Subiekt products nothing in Medusa matched: creation candidates. */
  const medusaEans = new Set(variants.flatMap((v) => v.codes.map((c) => normalizeEan(c)).filter((c): c is string => Boolean(c))))
  const medusaSkus = new Set(variants.map((v) => (v.sku ? key(v.sku) : "")).filter(Boolean))
  const creates: PlannedCreate[] = []
  for (const p of products) {
    const ean = normalizeEan(p.ean)
    if (used.has(key(p.symbol)) || medusaSkus.has(key(p.symbol)) || (ean && medusaEans.has(ean))) continue
    if (!p.active) {
      stats.inactive += 1
      continue
    }
    if (p.kind === "kit") {
      stats.skippedKits += 1
      continue
    }
    if (ean && byEan.get(ean) === null) continue
    const to = priceOf(p)
    if (to === null) {
      stats.noPrice += 1
      if (samples.noPrice.length < sample) samples.noPrice.push(p.symbol)
      continue
    }
    creates.push({
      kind: "create",
      symbol: p.symbol,
      ean,
      title: p.name?.trim() || p.symbol,
      currency: options.currency.toLowerCase(),
      to,
      level: level.symbol,
      unit: p.unit ?? null,
      vatRate: typeof p.vat_rate === "number" ? p.vat_rate : null,
      weightKg: typeof p.weight_kg === "number" ? p.weight_kg : null,
      manageInventory: p.kind !== "service",
    })
  }

  prices.sort((a, b) => a.symbol.localeCompare(b.symbol))
  creates.sort((a, b) => a.symbol.localeCompare(b.symbol))
  stats.priceChanges = prices.length
  stats.toCreate = creates.length
  return { level, prices, creates, stats, blocked: null, samples }
}

/** Medusa keeps weight without a unit; this plugin writes grams, the common convention of shipping integrations. */
export function gramsFromKg(kg: number | null): number | undefined {
  return typeof kg === "number" && Number.isFinite(kg) && kg > 0 ? Math.round(kg * 1000) : undefined
}

/** A handle Medusa accepts: lowercase ASCII, digits and dashes. Polish letters are transliterated. */
export function handleFor(title: string, symbol: string): string {
  const map: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" }
  const base = `${title} ${symbol}`
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => map[c] ?? c)
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base.slice(0, 120) || `subiekt-${symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

export type ApplyOutcome = "applied" | "stale" | "failed"

/** Quarantine bookkeeping: a failure counts up, a success clears; past the limit the item waits for a person. */
export function nextQuarantine(failures: number, outcome: ApplyOutcome, limit: number): { failures: number; quarantined: boolean } {
  if (outcome === "applied") return { failures: 0, quarantined: false }
  if (outcome === "stale") return { failures, quarantined: failures >= limit }
  const next = failures + 1
  return { failures: next, quarantined: next >= limit }
}
