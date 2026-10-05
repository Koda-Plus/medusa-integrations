/**
 * MATCHING ALLEGRO OFFERS TO PRODUCT VARIANTS. Pure arithmetic, zero imports.
 *
 * THE KEY IS THE SIGNATURE (`external.id`), compared UPPERCASE and trimmed
 * with the variant SKU. It is the field Allegro gives sellers for their own
 * product code, and the one feeds and BaseLinker fill. We never match by
 * offer name: names are marketing copy and change for SEO.
 *
 * ONE PRIMARY OFFER PER VARIANT. A variant can have several offers (a
 * re-listed item, an old ended one, a draft). The primary one wins by status
 * first, live > activating > draft > ended, then by the highest offer id,
 * because Allegro ids grow over time.
 */

export type StatusGroup = "live" | "activating" | "draft" | "ended"

export function statusGroup(status: string | null | undefined): StatusGroup {
  switch (String(status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "live"
    case "ACTIVATING":
      return "activating"
    case "INACTIVE":
      return "draft"
    default:
      return "ended"
  }
}

export interface MatchableOffer {
  allegroId: string
  status: string
  externalId: string | null
}

export interface CatalogVariant {
  id: string
  sku: string
  productId: string
  productTitle: string | null
}

export interface OfferMatch {
  allegroId: string
  key: string | null
  variant: CatalogVariant | null
  isPrimary: boolean
}

export interface MatchSummary {
  offers: number
  withKey: number
  noKey: number
  /** Offers linked to a variant, in any status. */
  linked: number
  /** Variants whose primary offer is live. */
  linkedLive: number
  linkedVariants: number
  linkedProducts: number
  /** Live offers whose signature has no variant in the catalog. */
  unmatchedLive: number
  unmatchedLiveKeys: string[]
  /** Catalog SKUs that collide once uppercased. The first variant wins. */
  ambiguousSkus: string[]
}

export function normalizeKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase()
}

const RANK: Record<StatusGroup, number> = { live: 3, activating: 2, draft: 1, ended: 0 }

function compareIds(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na > nb ? 1 : -1
  return a === b ? 0 : a > b ? 1 : -1
}

/** Which of two offers of the same variant tells more about the item. */
export function betterOffer<T extends MatchableOffer>(a: T, b: T): T {
  const ra = RANK[statusGroup(a.status)]
  const rb = RANK[statusGroup(b.status)]
  if (ra !== rb) return ra > rb ? a : b
  return compareIds(a.allegroId, b.allegroId) >= 0 ? a : b
}

export function matchOffers(
  offers: readonly MatchableOffer[],
  variants: readonly CatalogVariant[],
): { matches: Map<string, OfferMatch>; summary: MatchSummary } {
  const bySku = new Map<string, CatalogVariant>()
  const ambiguous = new Set<string>()
  for (const v of variants) {
    const k = normalizeKey(v.sku)
    if (!k) continue
    if (bySku.has(k)) {
      ambiguous.add(k)
      continue
    }
    bySku.set(k, v)
  }

  const matches = new Map<string, OfferMatch>()
  const best = new Map<string, MatchableOffer>()
  const unmatchedLive = new Set<string>()
  let withKey = 0
  let noKey = 0
  let linked = 0

  for (const o of offers) {
    const key = normalizeKey(o.externalId)
    if (!key) {
      noKey += 1
      matches.set(o.allegroId, { allegroId: o.allegroId, key: null, variant: null, isPrimary: false })
      continue
    }
    withKey += 1
    const variant = bySku.get(key) ?? null
    matches.set(o.allegroId, { allegroId: o.allegroId, key, variant, isPrimary: false })
    if (!variant) {
      if (statusGroup(o.status) === "live") unmatchedLive.add(key)
      continue
    }
    linked += 1
    const current = best.get(variant.id)
    best.set(variant.id, current ? betterOffer(current, o) : o)
  }

  let linkedLive = 0
  const products = new Set<string>()
  for (const [variantId, o] of best) {
    const m = matches.get(o.allegroId)
    if (m) m.isPrimary = true
    if (statusGroup(o.status) === "live") linkedLive += 1
    const v = m?.variant
    if (v && v.id === variantId) products.add(v.productId)
  }

  return {
    matches,
    summary: {
      offers: offers.length,
      withKey,
      noKey,
      linked,
      linkedLive,
      linkedVariants: best.size,
      linkedProducts: products.size,
      unmatchedLive: unmatchedLive.size,
      unmatchedLiveKeys: [...unmatchedLive].sort().slice(0, 50),
      ambiguousSkus: [...ambiguous].sort().slice(0, 50),
    },
  }
}
