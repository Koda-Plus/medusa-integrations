/**
 * EDITING a coupon: what the edit form may change, checked, and turned into
 * the writes of Medusa's own workflows. Pure (no Medusa imports): the admin
 * runs the same checks live, the server runs them again before it writes.
 *
 * The form edits what a person changes day to day: the code, code or
 * automatic, the value, the dates, the uses allowed, the order minimum and
 * who it is for (groups, customers). Everything else of a promotion (product
 * or category targets, buy X get Y, sales channels, other rules) is kept as
 * it is; those stay on Medusa's own promotion page.
 */
import { MINIMUM_ATTRIBUTES, RULE } from "./constants"
import type { CouponDto, CouponPatch } from "./contract"
import { cleanCode } from "./wizard"

const CODE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/
const ID = /^[A-Za-z0-9_]{1,80}$/

/** Kinds whose value the form may change (a percent or an amount). */
export const VALUE_KINDS = ["percent_order", "fixed_order", "percent_shipping", "fixed_shipping", "percent_items", "fixed_items"] as const

export function valueEditable(c: Pick<CouponDto, "shape">): boolean {
  return (VALUE_KINDS as readonly string[]).includes(c.shape.kind)
}

export function isPercent(c: Pick<CouponDto, "shape">): boolean {
  return c.shape.kind.startsWith("percent_")
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
const ids = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => ID.test(x)))]

/**
 * Checks the form against the coupon as it is now. Keys missing from the
 * patch stay untouched; keys equal to the current value are dropped, so a
 * save of an unchanged form writes nothing.
 */
export function checkPatch(patch: CouponPatch, current: CouponDto): PatchCheck {
  const errors: string[] = []
  const out: NormalizedPatch = {}

  if (patch.code !== undefined) {
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
    if (!valueEditable(current)) errors.push("value_fixed")
    else if (isPercent(current) ? !(Number.isFinite(v) && v > 0 && v <= 100) : !(Number.isFinite(v) && v > 0)) errors.push(isPercent(current) ? "percent" : "amount")
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
    const c = ids(patch.customerIds)
    if (!sameSet(c, current.shape.customerIds)) out.customerIds = c
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
  create: Array<{ attribute: string; operator: "in" | "gte"; values: string[] }>
  delete: string[]
}

/**
 * The audience and minimum rules to delete and create. Only the rules of an
 * attribute the patch changes are touched, and only in the form the plugin
 * reads them (in/eq; gte/gt for the minimum): an exclusion (ne) stays.
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
  if (p.customerIds !== undefined) {
    drop((r) => (r.attribute === RULE.customer || r.attribute === RULE.customerAlt) && (r.operator === "in" || r.operator === "eq"))
    if (p.customerIds.length) out.create.push({ attribute: RULE.customer, operator: "in", values: p.customerIds })
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
  const audienceAfter = (p.groupIds ?? current.shape.groupIds).length + (p.customerIds ?? current.shape.customerIds).length
  if (automaticAfter && audienceAfter === 0 && (p.automatic === true || p.groupIds !== undefined || p.customerIds !== undefined)) out.push("automatic_everyone")
  const groupsAfter = p.groupIds ?? current.shape.groupIds
  const customersAfter = p.customerIds ?? current.shape.customerIds
  const hadAudience = current.shape.groupIds.length + current.shape.customerIds.length > 0
  if (hadAudience && groupsAfter.length + customersAfter.length === 0) out.push("audience_widened")
  if (p.dates && current.campaign) out.push("campaign_dates")
  return out
}
