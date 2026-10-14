/**
 * EVERY COUPON IN ONE PLAIN SENTENCE: what it gives, for whom, how it works,
 * from what amount, until when and how many times. The list, the detail, the
 * cards and the creator (live, while the steps are filled) all use this one
 * function, so the words never differ. Pure: the words come from `t`, the
 * money and the dates from `fmt`.
 */
import type { CouponShape, NameMaps, WizardInput } from "../../modules/coupons/lib/contract"

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

const names = (ids: string[], map: Record<string, string>) => ids.map((id) => map[id] ?? id)

function list(items: string[], t: T): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} ${t("sentence.and")} ${items[items.length - 1]}`
}

export function couponSentence(c: SentenceCoupon, n: NameMaps, t: T, fmt: SentenceFormat, currency: string): string {
  const s = c.shape
  const cur = s.currency ?? currency
  const what = s.categoryIds.length
    ? list(names(s.categoryIds, n.categories), t)
    : s.productIds.length
      ? s.productIds.length <= 3
        ? list(names(s.productIds, n.products), t)
        : t("sentence.selectedProducts")
      : t("sentence.allProducts")
  const parts: string[] = []
  switch (s.kind) {
    case "percent_order":
      parts.push(t("sentence.percentOrder", { value: s.value ?? 0 }))
      break
    case "fixed_order":
      parts.push(t("sentence.fixedOrder", { amount: fmt.money(s.value ?? 0, cur) }))
      break
    case "free_shipping":
      parts.push(t("sentence.freeShipping"))
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
  if (s.otherRules > 0) parts.push(t("sentence.otherRules", { count: s.otherRules }))
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
      groupIds: w.audience === "groups" ? w.groupIds ?? [] : [],
      customerIds: w.audience === "customer" && w.customerId ? [w.customerId] : [],
      minimum: w.minimum ? Number(w.minimum) : null,
      otherRules: 0,
    },
    automatic: w.mode === "automatic",
    code: w.mode === "automatic" ? "" : String(w.code ?? ""),
    startsAt: dates.startsAt,
    endsAt: dates.endsAt,
    limit: w.limit ? Number(w.limit) : null,
  }
}
