/**
 * EDITING a coupon: what the edit form may change, checked, and turned into
 * the writes of Medusa's own workflows. Pure (no Medusa imports): the admin
 * runs the same checks live, the server runs them again before it writes.
 *
 * The form shows the coupon the way the creator builds it (what it gives, on
 * what, for whom, how it works) and edits all of it but its type: the code,
 * code or automatic, the value, what the discount lands on (categories or
 * the store's pools), buy X get Y, the dates, the uses allowed, the order
 * minimum, who it is for and the store's own terms. What the form has no
 * field for (products, collections, sales channels, other rules) is kept as
 * it is and named, so nobody thinks it vanished.
 */
import { MINIMUM_ATTRIBUTES, RULE } from "./constants"
import type { CouponDto, CouponPatch, StoreFeature, StoreTerms } from "./contract"
import { cleanCode, cleanTerms, cleanVariantIds } from "./wizard"

const CODE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/
const ID = /^[A-Za-z0-9_]{1,80}$/
const POOL = /^[A-Za-z0-9_:-]{1,80}$/

/** Kinds whose value the form may change (a percent or an amount). */
export const VALUE_KINDS = ["percent_order", "fixed_order", "percent_shipping", "fixed_shipping", "percent_items", "fixed_items"] as const

export function valueEditable(c: Pick<CouponDto, "shape">): boolean {
  return (VALUE_KINDS as readonly string[]).includes(c.shape.kind)
}

export function isPercent(c: Pick<CouponDto, "shape">): boolean {
  return c.shape.kind.startsWith("percent_")
}

/** Discounts on items (not buy X get Y): single products may be left out of them. */
export function exclusionsEditable(c: Pick<CouponDto, "shape">): boolean {
  return c.shape.kind === "percent_items" || c.shape.kind === "fixed_items"
}

/** Coupons on items: the form may change what the discount lands on. */
export function targetsEditable(c: Pick<CouponDto, "shape">): boolean {
  return c.shape.kind === "percent_items" || c.shape.kind === "fixed_items" || c.shape.kind === "buy_get"
}

export interface NormalizedPatch {
  code?: string
  automatic?: boolean
  value?: number
  dates?: { startsAt: Date | null; endsAt: Date | null }
  limit?: number | null
  minimum?: number | null
  groupIds?: string[]
  customerIds?: string[]
  excludedGroupIds?: string[]
  categoryIds?: string[]
  poolIds?: string[]
  excludedVariantIds?: string[]
  buyGet?: { buy: number; free: number }
  /** The store's terms after the save (the current ones with the form's keys on top). */
  terms?: StoreTerms
}

export interface PatchCheck {
  ok: boolean
  /** Keys of the admin dictionary: `edit.error.<key>`. */
  errors: string[]
  /** Only what differs from the coupon as it is. */
  value: NormalizedPatch | null
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|")
const sameTime = (a: string | Date | null, b: string | Date | null) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null)
const ids = (v: unknown, re: RegExp = ID): string[] => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => re.test(x)))]

/** The terms compared key by key: empty lists, false and null mean the same "not set". */
function sameTerms(a: StoreTerms, b: StoreTerms): boolean {
  const norm = (t: StoreTerms) => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(t)) {
      if (v === null || v === undefined || v === false || (Array.isArray(v) && v.length === 0)) continue
      if (k === "combines" && v && typeof v === "object") {
        const c = v as { with: string[]; never: string[] }
        if (!c.with.length && !c.never.length) continue
        o[k] = { with: [...c.with].sort(), never: [...c.never].sort() }
        continue
      }
      o[k] = Array.isArray(v) ? [...v].sort() : v
    }
    return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
  }
  return norm(a) === norm(b)
}

export interface PatchContext {
  /** The features of option storeTerms; empty without it. */
  features?: readonly StoreFeature[]
  /** The customer id a store writes when nobody is left on the rule (option nobodyCustomerId). */
  nobody?: string | null
}

/**
 * Checks the form against the coupon as it is now. Keys missing from the
 * patch stay untouched; keys equal to the current value are dropped, so a
 * save of an unchanged form writes nothing.
 */
export function checkPatch(patch: CouponPatch, current: CouponDto, ctx: PatchContext = {}): PatchCheck {
  const errors: string[] = []
  const out: NormalizedPatch = {}
  const features = ctx.features ?? []

  /* A code as it is kept (also one Medusa took with a space, like "SUMMER 15") is no change. */
  const sameCode = patch.code !== undefined && String(patch.code).trim().toUpperCase() === (current.code ?? "").trim().toUpperCase()
  if (patch.code !== undefined && !sameCode) {
    const code = cleanCode(patch.code)
    if (!CODE.test(code)) errors.push("code")
    else if (code !== (current.code ?? "").toUpperCase()) out.code = code
  }

  if (patch.mode !== undefined) {
    if (patch.mode !== "code" && patch.mode !== "automatic") errors.push("mode")
    else if ((patch.mode === "automatic") !== current.automatic) out.automatic = patch.mode === "automatic"
  }

  if (patch.value !== undefined && patch.value !== null) {
    const v = Number(patch.value)
    if (!valueEditable(current)) {
      if (v !== current.shape.value) errors.push("value_fixed")
    } else if (isPercent(current) ? !(Number.isFinite(v) && v > 0 && v <= 100) : !(Number.isFinite(v) && v > 0)) errors.push(isPercent(current) ? "percent" : "amount")
    else if (v !== current.shape.value) out.value = v
  }

  if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
    const s = patch.startsAt !== undefined ? patch.startsAt : current.startsAt
    const e = patch.endsAt !== undefined ? patch.endsAt : current.endsAt
    const startsAt = s ? new Date(s) : null
    const endsAt = e ? new Date(e) : null
    if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) errors.push("dates")
    else if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) errors.push("dates")
    else if (!sameTime(startsAt, current.startsAt) || !sameTime(endsAt, current.endsAt)) out.dates = { startsAt, endsAt }
  }

  if (patch.limit !== undefined) {
    const limit = patch.limit === null || Number(patch.limit) === 0 ? null : Math.floor(Number(patch.limit))
    if (limit !== null && (!Number.isFinite(limit) || limit < 1)) errors.push("limit")
    else if (limit !== null && limit < current.used) errors.push("limit_below_used")
    else if (limit !== current.limit) out.limit = limit
  }

  if (patch.minimum !== undefined) {
    const minimum = patch.minimum === null || Number(patch.minimum) === 0 ? null : Number(patch.minimum)
    if (minimum !== null && (!Number.isFinite(minimum) || minimum < 0)) errors.push("minimum")
    else if (minimum !== current.shape.minimum) out.minimum = minimum
  }

  if (patch.groupIds !== undefined) {
    const g = ids(patch.groupIds)
    if (!sameSet(g, current.shape.groupIds)) out.groupIds = g
  }

  if (patch.customerIds !== undefined) {
    let c = ids(patch.customerIds)
    /* A real customer replaces the store's "nobody" marker. */
    if (ctx.nobody && c.length > 1) c = c.filter((x) => x !== ctx.nobody)
    if (!sameSet(c, current.shape.customerIds)) out.customerIds = c
  }

  if (patch.excludedGroupIds !== undefined) {
    const g = ids(patch.excludedGroupIds)
    if (!sameSet(g, current.shape.excludedGroupIds ?? [])) out.excludedGroupIds = g
  }

  const terms = current.terms ?? {}
  const storeBuyGet = Boolean(terms.buyGet)
  if (patch.categoryIds !== undefined) {
    const c = ids(patch.categoryIds)
    if (!targetsEditable(current)) {
      if (!sameSet(c, current.shape.categoryIds)) errors.push("targets_fixed")
    } else if (!sameSet(c, current.shape.categoryIds)) out.categoryIds = c
  }
  if (patch.poolIds !== undefined && features.includes("pools")) {
    const p = ids(patch.poolIds, POOL)
    if (!targetsEditable(current)) {
      if (!sameSet(p, terms.pools ?? [])) errors.push("targets_fixed")
    } else if (!sameSet(p, terms.pools ?? [])) out.poolIds = p
  }

  if (patch.excludedVariantIds !== undefined) {
    const v = cleanVariantIds(patch.excludedVariantIds)
    const before = current.shape.excludedVariantIds ?? []
    if (!exclusionsEditable(current)) {
      if (!sameSet(v, before)) errors.push("targets_fixed")
    } else if (!sameSet(v, before)) out.excludedVariantIds = v
  }

  if (patch.buyGet !== undefined && patch.buyGet !== null && current.shape.kind === "buy_get" && !storeBuyGet) {
    const buy = Math.floor(Number(patch.buyGet.buy))
    const free = Math.floor(Number(patch.buyGet.free))
    if (!(buy >= 1) || !(free >= 1)) errors.push("buy_get")
    else if (buy !== current.shape.buyGet?.buy || free !== current.shape.buyGet?.free) out.buyGet = { buy, free }
  }

  /* The store's terms: the current ones, the form's keys on top, only the store's features. */
  if (features.length && (patch.terms !== undefined || out.poolIds !== undefined)) {
    const next: StoreTerms = { ...terms, ...cleanTerms(patch.terms ?? {}, features, errors) }
    if (out.poolIds !== undefined) next.pools = out.poolIds
    if (patch.terms?.buyGet !== undefined && storeBuyGet) {
      const b = patch.terms.buyGet
      const buy = Math.floor(Number(b?.buy))
      const free = Math.floor(Number(b?.free))
      const price = b?.freePrice === null || b?.freePrice === undefined || String(b.freePrice) === "" ? null : Number(b.freePrice)
      if (!(buy >= 1) || !(free >= 1)) errors.push("buy_get")
      else if (price !== null && (!Number.isFinite(price) || price < 0)) errors.push("free_price")
      else next.buyGet = { buy, free, freePrice: price }
    }
    const customersAfter = out.customerIds ?? current.shape.customerIds
    if (next.perCustomerOrders && customersAfter.length === 0) errors.push("per_customer_audience")
    if (!sameTerms(next, terms)) out.terms = next
  }

  if (errors.length) return { ok: false, errors: [...new Set(errors)], value: null }
  return { ok: true, errors: [], value: out }
}

export function patchIsEmpty(p: NormalizedPatch): boolean {
  return Object.keys(p).length === 0
}

/** A rule of the promotion as Query reads it, with its id. */
export interface RuleRow {
  id: string
  attribute: string
  operator: string
}

export interface RuleChanges {
  create: Array<{ attribute: string; operator: "in" | "gte" | "ne"; values: string[] }>
  delete: string[]
}

/**
 * The audience and minimum rules to delete and create. Only the rules of an
 * attribute the patch changes are touched, and only in the form the plugin
 * reads them (in/eq; ne for "not these groups"; gte/gt for the minimum).
 */
export function ruleChanges(p: NormalizedPatch, rules: readonly RuleRow[]): RuleChanges {
  const out: RuleChanges = { create: [], delete: [] }
  const drop = (match: (r: RuleRow) => boolean) => out.delete.push(...rules.filter(match).map((r) => r.id))

  if (p.minimum !== undefined) {
    drop((r) => MINIMUM_ATTRIBUTES.includes(r.attribute) && (r.operator === "gte" || r.operator === "gt"))
    if (p.minimum !== null) out.create.push({ attribute: RULE.minimum, operator: "gte", values: [String(p.minimum)] })
  }
  if (p.groupIds !== undefined) {
    drop((r) => r.attribute === RULE.groups && (r.operator === "in" || r.operator === "eq"))
    if (p.groupIds.length) out.create.push({ attribute: RULE.groups, operator: "in", values: p.groupIds })
  }
  if (p.excludedGroupIds !== undefined) {
    drop((r) => r.attribute === RULE.groups && r.operator === "ne")
    if (p.excludedGroupIds.length) out.create.push({ attribute: RULE.groups, operator: "ne", values: p.excludedGroupIds })
  }
  if (p.customerIds !== undefined) {
    drop((r) => (r.attribute === RULE.customer || r.attribute === RULE.customerAlt) && (r.operator === "in" || r.operator === "eq"))
    if (p.customerIds.length) out.create.push({ attribute: RULE.customer, operator: "in", values: p.customerIds })
  }
  return out
}

/**
 * The target rules to delete and create when the form changes what the
 * discount lands on: categories, and the store's pools (whose target rules
 * the store names, e.g. product tags). `poolAttrs` are the attributes of the
 * pools' targets; `poolRules` the rules of the pools after the save.
 */
export function targetChanges(
  p: NormalizedPatch,
  targets: readonly RuleRow[],
  pools: { attrs: readonly string[]; rules: ReadonlyArray<{ attribute: string; operator: "in"; values: string[] }> },
): RuleChanges {
  const out: RuleChanges = { create: [], delete: [] }
  if (p.categoryIds !== undefined) {
    out.delete.push(...targets.filter((r) => r.attribute === RULE.category && (r.operator === "in" || r.operator === "eq")).map((r) => r.id))
    if (p.categoryIds.length) out.create.push({ attribute: RULE.category, operator: "in", values: p.categoryIds })
  }
  if (p.poolIds !== undefined) {
    out.delete.push(...targets.filter((r) => pools.attrs.includes(r.attribute) && (r.operator === "in" || r.operator === "eq")).map((r) => r.id))
    out.create.push(...pools.rules)
  }
  if (p.excludedVariantIds !== undefined) {
    out.delete.push(...targets.filter((r) => r.attribute === RULE.variant && r.operator === "ne").map((r) => r.id))
    if (p.excludedVariantIds.length) out.create.push({ attribute: RULE.variant, operator: "ne", values: p.excludedVariantIds })
  }
  return out
}

/** Where the uses allowed are kept: the promotion's own limit, or a usage budget of its campaign. */
export function limitLivesIn(p: { limit?: number | null; campaign?: { budget?: { type?: string | null } | null } | null }): "promotion" | "campaign" {
  if (p.limit !== null && p.limit !== undefined && Number(p.limit) > 0) return "promotion"
  return p.campaign?.budget?.type === "usage" ? "campaign" : "promotion"
}

/** What a person should read before saving. Keys of `edit.warning.<key>`. */
export function editWarnings(p: NormalizedPatch, current: CouponDto): string[] {
  const out: string[] = []
  if (p.code && current.used > 0) out.push("code_changed")
  const automaticAfter = p.automatic ?? current.automatic
  const groupsAfter = p.groupIds ?? current.shape.groupIds
  const customersAfter = p.customerIds ?? current.shape.customerIds
  const excludedAfter = p.excludedGroupIds ?? current.shape.excludedGroupIds ?? []
  const audienceAfter = groupsAfter.length + customersAfter.length + excludedAfter.length
  if (automaticAfter && audienceAfter === 0 && (p.automatic === true || p.groupIds !== undefined || p.customerIds !== undefined || p.excludedGroupIds !== undefined)) out.push("automatic_everyone")
  const hadAudience = current.shape.groupIds.length + current.shape.customerIds.length + (current.shape.excludedGroupIds ?? []).length > 0
  if (hadAudience && audienceAfter === 0) out.push("audience_widened")
  if (p.dates && current.campaign) out.push("campaign_dates")
  const targetsBefore = current.shape.categoryIds.length + (current.terms?.pools ?? []).length + (current.shape.tagIds ?? []).length
  const targetsAfter = (p.categoryIds ?? current.shape.categoryIds).length + (p.poolIds ?? current.terms?.pools ?? []).length
  if (targetsBefore > 0 && targetsAfter === 0 && (p.categoryIds !== undefined || p.poolIds !== undefined) && current.shape.productIds.length + current.shape.collectionIds.length === 0) out.push("targets_widened")
  return out
}
