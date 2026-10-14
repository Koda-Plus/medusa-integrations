/**
 * EVERY COUPON IN ONE PLAIN SENTENCE: what it gives, on what, where, for
 * whom, how it works, from what amount, until when, how many times, and every
 * other rule it has, by name. The list, the detail, the cards and the creator
 * (live, while the steps are filled) all use this one function, so the words
 * never differ. Pure: the words come from `t`, the money and the dates from
 * `fmt`.
 */
import type { CouponRuleDto, CouponShape, NameMaps, WizardInput } from "../../modules/coupons/lib/contract"

type T = (key: string, options?: Record<string, unknown>) => string

export interface SentenceFormat {
  money: (n: number, currency: string) => string
  date: (iso: string) => string
}

export interface SentenceCoupon {
  shape: CouponShape
  automatic: boolean
  code: string
  startsAt: string | null
  endsAt: string | null
  limit: number | null
}

const names = (ids: readonly string[] | undefined, map: Record<string, string> | undefined) => (ids ?? []).map((id) => map?.[id] ?? id)

function list(items: string[], t: T): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} ${t("sentence.and")} ${items[items.length - 1]}`
}

/** A rule with no words of its own: its field, the comparison and its values (three, then how many more). */
function ruleText(r: CouponRuleDto, t: T): string {
  const shown = r.values.slice(0, 3)
  const more = r.values.length - shown.length
  const values = more > 0 ? `${shown.join(", ")} ${t("sentence.andMore", { count: more })}` : shown.join(", ")
  return t("sentence.rule", { attribute: r.attribute, operator: t(`sentence.op.${r.operator}`, { defaultValue: r.operator }), values: values || "-" })
}

export function couponSentence(c: SentenceCoupon, n: NameMaps, t: T, fmt: SentenceFormat, currency: string): string {
  const s = c.shape
  const cur = s.currency ?? currency
  const targets: string[] = []
  if (s.categoryIds.length) targets.push(list(names(s.categoryIds, n.categories), t))
  if (s.collectionIds?.length) targets.push(t("sentence.collections", { list: list(names(s.collectionIds, n.collections), t) }))
  if (s.productIds.length) targets.push(s.productIds.length <= 3 ? list(names(s.productIds, n.products), t) : t("sentence.selectedProducts"))
  const what = targets.length ? list(targets, t) : t("sentence.allProducts")
  const delivery = list([...names(s.shippingTypeIds, n.shippingTypes), ...names(s.shippingOptionIds, n.shippingOptions)], t)
  const on = (key: string, extra: Record<string, unknown> = {}) => (delivery ? t(`${key}On`, { ...extra, list: delivery }) : t(key, extra))

  const parts: string[] = []
  switch (s.kind) {
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
    case "buy_get":
      parts.push(t("sentence.buyGet"))
      break
    default:
      parts.push(t("sentence.other"))
  }
  if (s.salesChannelIds?.length) parts.push(t("sentence.salesChannels", { list: list(names(s.salesChannelIds, n.salesChannels), t) }))
  if (s.regionIds?.length) parts.push(t("sentence.regions", { list: list(names(s.regionIds, n.regions), t) }))
  if (s.customerIds.length) parts.push(t("sentence.forCustomer", { customer: list(names(s.customerIds, n.customers), t) }))
  else if (s.groupIds.length) parts.push(t("sentence.forGroups", { groups: list(names(s.groupIds, n.groups), t) }))
  else parts.push(t("sentence.forEveryone"))
  parts.push(c.automatic || !c.code ? t("sentence.automatic") : t("sentence.withCode", { code: c.code }))
  if (s.minimum !== null) parts.push(t("sentence.minimum", { amount: fmt.money(s.minimum, cur) }))
  if (c.startsAt && c.endsAt) parts.push(t("sentence.between", { from: fmt.date(c.startsAt), to: fmt.date(c.endsAt) }))
  else if (c.endsAt) parts.push(t("sentence.until", { date: fmt.date(c.endsAt) }))
  else if (c.startsAt && new Date(c.startsAt).getTime() > Date.now()) parts.push(t("sentence.from", { date: fmt.date(c.startsAt) }))
  else parts.push(t("sentence.noEnd"))
  parts.push(c.limit === 1 ? t("sentence.once") : c.limit ? t("sentence.limit", { count: c.limit }) : t("sentence.noLimit"))
  for (const r of s.rules ?? []) parts.push(ruleText(r, t))
  const text = parts.join(", ")
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

/** The creator's answers as a coupon, so the sentence can be read before saving. */
export function wizardCoupon(w: WizardInput, dates: { startsAt: string | null; endsAt: string | null }): SentenceCoupon {
  const kind = w.kind === "percent_category" ? "percent_items" : w.kind
  return {
    shape: {
      kind,
      value: w.kind === "free_shipping" ? 100 : Number(w.value) || 0,
      currency: w.currencyCode ?? null,
      categoryIds: w.kind === "percent_category" ? w.categoryIds ?? [] : [],
      productIds: [],
      collectionIds: [],
      shippingTypeIds: [],
      shippingOptionIds: [],
      salesChannelIds: [],
      regionIds: [],
      groupIds: w.audience === "groups" ? w.groupIds ?? [] : [],
      customerIds: w.audience === "customer" && w.customerId ? [w.customerId] : [],
      minimum: w.minimum ? Number(w.minimum) : null,
      rules: [],
      otherRules: 0,
    },
    automatic: w.mode === "automatic",
    code: w.mode === "automatic" ? "" : String(w.code ?? ""),
    startsAt: dates.startsAt,
    endsAt: dates.endsAt,
    limit: w.limit ? Number(w.limit) : null,
  }
}
