/**
 * LINKING BASELINKER CARDS TO MEDUSA VARIANTS. Pure, zero imports.
 *
 * The catalog lives in Medusa. BaseLinker already has its own cards for the
 * same goods (they feed Allegro, Amazon, the warehouse). We never create or
 * change either side: we LINK an existing variant to an existing card.
 *
 * KEYS. SKU first, uppercased and trimmed on both sides, because `wz-138 xd`
 * and `WZ-138 XD` are the same item typed by different people. Then the EAN,
 * digits only, 8 to 14 of them. Never by name.
 *
 * UNIQUE ON BOTH SIDES OR NOT AT ALL. Measured on a production account: 12 993
 * cards carried 8 522 distinct SKUs, so one SKU often sits on two cards (the
 * same goods entered twice, or two physical items). Linking such a SKU to
 * "the first card" would send stock and orders to a random copy. So:
 *
 *   duplicate_sku      the SKU sits on 2+ BaseLinker cards: reported, never linked
 *   duplicate_ean      the EAN sits on 2+ cards (and the SKU did not link): reported
 *   ambiguous_variant  2+ Medusa variants share the key: reported, never linked
 *
 * A variant is linked to at most one card. A SKU link wins over an EAN link.
 */

export type MatchSource = "sku" | "ean"
export type CardConflict = "duplicate_sku" | "duplicate_ean" | "ambiguous_variant"

export interface MatchableCard {
  blProductId: string
  sku: string | null
  ean: string | null
}

export interface CatalogVariant {
  id: string
  productId: string
  sku: string | null
  /** EAN, barcode and UPC of the variant, whichever are set. */
  codes: ReadonlyArray<string | null | undefined>
  productTitle: string | null
}

export interface CardMatch {
  blProductId: string
  /** The key the card was looked up by (or linked by). */
  key: string | null
  source: MatchSource | null
  variant: CatalogVariant | null
  conflict: CardConflict | null
}

export interface MatchSummary {
  cards: number
  linked: number
  linkedBySku: number
  linkedByEan: number
  /** Cards without a variant and without a conflict: "only in BaseLinker". */
  unmatched: number
  conflicts: number
  duplicateSku: number
  duplicateEan: number
  ambiguousVariant: number
  /** Cards without a SKU (they may still link by EAN). */
  noSku: number
  /** Variants with a SKU that no BaseLinker card carries, by SKU or by EAN. */
  onlyInMedusa: number
  onlyInMedusaSkus: string[]
  duplicateSkus: string[]
}

export function normalizeSku(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const key = String(value).trim().toUpperCase()
  return key.length > 0 ? key : null
}

/** Digits only, 8 to 14 of them (EAN-8, UPC-A, EAN-13, GTIN-14). Anything else is not a barcode. */
export function normalizeEan(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const digits = String(value).trim().replace(/[\s-]/g, "")
  return /^\d{8,14}$/.test(digits) ? digits : null
}

function addTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) {
    if (!list.includes(value)) list.push(value)
  } else map.set(key, [value])
}

function count(map: Map<string, number>, key: string | null): void {
  if (key) map.set(key, (map.get(key) ?? 0) + 1)
}

function compareIds(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

export function variantEans(v: CatalogVariant): string[] {
  const out: string[] = []
  for (const c of v.codes) {
    const ean = normalizeEan(c)
    if (ean && !out.includes(ean)) out.push(ean)
  }
  return out
}

export function matchCards(
  cards: readonly MatchableCard[],
  variants: readonly CatalogVariant[],
): { matches: Map<string, CardMatch>; summary: MatchSummary } {
  /* Medusa side: variants per key. */
  const bySku = new Map<string, CatalogVariant[]>()
  const byEan = new Map<string, CatalogVariant[]>()
  for (const v of variants) {
    const sku = normalizeSku(v.sku)
    if (sku) addTo(bySku, sku, v)
    for (const ean of variantEans(v)) addTo(byEan, ean, v)
  }

  /* BaseLinker side: cards per key. */
  const skuCount = new Map<string, number>()
  const eanCount = new Map<string, number>()
  for (const c of cards) {
    count(skuCount, normalizeSku(c.sku))
    count(eanCount, normalizeEan(c.ean))
  }

  const ordered = [...cards].sort((a, b) => compareIds(a.blProductId, b.blProductId))
  const matches = new Map<string, CardMatch>()
  const taken = new Set<string>()
  const pending: MatchableCard[] = []

  /* Pass 1: SKU. */
  for (const c of ordered) {
    const sku = normalizeSku(c.sku)
    const base: CardMatch = { blProductId: c.blProductId, key: sku, source: sku ? "sku" : null, variant: null, conflict: null }
    if (!sku) {
      matches.set(c.blProductId, base)
      pending.push(c)
      continue
    }
    if ((skuCount.get(sku) ?? 0) > 1) {
      matches.set(c.blProductId, { ...base, conflict: "duplicate_sku" })
      continue
    }
    const found = bySku.get(sku) ?? []
    if (found.length > 1) {
      matches.set(c.blProductId, { ...base, conflict: "ambiguous_variant" })
      continue
    }
    if (found.length === 1) {
      matches.set(c.blProductId, { ...base, variant: found[0] })
      taken.add(found[0].id)
      continue
    }
    matches.set(c.blProductId, base)
    pending.push(c)
  }

  /* Pass 2: EAN, for cards the SKU did not settle. An EAN outcome (a link or
   * a conflict) is reported with the EAN as its key; a card that stays
   * unmatched keeps its SKU as the key a person would search for. */
  for (const c of pending) {
    const ean = normalizeEan(c.ean)
    if (!ean) continue
    const byKey: CardMatch = { blProductId: c.blProductId, key: ean, source: "ean", variant: null, conflict: null }
    if ((eanCount.get(ean) ?? 0) > 1) {
      matches.set(c.blProductId, { ...byKey, conflict: "duplicate_ean" })
      continue
    }
    const found = byEan.get(ean) ?? []
    if (found.length > 1) {
      matches.set(c.blProductId, { ...byKey, conflict: "ambiguous_variant" })
      continue
    }
    if (found.length === 1 && !taken.has(found[0].id)) {
      matches.set(c.blProductId, { ...byKey, variant: found[0] })
      taken.add(found[0].id)
      continue
    }
    const current = matches.get(c.blProductId) as CardMatch
    if (!current.key) matches.set(c.blProductId, byKey)
  }

  /* Summary. */
  let linkedBySku = 0
  let linkedByEan = 0
  let unmatched = 0
  let duplicateSku = 0
  let duplicateEan = 0
  let ambiguousVariant = 0
  let noSku = 0
  const duplicateSkus = new Set<string>()
  for (const c of ordered) {
    const m = matches.get(c.blProductId) as CardMatch
    if (!normalizeSku(c.sku)) noSku += 1
    if (m.variant) {
      if (m.source === "ean") linkedByEan += 1
      else linkedBySku += 1
    } else if (m.conflict === "duplicate_sku") {
      duplicateSku += 1
      if (m.key) duplicateSkus.add(m.key)
    } else if (m.conflict === "duplicate_ean") duplicateEan += 1
    else if (m.conflict === "ambiguous_variant") ambiguousVariant += 1
    else unmatched += 1
  }

  const onlyInMedusaSkus: string[] = []
  let onlyInMedusa = 0
  for (const v of variants) {
    const sku = normalizeSku(v.sku)
    if (!sku || taken.has(v.id)) continue
    if (skuCount.has(sku)) continue
    if (variantEans(v).some((e) => eanCount.has(e))) continue
    onlyInMedusa += 1
    onlyInMedusaSkus.push(sku)
  }

  return {
    matches,
    summary: {
      cards: cards.length,
      linked: linkedBySku + linkedByEan,
      linkedBySku,
      linkedByEan,
      unmatched,
      conflicts: duplicateSku + duplicateEan + ambiguousVariant,
      duplicateSku,
      duplicateEan,
      ambiguousVariant,
      noSku,
      onlyInMedusa,
      onlyInMedusaSkus: onlyInMedusaSkus.sort().slice(0, 50),
      duplicateSkus: [...duplicateSkus].sort().slice(0, 50),
    },
  }
}
