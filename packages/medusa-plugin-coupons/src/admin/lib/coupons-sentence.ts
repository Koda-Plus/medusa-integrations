/**
 * EVERY COUPON IN ONE SHORT SENTENCE, for a person who reads the list at a
 * glance: what it gives and on what, the code (or that it applies by
 * itself), when, for whom, then the conditions and what it adds up with.
 * Noise is left out ("no end date", "no limit"), long lists are counted
 * ("never together with 40 other coupons"), delivery coupons read "free
 * delivery" and the member groups have one name. Everything in full is in
 * `couponFacts`, the fields of the side panel. The list, the detail, the
 * cards and the creator (live) all use these functions, so the words never
 * differ. Pure: the words come from `t`, the money and the dates from `fmt`.
 */
import type { CouponRuleDto, CouponShape, NameMaps, StoreTerms, WizardInput } from "../../modules/coupons/lib/contract"

type T = (key: string, options?: Record<string, unknown>) => string

export interface SentenceFormat {
  money: (n: number, currency: string) => string
  date: (iso: string) => string
  /**
   * A start or end as the day and the time worth saying (null: the day's
   * default or a preset), in the store's zone. Without it the sentence says
   * days only, as before.
   */
  edge?: (iso: string, edge: "start" | "end") => { date: string; time: string | null }
  /** The admin's language ("pl-PL"), for the store's own words (option memberGroupsLabel). */
  lang?: string
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

/** A field of the side panel: its label, its words, and the codes it names in full (shown on demand). */
export interface CouponFact {
  key: string
  label: string
  value: string
  codes?: string[]
}

/** At most this many codes, products or customers are named in the sentence; more are counted. */
const NAMED = 3
/** At most this many targets (pools, categories, collections) are named; more are counted. */
const TARGETS = 5

const names = (ids: readonly string[] | undefined, map: Record<string, string> | undefined) => (ids ?? []).map((id) => map?.[id] ?? id)

function list(items: string[], t: T): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} ${t("sentence.and")} ${items[items.length - 1]}`
}

const cap = (x: string) => `${x.charAt(0).toUpperCase()}${x.slice(1)}`

/** A rule with no words of its own: its field, the comparison and its values (three, then how many more). */
function describeRule(r: CouponRuleDto, t: T): string {
  const shown = r.values.slice(0, 3)
  const more = r.values.length - shown.length
  const values = more > 0 ? `${shown.join(", ")} ${t("sentence.andMore", { count: more })}` : shown.join(", ")
  return t("sentence.rule", { attribute: r.attribute, operator: t(`sentence.op.${r.operator}`, { defaultValue: r.operator }), values: values || "-" })
}

const sameGroups = (a: readonly string[], b: readonly string[]) => {
  const x = new Set(a)
  const y = new Set(b)
  return x.size > 0 && x.size === y.size && [...x].every((g) => y.has(g))
}

/** The store's words for its member groups (option memberGroupsLabel), else the plugin's own. */
function membersWord(n: NameMaps, t: T, lang: string | undefined): string {
  const l = n.members?.label
  const code = (lang ?? "").toLowerCase()
  return (l && (l[code] ?? l[code.slice(0, 2)] ?? l["*"] ?? l.en)) || t("sentence.membersDefault")
}

/** What it is on, flat: pools, categories, collections, tags, products; more than five are counted. */
function targetsOf(c: SentenceCoupon, n: NameMaps, t: T, all: boolean): string[] {
  const s = c.shape
  const pools = c.terms?.pools ?? []
  const items: string[] = [...names(pools, n.pools), ...names(s.categoryIds, n.categories)]
  for (const name of names(s.collectionIds, n.collections)) items.push(t("sentence.collection", { name }))
  /* Tags stand for the store's pools when it keeps them; on their own they are named. */
  if (!pools.length) for (const name of names(s.tagIds, n.tags)) items.push(t("sentence.tag", { name }))
  if (s.productIds.length) {
    if (all || s.productIds.length <= NAMED) items.push(...names(s.productIds, n.products))
    else items.push(t("sentence.selectedProducts", { count: s.productIds.length }))
  }
  if (all || items.length <= TARGETS) return items
  return [...items.slice(0, TARGETS - 1), t("sentence.andMore", { count: items.length - (TARGETS - 1) })]
}

/** What it gives (the first words of the sentence), with what it is on. */
function gives(c: SentenceCoupon, n: NameMaps, t: T, fmt: SentenceFormat, cur: string, all: boolean): string[] {
  const s = c.shape
  const terms = c.terms ?? null
  const pools = terms?.pools ?? []
  const targets = targetsOf(c, n, t, all)
  const what = list(targets, t)
  const delivery = list([...names(s.shippingTypeIds, n.shippingTypes), ...names(s.shippingOptionIds, n.shippingOptions)], t)
  const on = (key: string, extra: Record<string, unknown> = {}) => (delivery ? t(`${key}On`, { ...extra, list: delivery }) : t(key, extra))
  const out: string[] = []
  switch (s.kind) {
    case "percent_order":
      out.push(t("sentence.percentOrder", { value: s.value ?? 0 }))
      break
    case "fixed_order":
      out.push(t("sentence.fixedOrder", { amount: fmt.money(s.value ?? 0, cur) }))
      break
    case "free_shipping":
      out.push(on("sentence.freeShipping"))
      break
    case "percent_shipping":
      out.push(on("sentence.percentShipping", { value: s.value ?? 0 }))
      break
    case "fixed_shipping":
      out.push(on("sentence.fixedShipping", { amount: fmt.money(s.value ?? 0, cur) }))
      break
    case "percent_items":
      out.push(targets.length ? t("sentence.percentItems", { value: s.value ?? 0, what }) : t("sentence.percentItemsAll", { value: s.value ?? 0 }))
      break
    case "fixed_items": {
      const amount = fmt.money(s.value ?? 0, cur)
      out.push(targets.length ? t("sentence.fixedItems", { amount, what }) : t("sentence.fixedItemsAll", { amount }))
      break
    }
    case "buy_get": {
      const bg = terms?.buyGet ?? (s.buyGet ? { ...s.buyGet, freePrice: null } : null)
      if (!bg) out.push(t("sentence.buyGet"))
      else {
        out.push(t(terms?.buyGet ? "sentence.buyGetStore" : "sentence.buyGetOn", { buy: bg.buy, free: bg.free, what: what || t("sentence.allProducts") }))
        if (terms?.buyGet && pools.length) out.push(t("sentence.inPools", { list: list(names(pools, n.pools), t) }))
        if (bg.freePrice) out.push(t("sentence.freePrice", { amount: fmt.money(bg.freePrice, cur) }))
      }
      break
    }
    default:
      out.push(t("sentence.other"))
  }
  return out
}

/** Products left out of a discount: named up to three (all of them in the side panel), else counted. */
function without(c: SentenceCoupon, n: NameMaps, t: T, all: boolean): string | null {
  const ids = c.shape.excludedVariantIds ?? []
  if (!ids.length) return null
  if (all || ids.length <= NAMED) return t("sentence.without", { list: list(names(ids, n.variants), t) })
  return t("sentence.withoutCount", { count: ids.length })
}

/** For whom: the member groups by their one name (every group in the side panel), many customers counted. */
function audience(c: SentenceCoupon, n: NameMaps, t: T, lang: string | undefined, all: boolean): string {
  const s = c.shape
  const nobody = n.nobody ?? null
  const real = s.customerIds.filter((id) => id !== nobody)
  const excluded = s.excludedGroupIds ?? []
  const members = !all ? n.members?.ids ?? [] : []
  const groupsWord = (ids: readonly string[]) => (sameGroups(ids, members) ? membersWord(n, t, lang) : list(names(ids, n.groups), t))
  if (s.customerIds.length && !real.length) return t("sentence.forNobody")
  if (real.length) {
    if (!all && real.length > NAMED) {
      return s.groupIds.length ? t("sentence.forCustomersCountInGroups", { count: real.length, groups: groupsWord(s.groupIds) }) : t("sentence.forCustomersCount", { count: real.length })
    }
    const who = list(names(real, n.customers), t)
    return s.groupIds.length ? t("sentence.forCustomerInGroups", { customer: who, groups: groupsWord(s.groupIds) }) : t("sentence.forCustomer", { customer: who })
  }
  if (s.groupIds.length) return sameGroups(s.groupIds, members) ? t("sentence.forMembers", { members: membersWord(n, t, lang) }) : t("sentence.forGroups", { groups: groupsWord(s.groupIds) })
  if (excluded.length) return sameGroups(excluded, members) ? t("sentence.forAllButMembers", { members: membersWord(n, t, lang) }) : t("sentence.forAllBut", { groups: groupsWord(excluded) })
  return t("sentence.forEveryone")
}

/**
 * When: a single day reads "only", no dates read nothing in the sentence
 * ("no end date" in the side panel). A time shows only when it was set by
 * hand ("only on 4 Nov 2026, 10:00-14:00", "from 4 Nov 2026 10:00").
 */
function when(c: SentenceCoupon, t: T, fmt: SentenceFormat): string | null {
  const at = (iso: string, edge: "start" | "end") => (fmt.edge ? fmt.edge(iso, edge) : { date: fmt.date(iso), time: null })
  const stamp = (x: { date: string; time: string | null }) => (x.time ? t("sentence.dateTime", { date: x.date, time: x.time }) : x.date)
  if (c.startsAt && c.endsAt) {
    const from = at(c.startsAt, "start")
    const to = at(c.endsAt, "end")
    if (from.date === to.date) {
      if (from.time && to.time) return t("sentence.onlyOnHours", { date: from.date, from: from.time, to: to.time })
      if (from.time) return t("sentence.onlyOnFrom", { date: from.date, time: from.time })
      if (to.time) return t("sentence.onlyOnUntil", { date: to.date, time: to.time })
      return t("sentence.onlyOn", { date: from.date })
    }
    return t("sentence.between", { from: stamp(from), to: stamp(to) })
  }
  if (c.endsAt) return t("sentence.until", { date: stamp(at(c.endsAt, "end")) })
  if (c.startsAt && new Date(c.startsAt).getTime() > Date.now()) return t("sentence.from", { date: stamp(at(c.startsAt, "start")) })
  return null
}

/** The conditions after "for whom": price lists, pieces, channels, regions, the cart value. */
function conditions(c: SentenceCoupon, n: NameMaps, t: T, fmt: SentenceFormat, cur: string, full: boolean): string[] {
  const s = c.shape
  const terms = c.terms ?? null
  const out: string[] = []
  if (terms?.basePriceList) out.push(t("sentence.basePriceList", { name: n.priceLists?.[terms.basePriceList] ?? terms.basePriceList }))
  if (terms?.floorPriceList && terms.floorPriceList !== terms.basePriceList) out.push(t("sentence.floorPriceList", { name: n.priceLists?.[terms.floorPriceList] ?? terms.floorPriceList }))
  if (terms?.minQuantity && terms.minQuantity > 1) out.push(t(terms.perPool ? "sentence.minQuantityPerPool" : "sentence.minQuantity", { count: terms.minQuantity }))
  if (s.salesChannelIds?.length) out.push(t("sentence.salesChannels", { list: list(names(s.salesChannelIds, n.salesChannels), t) }))
  if (s.regionIds?.length) out.push(t("sentence.regions", { list: list(names(s.regionIds, n.regions), t) }))
  if (s.minimum !== null) out.push(t("sentence.minimum", { amount: fmt.money(s.minimum, cur) }))
  if (terms?.threshold) {
    const key = terms.threshold.metric === "gross" ? "sentence.thresholdGross" : "sentence.thresholdNet"
    out.push(t(full ? `${key}Full` : key, { amount: fmt.money(terms.threshold.value, cur) }))
  }
  return out
}

/** How many times: nothing in the sentence without a limit ("no limit" in the side panel). */
function uses(c: SentenceCoupon, t: T, full: boolean): string[] {
  const out: string[] = []
  if (c.limit === 1) out.push(t("sentence.once"))
  else if (c.limit) out.push(t("sentence.limit", { count: c.limit }))
  else if (full) out.push(t("sentence.noLimit"))
  if (c.terms?.perCustomerOrders) out.push(t("sentence.perCustomer", { count: c.terms.perCustomerOrders }))
  return out
}

/**
 * The codes a coupon adds up with (or never goes with) in words: delivery
 * coupons are "free delivery", all the other coupons that can still apply
 * are "other coupons", up to three are named, more are counted. `other`: the
 * codes of the other side, so delivery coupons on both sides get named
 * instead of a "free delivery" that would say yes and no.
 */
function stackWords(codes: readonly string[], other: readonly string[], self: string, n: NameMaps, t: T): string[] {
  const known = n.couponCodes ?? {}
  const up = (x: string) => x.trim().toUpperCase()
  const shipping = codes.filter((x) => known[up(x)]?.shipping)
  const rest = codes.filter((x) => !known[up(x)]?.shipping)
  const words: string[] = []
  if (shipping.length) {
    const both = other.some((x) => known[up(x)]?.shipping)
    words.push(!both ? t("sentence.stackShipping") : shipping.length <= NAMED ? list(shipping, t) : t("sentence.stackShippingCount", { count: shipping.length }))
  }
  if (rest.length) {
    const picked = new Set(rest.map(up))
    const others = Object.entries(known)
      .filter(([code, k]) => !k.shipping && k.live && code !== up(self))
      .map(([code]) => code)
    if (others.length && others.every((code) => picked.has(code))) words.push(t("sentence.stackAll"))
    else if (rest.length <= NAMED) words.push(...rest)
    else words.push(t("sentence.stackCount", { count: rest.length }))
  }
  return words
}

function stacking(c: SentenceCoupon, n: NameMaps, t: T): { with: string | null; never: string | null } {
  const w = c.terms?.combines?.with ?? []
  const nv = c.terms?.combines?.never ?? []
  const ww = stackWords(w, nv, c.code, n, t)
  const nn = stackWords(nv, w, c.code, n, t)
  return { with: ww.length ? list(ww, t) : null, never: nn.length ? list(nn, t) : null }
}

function storeRuleOf(c: SentenceCoupon, n: NameMaps) {
  const rule = c.id ? n.storeRules?.[c.id] : undefined
  const text = rule?.text?.trim().replace(/[.\s]+$/, "") ?? ""
  /* The store applies its own rule and Medusa keeps a marker: the rule, its own sentence, takes the discount's place. */
  return { text, replaces: Boolean(rule?.replacesDiscount && text) }
}

/**
 * `forCustomer`: the words for the customer herself (the e-mail with the
 * code): who else the coupon is for and the code are left out, she reads the
 * code next to it.
 */
export function couponSentence(c: SentenceCoupon, n: NameMaps, t: T, fmt: SentenceFormat, currency: string, opts: { forCustomer?: boolean } = {}): string {
  const s = c.shape
  const cur = s.currency ?? currency
  const rule = storeRuleOf(c, n)
  const parts: string[] = []
  if (!rule.replaces) parts.push(...gives(c, n, t, fmt, cur, false))
  const left = without(c, n, t, false)
  if (left) parts.push(left)
  if (!opts.forCustomer) parts.push(c.automatic || !c.code ? t("sentence.automatic") : t("sentence.withCode", { code: c.code }))
  const period = when(c, t, fmt)
  if (period) parts.push(period)
  if (!opts.forCustomer) parts.push(audience(c, n, t, fmt.lang, false))
  parts.push(...conditions(c, n, t, fmt, cur, false))
  parts.push(...uses(c, t, false))
  const st = stacking(c, n, t)
  if (st.with) parts.push(t("sentence.combinesWith", { list: st.with }))
  if (st.never) parts.push(t("sentence.combinesNever", { list: st.never }))
  for (const r of s.rules ?? []) parts.push(describeRule(r, t))
  const text = parts.join(", ")
  if (rule.replaces) return `${cap(rule.text)}. ${cap(text)}.`
  /* A rule of the store that does not replace the discount: after the sentence, as its own. */
  const extra = rule.text ? ` ${t("sentence.storeRule", { text: rule.text })}.` : ""
  return `${cap(text)}.${extra}`
}

/**
 * The coupon in full, field by field, for the side panel: every group,
 * product and date by name, "no end date" and "no limit" said, and the codes
 * it adds up with or never goes with in `codes` (shown on demand).
 */
export function couponFacts(c: SentenceCoupon, n: NameMaps, t: T, fmt: SentenceFormat, currency: string): CouponFact[] {
  const s = c.shape
  const cur = s.currency ?? currency
  const out: CouponFact[] = []
  const add = (key: string, value: string | null | undefined, codes?: readonly string[]) => {
    if (value) out.push({ key, label: t(`facts.${key}`), value: cap(value), ...(codes?.length ? { codes: [...codes] } : {}) })
  }
  const rule = storeRuleOf(c, n)
  add("value", rule.replaces ? rule.text : gives(c, n, t, fmt, cur, true).join(", "))
  add("without", without(c, n, t, true))
  add("audience", audience(c, n, t, fmt.lang, true))
  add("mode", c.automatic || !c.code ? t("sentence.automatic") : t("sentence.withCode", { code: c.code }))
  add("validity", when(c, t, fmt) ?? t("sentence.noEnd"))
  add("conditions", conditions(c, n, t, fmt, cur, true).join(", "))
  add("uses", uses(c, t, true).join(", "))
  const st = stacking(c, n, t)
  add("combinesWith", st.with, c.terms?.combines?.with)
  add("combinesNever", st.never, c.terms?.combines?.never)
  if (rule.text && !rule.replaces) add("storeRule", rule.text)
  add("rules", (s.rules ?? []).map((r) => describeRule(r, t)).join(", "))
  return out
}

/** The creator's answers as a coupon, so the sentence can be read before saving. */
export function wizardCoupon(w: WizardInput, dates: { startsAt: string | null; endsAt: string | null }, ctx: { memberGroupIds?: readonly string[]; storeBuyGet?: boolean } = {}): SentenceCoupon {
  const kind = w.kind === "percent_category" || w.kind === "percent_pools" ? "percent_items" : w.kind
  const members = [...(ctx.memberGroupIds ?? [])]
  const customers = [...new Set([...(w.customerIds ?? []), ...(w.customerId ? [w.customerId] : [])])]
  const pools = w.kind === "percent_pools" || (w.kind === "buy_get" && ctx.storeBuyGet) ? w.poolIds ?? [] : []
  const excludedVariantIds = w.kind === "percent_pools" ? [...new Set(w.excludedVariantIds ?? [])] : []
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
      excludedVariantIds,
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
