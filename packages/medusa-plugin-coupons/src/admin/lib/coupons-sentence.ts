/**
 * EVERY COUPON IN ONE PLAIN SENTENCE: what it gives, on what, where, for
 * whom, how it works, from what amount, until when, how many times, and every
 * other rule it has, by name. The list, the detail, the cards and the creator
 * (live, while the steps are filled) all use this one function, so the words
 * never differ. Pure: the words come from `t`, the money and the dates from
 * `fmt`.
 */
import type { CouponRuleDto, CouponShape, NameMaps, StoreTerms, WizardInput } from "../../modules/coupons/lib/contract"

type T = (key: string, options?: Record<string, unknown>) => string

export interface SentenceFormat {
  money: (n: number, currency: string) => string
  date: (iso: string) => string
}

export interface SentenceCoupon {
  /** The promotion id, for the store's own rule (names.storeRules); the creator's draft has none. */
  id?: string
  shape: CouponShape
  automatic: boolean
  code: string
  startsAt: string | null
  endsAt: string | null
  limit: number | null
  /** The store's own terms (option storeTerms). */
  terms?: StoreTerms | null
}

const names = (ids: readonly string[] | undefined, map: Record<string, string> | undefined) => (ids ?? []).map((id) => map?.[id] ?? id)

function list(items: string[], t: T): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} ${t("sentence.and")} ${items[items.length - 1]}`
}

/** A rule with no words of its own: its field, the comparison and its values (three, then how many more). */
function describeRule(r: CouponRuleDto, t: T): string {
  const shown = r.values.slice(0, 3)
  const more = r.values.length - shown.length
  const values = more > 0 ? `${shown.join(", ")} ${t("sentence.andMore", { count: more })}` : shown.join(", ")
  return t("sentence.rule", { attribute: r.attribute, operator: t(`sentence.op.${r.operator}`, { defaultValue: r.operator }), values: values || "-" })
}

export function couponSentence(c: SentenceCoupon, n: NameMaps, t: T, fmt: SentenceFormat, currency: string): string {
  const s = c.shape
  const cur = s.currency ?? currency
  const terms = c.terms ?? null
  const pools = terms?.pools ?? []
  const targets: string[] = []
  if (pools.length) targets.push(list(names(pools, n.pools), t))
  if (s.categoryIds.length) targets.push(list(names(s.categoryIds, n.categories), t))
  /* Tags stand for the store's pools when it keeps them; on their own they are named. */
  if (!pools.length && s.tagIds?.length) targets.push(t("sentence.tags", { list: list(names(s.tagIds, n.tags), t) }))
  if (s.collectionIds?.length) targets.push(t("sentence.collections", { list: list(names(s.collectionIds, n.collections), t) }))
  if (s.productIds.length) targets.push(s.productIds.length <= 3 ? list(names(s.productIds, n.products), t) : t("sentence.selectedProducts"))
  const what = targets.length ? list(targets, t) : t("sentence.allProducts")
  const delivery = list([...names(s.shippingTypeIds, n.shippingTypes), ...names(s.shippingOptionIds, n.shippingOptions)], t)
  const on = (key: string, extra: Record<string, unknown> = {}) => (delivery ? t(`${key}On`, { ...extra, list: delivery }) : t(key, extra))

  const parts: string[] = []
  const rule = c.id ? n.storeRules?.[c.id] : undefined
  const ruleText = rule?.text?.trim().replace(/[.\s]+$/, "") ?? ""
  /* The store applies its own rule and Medusa keeps a marker: the rule, its own sentence, takes the discount's place. */
  const replaces = Boolean(rule?.replacesDiscount && ruleText)
  if (!replaces) switch (s.kind) {
    case "percent_order":
      parts.push(t("sentence.percentOrder", { value: s.value ?? 0 }))
      break
    case "fixed_order":
      parts.push(t("sentence.fixedOrder", { amount: fmt.money(s.value ?? 0, cur) }))
      break
    case "free_shipping":
      parts.push(on("sentence.freeShipping"))
      break
    case "percent_shipping":
      parts.push(on("sentence.percentShipping", { value: s.value ?? 0 }))
      break
    case "fixed_shipping":
      parts.push(on("sentence.fixedShipping", { amount: fmt.money(s.value ?? 0, cur) }))
      break
    case "percent_items":
      parts.push(t("sentence.percentItems", { value: s.value ?? 0, what }))
      break
    case "fixed_items":
      parts.push(t("sentence.fixedItems", { amount: fmt.money(s.value ?? 0, cur), what }))
      break
    case "buy_get": {
      const bg = terms?.buyGet ?? (s.buyGet ? { ...s.buyGet, freePrice: null } : null)
      if (!bg) parts.push(t("sentence.buyGet"))
      else {
        parts.push(t(terms?.buyGet ? "sentence.buyGetStore" : "sentence.buyGetOn", { buy: bg.buy, free: bg.free, what }))
        if (terms?.buyGet && pools.length) parts.push(t("sentence.inPools", { list: list(names(pools, n.pools), t) }))
        if (bg.freePrice) parts.push(t("sentence.freePrice", { amount: fmt.money(bg.freePrice, cur) }))
      }
      break
    }
    default:
      parts.push(t("sentence.other"))
  }
  if (s.salesChannelIds?.length) parts.push(t("sentence.salesChannels", { list: list(names(s.salesChannelIds, n.salesChannels), t) }))
  if (s.regionIds?.length) parts.push(t("sentence.regions", { list: list(names(s.regionIds, n.regions), t) }))
  /* The minimum count, the price list base and the floor belong to what it gives. */
  if (terms?.minQuantity && terms.minQuantity > 1) parts.push(t(terms.perPool ? "sentence.minQuantityPerPool" : "sentence.minQuantity", { count: terms.minQuantity }))
  if (terms?.basePriceList) parts.push(t("sentence.basePriceList", { name: n.priceLists?.[terms.basePriceList] ?? terms.basePriceList }))
  if (terms?.floorPriceList && terms.floorPriceList !== terms.basePriceList) parts.push(t("sentence.floorPriceList", { name: n.priceLists?.[terms.floorPriceList] ?? terms.floorPriceList }))
  const nobody = n.nobody ?? null
  const realCustomers = s.customerIds.filter((id) => id !== nobody)
  const excluded = s.excludedGroupIds ?? []
  if (s.customerIds.length && !realCustomers.length) parts.push(t("sentence.forNobody"))
  else if (realCustomers.length && s.groupIds.length) parts.push(t("sentence.forCustomerInGroups", { customer: list(names(realCustomers, n.customers), t), groups: list(names(s.groupIds, n.groups), t) }))
  else if (realCustomers.length) parts.push(t("sentence.forCustomer", { customer: list(names(realCustomers, n.customers), t) }))
  else if (s.groupIds.length) parts.push(t("sentence.forGroups", { groups: list(names(s.groupIds, n.groups), t) }))
  else if (excluded.length) parts.push(t("sentence.forAllBut", { groups: list(names(excluded, n.groups), t) }))
  else parts.push(t("sentence.forEveryone"))
  parts.push(c.automatic || !c.code ? t("sentence.automatic") : t("sentence.withCode", { code: c.code }))
  if (s.minimum !== null) parts.push(t("sentence.minimum", { amount: fmt.money(s.minimum, cur) }))
  if (c.startsAt && c.endsAt) parts.push(t("sentence.between", { from: fmt.date(c.startsAt), to: fmt.date(c.endsAt) }))
  else if (c.endsAt) parts.push(t("sentence.until", { date: fmt.date(c.endsAt) }))
  else if (c.startsAt && new Date(c.startsAt).getTime() > Date.now()) parts.push(t("sentence.from", { date: fmt.date(c.startsAt) }))
  else parts.push(t("sentence.noEnd"))
  parts.push(c.limit === 1 ? t("sentence.once") : c.limit ? t("sentence.limit", { count: c.limit }) : t("sentence.noLimit"))
  if (terms?.perCustomerOrders) parts.push(t("sentence.perCustomer", { count: terms.perCustomerOrders }))
  if (terms?.threshold) parts.push(t(terms.threshold.metric === "gross" ? "sentence.thresholdGross" : "sentence.thresholdNet", { amount: fmt.money(terms.threshold.value, cur) }))
  if (terms?.combines?.with.length) parts.push(t("sentence.combinesWith", { list: list(terms.combines.with, t) }))
  if (terms?.combines?.never.length) parts.push(t("sentence.combinesNever", { list: list(terms.combines.never, t) }))
  for (const r of s.rules ?? []) parts.push(describeRule(r, t))
  const text = parts.join(", ")
  const cap = (x: string) => `${x.charAt(0).toUpperCase()}${x.slice(1)}`
  if (replaces) return `${cap(ruleText)}. ${cap(text)}.`
  /* A rule of the store that does not replace the discount: after the sentence, as its own. */
  const extra = rule && ruleText ? ` ${t("sentence.storeRule", { text: ruleText })}.` : ""
  return `${cap(text)}.${extra}`
}

/** The creator's answers as a coupon, so the sentence can be read before saving. */
export function wizardCoupon(w: WizardInput, dates: { startsAt: string | null; endsAt: string | null }, ctx: { memberGroupIds?: readonly string[]; storeBuyGet?: boolean } = {}): SentenceCoupon {
  const kind = w.kind === "percent_category" || w.kind === "percent_pools" ? "percent_items" : w.kind
  const members = [...(ctx.memberGroupIds ?? [])]
  const customers = [...new Set([...(w.customerIds ?? []), ...(w.customerId ? [w.customerId] : [])])]
  const pools = w.kind === "percent_pools" || (w.kind === "buy_get" && ctx.storeBuyGet) ? w.poolIds ?? [] : []
  const buyGet = w.kind === "buy_get" && w.buyGet ? { buy: Number(w.buyGet.buy) || 0, free: Number(w.buyGet.free) || 0 } : null
  const terms: StoreTerms = { ...(w.terms ?? {}), ...(pools.length ? { pools } : {}), ...(buyGet && ctx.storeBuyGet ? { buyGet: { ...buyGet, freePrice: w.buyGet?.freePrice ? Number(w.buyGet.freePrice) : null } } : {}) }
  return {
    shape: {
      kind,
      value: w.kind === "free_shipping" ? 100 : w.kind === "buy_get" ? null : Number(w.value) || 0,
      currency: w.currencyCode ?? null,
      categoryIds: w.kind === "percent_category" || w.kind === "buy_get" ? w.categoryIds ?? [] : [],
      productIds: [],
      collectionIds: [],
      shippingTypeIds: [],
      shippingOptionIds: [],
      salesChannelIds: [],
      regionIds: [],
      tagIds: [],
      groupIds: w.audience === "groups" ? w.groupIds ?? [] : w.audience === "members" ? members : [],
      excludedGroupIds: w.audience === "retail" ? members : [],
      buyGet,
      customerIds: w.audience === "customer" ? customers : [],
      minimum: w.minimum ? Number(w.minimum) : null,
      rules: [],
      otherRules: 0,
    },
    automatic: w.mode === "automatic",
    code: w.mode === "automatic" ? "" : String(w.code ?? ""),
    startsAt: dates.startsAt,
    endsAt: dates.endsAt,
    limit: w.limit ? Number(w.limit) : null,
    terms,
  }
}
