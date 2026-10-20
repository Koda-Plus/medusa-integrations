/**
 * THE CREATOR: the three steps (type, audience, rules) checked, turned into
 * a standard Medusa promotion, and the warnings a person should read before
 * saving. Pure (no Medusa imports): the admin runs the same checks and
 * warnings live, the server runs them again before it writes anything.
 *
 * Everything the creator saves is an ordinary promotion of Medusa's
 * promotion module, so the cart, the order, invoices and every other module
 * see it the way they see a promotion made by hand. The store's own terms
 * (option storeTerms: pools, from N pieces, a price list as the base, buy X
 * get Y counted by the store, which codes add up) go to the store's adapter
 * next to it.
 */

import { EACH_MAX_QUANTITY, RULE } from "./constants"
import type { CouponDto, StoreFeature, StoreTerms, WizardInput } from "./contract"

export interface NormalizedWizard {
  kind: WizardInput["kind"]
  value: number
  categoryIds: string[]
  poolIds: string[]
  buyGet: { buy: number; free: number; freePrice: number | null } | null
  audience: WizardInput["audience"]
  groupIds: string[]
  excludedGroupIds: string[]
  customerIds: string[]
  automatic: boolean
  code: string
  startsAt: Date | null
  endsAt: Date | null
  limit: number | null
  minimum: number | null
  currencyCode: string
  /** The store's own terms to save next to the promotion, null when there are none. */
  terms: StoreTerms | null
}

export interface WizardCheck {
  ok: boolean
  /** Keys of the admin dictionary: `wizard.error.<key>`. */
  errors: string[]
  value: NormalizedWizard | null
}

/** What the creator knows about the store: its member groups and the terms it keeps. */
export interface WizardContext {
  now?: Date
  currencyCode: string
  memberGroupIds?: readonly string[]
  /** The features of option storeTerms; empty without it. */
  features?: readonly StoreFeature[]
}

const CODE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/
const ID = /^[A-Za-z0-9_]{1,80}$/
/* Pools are the store's own ids (handles), so dashes too. */
const POOL = /^[A-Za-z0-9_:-]{1,80}$/

export const WIZARD_KINDS = ["percent_order", "fixed_order", "free_shipping", "percent_category", "percent_pools", "buy_get"] as const
export const WIZARD_AUDIENCES = ["everyone", "groups", "members", "retail", "customer"] as const

/** The code as the creator keeps it: upper case, spaces to dashes, only letters, digits, dash and underscore. */
export function cleanCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 40)
}

/** The end of the month of `now`, 23:59:59.999 in UTC (good enough for "until the end of the month"). */
export function endOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999))
}

/** A code suggestion from the step answers: PREFIX-KIND-VALUE, e.g. SHOP-15OFF, SHOP-7PLUS1. */
export function suggestCode(input: Pick<WizardInput, "kind" | "value" | "buyGet">, prefix: string | null): string {
  const v = Math.round(Number(input.value) || 0)
  const body =
    input.kind === "free_shipping"
      ? "DOSTAWA0"
      : input.kind === "fixed_order"
        ? `MINUS${v}`
        : input.kind === "buy_get"
          ? `${Math.round(Number(input.buyGet?.buy) || 0)}PLUS${Math.round(Number(input.buyGet?.free) || 0)}`
          : `${v}OFF`
  return cleanCode(prefix ? `${prefix}-${body}` : body)
}

/**
 * A code for a copy: the first number in the code goes up by one
 * (7GRATIS1 gives 8GRATIS1), a code without a number gets "-2".
 */
export function nextCode(code: string, taken: readonly string[] = []): string {
  const used = new Set(taken.map((c) => c.toUpperCase()))
  const base = cleanCode(code)
  for (let step = 1; step < 50; step++) {
    const m = base.match(/\d+/)
    const candidate = m && m.index !== undefined ? `${base.slice(0, m.index)}${Number(m[0]) + step}${base.slice(m.index + m[0].length)}` : `${base}-${step + 1}`
    const clean = cleanCode(candidate)
    if (!used.has(clean)) return clean
  }
  return cleanCode(`${base}-${Date.now().toString(36).slice(-4)}`)
}

const posInt = (v: unknown): number | null => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 ? n : null
}
/* Codes of other coupons exactly as Medusa keeps them (a code may hold a space). */
const codes = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map((c) => String(c ?? "").trim()).filter((c) => c.length > 0 && c.length <= 60))]

/** The store's terms of the form, only the features the store keeps; invalid ones as error keys. */
export function cleanTerms(raw: Partial<StoreTerms> | null | undefined, features: readonly StoreFeature[], errors: string[]): StoreTerms {
  const t = raw ?? {}
  const out: StoreTerms = {}
  const has = (f: StoreFeature) => features.includes(f)
  if (has("note") && t.note !== undefined) out.note = typeof t.note === "string" && t.note.trim() ? t.note.trim().slice(0, 500) : null
  if (has("minQuantity") && t.minQuantity !== undefined) {
    const n = t.minQuantity === null || Number(t.minQuantity) <= 1 ? null : posInt(t.minQuantity)
    if (t.minQuantity !== null && Number(t.minQuantity) > 1 && n === null) errors.push("min_quantity")
    out.minQuantity = n
    if (t.perPool !== undefined) out.perPool = t.perPool === true
  }
  if (has("priceLists")) {
    if (t.basePriceList !== undefined) out.basePriceList = typeof t.basePriceList === "string" && ID.test(t.basePriceList) ? t.basePriceList : null
    if (t.floorPriceList !== undefined) out.floorPriceList = typeof t.floorPriceList === "string" && ID.test(t.floorPriceList) ? t.floorPriceList : null
  }
  if (has("combines") && t.combines !== undefined) {
    const w = codes(t.combines?.with)
    /* A code in both lists stays so until someone picks one: saving never decides it silently. */
    const n = codes(t.combines?.never)
    out.combines = w.length || n.length ? { with: w, never: n } : null
  }
  if (has("perCustomerOrders") && t.perCustomerOrders !== undefined) {
    const n = t.perCustomerOrders === null || Number(t.perCustomerOrders) === 0 ? null : posInt(t.perCustomerOrders)
    if (t.perCustomerOrders !== null && Number(t.perCustomerOrders) !== 0 && n === null) errors.push("per_customer")
    out.perCustomerOrders = n
  }
  if (has("threshold") && t.threshold !== undefined) {
    const v = Number(t.threshold?.value)
    if (t.threshold === null || !v) out.threshold = null
    else if (!Number.isFinite(v) || v < 0) errors.push("threshold")
    else out.threshold = { value: v, metric: t.threshold?.metric === "gross" ? "gross" : "net" }
  }
  return out
}

export function checkWizard(input: WizardInput, opts: WizardContext): WizardCheck {
  const errors: string[] = []
  const now = opts.now ?? new Date()
  const features = opts.features ?? []
  const members = (opts.memberGroupIds ?? []).filter((g) => ID.test(g))
  const kind = input.kind
  if (!(WIZARD_KINDS as readonly string[]).includes(kind)) errors.push("kind")
  if (kind === "percent_pools" && !features.includes("pools")) errors.push("kind")

  const value = kind === "free_shipping" || kind === "buy_get" ? 100 : Number(input.value)
  if (kind === "percent_order" || kind === "percent_category" || kind === "percent_pools") {
    if (!Number.isFinite(value) || value <= 0 || value > 100) errors.push("percent")
  } else if (kind === "fixed_order") {
    if (!Number.isFinite(value) || value <= 0) errors.push("amount")
  }
  const categoryIds = (input.categoryIds ?? []).filter((c) => ID.test(c))
  const poolIds = [...new Set((input.poolIds ?? []).filter((c) => POOL.test(c)))]
  if (kind === "percent_category" && categoryIds.length === 0) errors.push("category")
  if (kind === "percent_pools" && poolIds.length === 0) errors.push("pools")

  /* Buy X get Y: the store counts it (feature buyGet) or Medusa does (buyget, on categories). */
  const storeBuyGet = features.includes("buyGet")
  let buyGet: NormalizedWizard["buyGet"] = null
  if (kind === "buy_get") {
    const buy = posInt(input.buyGet?.buy)
    const free = posInt(input.buyGet?.free)
    const priceRaw = input.buyGet?.freePrice
    const freePrice = storeBuyGet && priceRaw !== null && priceRaw !== undefined && String(priceRaw) !== "" ? Number(priceRaw) : null
    if (buy === null || free === null) errors.push("buy_get")
    else if (freePrice !== null && (!Number.isFinite(freePrice) || freePrice < 0)) errors.push("free_price")
    else buyGet = { buy, free, freePrice }
    if (!storeBuyGet && categoryIds.length === 0) errors.push("category")
  }

  const audience = input.audience
  if (!(WIZARD_AUDIENCES as readonly string[]).includes(audience)) errors.push("audience")
  const groupIds = (input.groupIds ?? []).filter((g) => ID.test(g))
  if (audience === "groups" && groupIds.length === 0) errors.push("groups")
  if ((audience === "members" || audience === "retail") && members.length === 0) errors.push("members")
  const customerIds = [...new Set([...(input.customerIds ?? []), ...(input.customerId ? [input.customerId] : [])].filter((c) => ID.test(c)))]
  if (audience === "customer" && customerIds.length === 0) errors.push("customer")

  const automatic = input.mode === "automatic"
  const code = cleanCode(input.code)
  if (!CODE.test(code)) errors.push("code")

  let startsAt: Date | null = null
  let endsAt: Date | null = null
  if (input.validity === "month") {
    startsAt = now
    endsAt = endOfMonth(now)
  } else if (input.validity === "30d") {
    startsAt = now
    endsAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000)
  } else if (input.validity === "custom") {
    startsAt = input.startsAt ? new Date(input.startsAt) : now
    endsAt = input.endsAt ? new Date(input.endsAt) : null
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) errors.push("dates")
    else if (endsAt && endsAt.getTime() <= startsAt.getTime()) errors.push("dates")
  } else if (input.validity !== "none") errors.push("validity")

  const limit = input.limit === null || input.limit === undefined || Number(input.limit) === 0 ? null : Math.floor(Number(input.limit))
  if (limit !== null && (!Number.isFinite(limit) || limit < 1)) errors.push("limit")
  const minimum = input.minimum === null || input.minimum === undefined || Number(input.minimum) === 0 ? null : Number(input.minimum)
  if (minimum !== null && (!Number.isFinite(minimum) || minimum < 0)) errors.push("minimum")
  const cur = String(input.currencyCode ?? opts.currencyCode).toLowerCase()
  const currencyCode = /^[a-z]{3}$/.test(cur) ? cur : opts.currencyCode

  /* The store's terms: pools and buy X get Y from the type step, the rest from the rules step. */
  const terms: StoreTerms = cleanTerms(input.terms ?? null, features, errors)
  if (features.includes("pools") && (kind === "percent_pools" || (kind === "buy_get" && storeBuyGet))) terms.pools = poolIds
  if (kind === "buy_get" && storeBuyGet && buyGet) terms.buyGet = buyGet
  if (terms.perCustomerOrders && audience !== "customer") errors.push("per_customer_audience")
  const hasTerms = Object.values(terms).some((v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0) && v !== false)

  if (errors.length) return { ok: false, errors: [...new Set(errors)], value: null }
  return {
    ok: true,
    errors: [],
    value: {
      kind,
      value,
      categoryIds: kind === "percent_category" || kind === "buy_get" ? categoryIds : [],
      poolIds: kind === "percent_pools" || (kind === "buy_get" && storeBuyGet) ? poolIds : [],
      buyGet,
      audience,
      groupIds: audience === "groups" ? groupIds : audience === "members" ? members : [],
      excludedGroupIds: audience === "retail" ? members : [],
      customerIds: audience === "customer" ? customerIds : [],
      automatic,
      code,
      startsAt,
      endsAt,
      limit,
      minimum,
      currencyCode,
      terms: hasTerms ? terms : null,
    },
  }
}

type RuleInput = { attribute: string; operator: "in" | "eq" | "gte" | "ne"; values: string[] }

/** The target rules of the store's pools, merged per attribute (two pools on tags: one rule with both tags). */
export function poolTargetRules(poolIds: readonly string[], pools: ReadonlyArray<{ id: string; target?: { attribute: string; values: string[] } | null }>): RuleInput[] {
  const byAttr = new Map<string, Set<string>>()
  for (const id of poolIds) {
    const t = pools.find((p) => p.id === id)?.target
    if (!t?.attribute || !t.values?.length) continue
    const set = byAttr.get(t.attribute) ?? new Set<string>()
    t.values.forEach((v) => set.add(String(v)))
    byAttr.set(t.attribute, set)
  }
  return [...byAttr].map(([attribute, values]) => ({ attribute, operator: "in", values: [...values] }))
}

/** The audience and minimum rules of a coupon. */
function audienceRules(w: Pick<NormalizedWizard, "groupIds" | "excludedGroupIds" | "customerIds" | "minimum">): RuleInput[] {
  const rules: RuleInput[] = []
  if (w.groupIds.length) rules.push({ attribute: RULE.groups, operator: "in", values: w.groupIds })
  if (w.excludedGroupIds.length) rules.push({ attribute: RULE.groups, operator: "ne", values: w.excludedGroupIds })
  if (w.customerIds.length) rules.push({ attribute: RULE.customer, operator: "in", values: w.customerIds })
  if (w.minimum !== null) rules.push({ attribute: RULE.minimum, operator: "gte", values: [String(w.minimum)] })
  return rules
}

export interface PromotionContext {
  /** Buy X get Y counted by the store (feature buyGet): the marker percent Medusa keeps. Null: Medusa's own buyget. */
  buyGetMarker: number | null
  pools: ReadonlyArray<{ id: string; target?: { attribute: string; values: string[] } | null }>
}

/** The input of Medusa's createPromotionsWorkflow, and the campaign that holds the dates (when there are any). */
export function promotionInput(
  w: NormalizedWizard,
  ctx: PromotionContext = { buyGetMarker: null, pools: [] },
): {
  promotion: {
    code: string
    type: "standard" | "buyget"
    status: "active"
    is_automatic: boolean
    limit?: number | null
    application_method: Record<string, unknown>
    rules: RuleInput[]
  }
  campaign: { name: string; campaign_identifier: string; starts_at: Date | null; ends_at: Date | null } | null
} {
  const rules = audienceRules(w)
  const categoryTarget = (ids: string[]): RuleInput[] => (ids.length ? [{ attribute: RULE.category, operator: "in", values: ids }] : [])

  let type: "standard" | "buyget" = "standard"
  let application_method: Record<string, unknown>
  if (w.kind === "free_shipping") {
    application_method = { type: "percentage", target_type: "shipping_methods", allocation: "across", value: 100 }
  } else if (w.kind === "fixed_order") {
    application_method = { type: "fixed", target_type: "order", allocation: "across", value: w.value, currency_code: w.currencyCode }
    /* Medusa asks for the currency of an amount as a rule too (its own creator adds it). */
    rules.push({ attribute: RULE.currency, operator: "eq", values: [w.currencyCode] })
  } else if (w.kind === "percent_category") {
    application_method = { type: "percentage", target_type: "items", allocation: "across", value: w.value, target_rules: categoryTarget(w.categoryIds) }
  } else if (w.kind === "percent_pools") {
    application_method = { type: "percentage", target_type: "items", allocation: "each", max_quantity: EACH_MAX_QUANTITY, value: w.value, target_rules: poolTargetRules(w.poolIds, ctx.pools) }
  } else if (w.kind === "buy_get" && ctx.buyGetMarker !== null) {
    /* The store adds the free pieces itself; Medusa keeps a marker on the same items. */
    const targets = [...poolTargetRules(w.poolIds, ctx.pools), ...categoryTarget(w.categoryIds)]
    application_method = { type: "percentage", target_type: "items", allocation: "each", max_quantity: EACH_MAX_QUANTITY, value: ctx.buyGetMarker, target_rules: targets }
  } else if (w.kind === "buy_get" && w.buyGet) {
    type = "buyget"
    application_method = {
      type: "percentage",
      target_type: "items",
      allocation: "each",
      value: 100,
      max_quantity: w.buyGet.free,
      apply_to_quantity: w.buyGet.free,
      buy_rules_min_quantity: w.buyGet.buy,
      buy_rules: categoryTarget(w.categoryIds),
      target_rules: categoryTarget(w.categoryIds),
    }
  } else {
    application_method = { type: "percentage", target_type: "order", allocation: "across", value: w.value }
  }

  return {
    promotion: {
      code: w.code,
      type,
      status: "active",
      is_automatic: w.automatic,
      ...(w.limit !== null ? { limit: w.limit } : {}),
      application_method,
      rules,
    },
    campaign:
      w.startsAt || w.endsAt
        ? {
            name: w.code,
            campaign_identifier: `koda-coupons-${w.code.toLowerCase()}-${Date.now().toString(36)}`,
            starts_at: w.startsAt,
            ends_at: w.endsAt,
          }
        : null,
  }
}

/** The kind of the coupon as describe.ts will read it back, for the store's adapter. */
export function savedKind(w: Pick<NormalizedWizard, "kind">, storeBuyGet: boolean): string {
  if (w.kind === "percent_category" || w.kind === "percent_pools") return "percent_items"
  if (w.kind === "buy_get") return storeBuyGet ? "store_buy_get" : "buy_get"
  return w.kind
}

const targetOf = (kind: string): "shipping" | "items" | "order" =>
  ["free_shipping", "percent_shipping", "fixed_shipping"].includes(kind) ? "shipping" : ["percent_items", "fixed_items", "percent_category", "percent_pools", "buy_get"].includes(kind) ? "items" : "order"

/**
 * What a person should read before saving. Keys of `wizard.warning.<key>`.
 * `active` are the store's coupons active today (from the list), for the
 * checks that compare with them.
 */
export function wizardWarnings(input: WizardInput, ctx: { active: readonly CouponDto[]; memberGroupIds: readonly string[] }): string[] {
  const out: string[] = []
  const automatic = input.mode === "automatic"
  const value = Number(input.value) || 0
  const groups = input.audience === "members" ? [...ctx.memberGroupIds] : input.groupIds ?? []
  if (automatic && input.audience === "everyone") out.push("automatic_everyone")
  if (automatic && (input.audience === "groups" || input.audience === "members") && ctx.memberGroupIds.length > 0 && groups.some((g) => ctx.memberGroupIds.includes(g))) out.push("automatic_members")
  const target = targetOf(input.kind)
  const combinesWith = new Set((input.terms?.combines?.with ?? []).map((c) => c.toUpperCase()))
  const overlaps = ctx.active.filter((c) => {
    if (c.status !== "active" || !c.automatic) return false
    if (combinesWith.has(c.code.toUpperCase())) return false
    const t = targetOf(c.shape.kind)
    return t === target || (target === "order" && t === "items") || (target === "items" && t === "order")
  })
  if (overlaps.length > 0) out.push("stacking")
  if ((input.kind === "percent_order" || input.kind === "percent_category" || input.kind === "percent_pools") && value >= 50) out.push("big_percent")
  if (input.kind === "fixed_order" && (input.minimum === null || input.minimum === undefined || Number(input.minimum) < value)) out.push("fixed_without_minimum")
  if (input.validity === "none" && (input.limit === null || input.limit === undefined || Number(input.limit) === 0) && input.audience === "everyone") out.push("no_end")
  if (ctx.active.some((c) => c.code && c.code.toUpperCase() === cleanCode(input.code))) out.push("code_taken")
  const combineCodes = [...(input.terms?.combines?.with ?? []), ...(input.terms?.combines?.never ?? [])].map((c) => c.toUpperCase())
  const known = new Set(ctx.active.map((c) => c.code.toUpperCase()))
  if (combineCodes.some((c) => !known.has(c))) out.push("combines_unknown")
  return out
}
