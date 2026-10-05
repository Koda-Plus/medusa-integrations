/**
 * MATCHING OLX ADVERTS TO PRODUCT VARIANTS. Pure arithmetic, zero imports.
 *
 * KEYS: `external_id` FIRST, THEN THE SKU FROM THE DESCRIPTION.
 * `external_id` is what feeds and BaseLinker fill with the SKU (measured in
 * production: 232 of 232 live adverts). It does not depend on how the seller
 * formats the description. The description line is the fallback for adverts
 * created by hand. Both sides are compared UPPERCASE and trimmed, because
 * `wz-138 xd` and `WZ-138 XD` are the same item typed by different people.
 * We never match by title: OLX changes the casing of titles.
 *
 * ONE PRIMARY ADVERT PER VARIANT. A variant can have several adverts (a
 * re-listed item, an old ended one). The primary one wins by status first,
 * live > over the package limit > ended, then by the highest advert id,
 * because OLX ids grow over time.
 */

/** Statuses in which buyers can see the advert. */
export const LIVE_STATUSES: readonly string[] = ["active"]

/**
 * Over the package limit: on the account, invisible to buyers. Measured on
 * OLX.pl: every `limited` advert page shows buyers an error page. It ranks
 * above ended adverts because paying for the package brings it back.
 */
export const LIMITED_STATUS = "limited"

export type StatusGroup = "live" | "limited" | "ended"
export type MatchSource = "external_id" | "description"

export function statusGroup(status: string | null | undefined): StatusGroup {
  const s = String(status ?? "")
  if (LIVE_STATUSES.includes(s)) return "live"
  if (s === LIMITED_STATUS) return "limited"
  return "ended"
}

export interface MatchableAdvert {
  olxId: string
  status: string
  externalId: string | null
  descriptionSku: string | null
}

export interface CatalogVariant {
  id: string
  sku: string
  productId: string
  productTitle: string | null
}

export interface AdvertMatch {
  olxId: string
  key: string | null
  source: MatchSource | null
  variant: CatalogVariant | null
  isPrimary: boolean
}

export interface MatchSummary {
  adverts: number
  withKey: number
  bySource: Record<MatchSource, number>
  noKey: number
  /** Adverts linked to a variant, in any status. */
  linked: number
  /** Variants whose primary advert is live. */
  linkedLive: number
  linkedVariants: number
  linkedProducts: number
  /** Live adverts that carry a key with no variant in the catalog. */
  unmatchedLive: number
  unmatchedLiveKeys: string[]
  /** Catalog SKUs that collide once uppercased. The first variant wins. */
  ambiguousSkus: string[]
}

export function normalizeKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase()
}

export function advertKey(a: MatchableAdvert): { key: string; source: MatchSource } | null {
  const external = normalizeKey(a.externalId)
  if (external) return { key: external, source: "external_id" }
  const fromDescription = normalizeKey(a.descriptionSku)
  if (fromDescription) return { key: fromDescription, source: "description" }
  return null
}

function rank(status: string): number {
  const g = statusGroup(status)
  return g === "live" ? 2 : g === "limited" ? 1 : 0
}

function compareIds(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na > nb ? 1 : -1
  return a === b ? 0 : a > b ? 1 : -1
}

/** Which of two adverts of the same variant tells more about the item. */
export function betterAdvert<T extends MatchableAdvert>(a: T, b: T): T {
  const ra = rank(a.status)
  const rb = rank(b.status)
  if (ra !== rb) return ra > rb ? a : b
  return compareIds(a.olxId, b.olxId) >= 0 ? a : b
}

export function matchAdverts(
  adverts: readonly MatchableAdvert[],
  variants: readonly CatalogVariant[],
): { matches: Map<string, AdvertMatch>; summary: MatchSummary } {
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

  const matches = new Map<string, AdvertMatch>()
  const bySource: Record<MatchSource, number> = { external_id: 0, description: 0 }
  const best = new Map<string, MatchableAdvert>()
  const unmatchedLive = new Set<string>()
  let withKey = 0
  let noKey = 0
  let linked = 0

  for (const a of adverts) {
    const k = advertKey(a)
    if (!k) {
      noKey += 1
      matches.set(a.olxId, { olxId: a.olxId, key: null, source: null, variant: null, isPrimary: false })
      continue
    }
    withKey += 1
    bySource[k.source] += 1
    const variant = bySku.get(k.key) ?? null
    matches.set(a.olxId, { olxId: a.olxId, key: k.key, source: k.source, variant, isPrimary: false })
    if (!variant) {
      if (statusGroup(a.status) === "live") unmatchedLive.add(k.key)
      continue
    }
    linked += 1
    const current = best.get(variant.id)
    best.set(variant.id, current ? betterAdvert(current, a) : a)
  }

  let linkedLive = 0
  const products = new Set<string>()
  for (const [variantId, a] of best) {
    const m = matches.get(a.olxId)
    if (m) m.isPrimary = true
    if (statusGroup(a.status) === "live") linkedLive += 1
    const v = m?.variant
    if (v && v.id === variantId) products.add(v.productId)
  }

  return {
    matches,
    summary: {
      adverts: adverts.length,
      withKey,
      bySource,
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
