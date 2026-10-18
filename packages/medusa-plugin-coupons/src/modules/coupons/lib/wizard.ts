/**
 * THE CREATOR: the three steps (type, audience, rules) checked, turned into
 * a standard Medusa promotion, and the warnings a person should read before
 * saving. Pure (no Medusa imports): the admin runs the same checks and
 * warnings live, the server runs them again before it writes anything.
 *
 * Everything the creator saves is an ordinary promotion of Medusa's
 * promotion module, so the cart, the order, invoices and every other module
 * see it the way they see a promotion made by hand.
 */

import { RULE } from "./constants"
import type { CouponDto, WizardInput } from "./contract"

export interface NormalizedWizard {
  kind: WizardInput["kind"]
  value: number
  categoryIds: string[]
  audience: WizardInput["audience"]
  groupIds: string[]
  customerId: string | null
  automatic: boolean
  code: string
  startsAt: Date | null
  endsAt: Date | null
  limit: number | null
  minimum: number | null
  currencyCode: string
}

export interface WizardCheck {
  ok: boolean
  /** Keys of the admin dictionary: `wizard.error.<key>`. */
  errors: string[]
  value: NormalizedWizard | null
}

const CODE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/
const ID = /^[A-Za-z0-9_]{1,80}$/

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

/** A code suggestion from the step answers: PREFIX-KIND-VALUE, e.g. SHOP-15OFF. */
export function suggestCode(input: Pick<WizardInput, "kind" | "value">, prefix: string | null): string {
  const v = Math.round(Number(input.value) || 0)
  const body = input.kind === "free_shipping" ? "DOSTAWA0" : input.kind === "fixed_order" ? `MINUS${v}` : `${v}OFF`
  return cleanCode(prefix ? `${prefix}-${body}` : body)
}

export function checkWizard(input: WizardInput, opts: { now?: Date; currencyCode: string }): WizardCheck {
  const errors: string[] = []
  const now = opts.now ?? new Date()
  const kind = input.kind
  if (!["percent_order", "fixed_order", "free_shipping", "percent_category"].includes(kind)) errors.push("kind")
  const value = kind === "free_shipping" ? 100 : Number(input.value)
  if (kind === "percent_order" || kind === "percent_category") {
    if (!Number.isFinite(value) || value <= 0 || value > 100) errors.push("percent")
  } else if (kind === "fixed_order") {
    if (!Number.isFinite(value) || value <= 0) errors.push("amount")
  }
  const categoryIds = (input.categoryIds ?? []).filter((c) => ID.test(c))
  if (kind === "percent_category" && categoryIds.length === 0) errors.push("category")

  const audience = input.audience
  if (!["everyone", "groups", "customer"].includes(audience)) errors.push("audience")
  const groupIds = (input.groupIds ?? []).filter((g) => ID.test(g))
  if (audience === "groups" && groupIds.length === 0) errors.push("groups")
  const customerId = input.customerId && ID.test(input.customerId) ? input.customerId : null
  if (audience === "customer" && !customerId) errors.push("customer")

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

  if (errors.length) return { ok: false, errors: [...new Set(errors)], value: null }
  return {
    ok: true,
    errors: [],
    value: { kind, value, categoryIds, audience, groupIds: audience === "groups" ? groupIds : [], customerId: audience === "customer" ? customerId : null, automatic, code, startsAt, endsAt, limit, minimum, currencyCode },
  }
}

type RuleInput = { attribute: string; operator: "in" | "eq" | "gte"; values: string[] }

/** The input of Medusa's createPromotionsWorkflow, and the campaign that holds the dates (when there are any). */
export function promotionInput(w: NormalizedWizard): {
  promotion: {
    code: string
    type: "standard"
    status: "active"
    is_automatic: boolean
    limit?: number | null
    application_method: Record<string, unknown>
    rules: RuleInput[]
  }
  campaign: { name: string; campaign_identifier: string; starts_at: Date | null; ends_at: Date | null } | null
} {
  const rules: RuleInput[] = []
  if (w.groupIds.length) rules.push({ attribute: RULE.groups, operator: "in", values: w.groupIds })
  if (w.customerId) rules.push({ attribute: RULE.customer, operator: "eq", values: [w.customerId] })
  if (w.minimum !== null) rules.push({ attribute: RULE.minimum, operator: "gte", values: [String(w.minimum)] })

  let application_method: Record<string, unknown>
  if (w.kind === "free_shipping") {
    application_method = { type: "percentage", target_type: "shipping_methods", allocation: "across", value: 100 }
  } else if (w.kind === "fixed_order") {
    application_method = { type: "fixed", target_type: "order", allocation: "across", value: w.value, currency_code: w.currencyCode }
    /* Medusa asks for the currency of an amount as a rule too (its own creator adds it). */
    rules.push({ attribute: RULE.currency, operator: "eq", values: [w.currencyCode] })
  } else if (w.kind === "percent_category") {
    application_method = {
      type: "percentage",
      target_type: "items",
      allocation: "across",
      value: w.value,
      target_rules: [{ attribute: RULE.category, operator: "in", values: w.categoryIds }],
    }
  } else {
    application_method = { type: "percentage", target_type: "order", allocation: "across", value: w.value }
  }

  return {
    promotion: {
      code: w.code,
      type: "standard",
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

/**
 * What a person should read before saving. Keys of `wizard.warning.<key>`.
 * `active` are the store's coupons active today (from the list), for the
 * checks that compare with them.
 */
export function wizardWarnings(input: WizardInput, ctx: { active: readonly CouponDto[]; memberGroupIds: readonly string[] }): string[] {
  const out: string[] = []
  const automatic = input.mode === "automatic"
  const value = Number(input.value) || 0
  const groups = input.groupIds ?? []
  if (automatic && input.audience === "everyone") out.push("automatic_everyone")
  if (automatic && input.audience === "groups" && ctx.memberGroupIds.length > 0 && groups.some((g) => ctx.memberGroupIds.includes(g))) out.push("automatic_members")
  const target = input.kind === "free_shipping" ? "shipping" : input.kind === "percent_category" ? "items" : "order"
  const overlaps = ctx.active.filter((c) => {
    if (c.status !== "active" || !c.automatic) return false
    const t = ["free_shipping", "percent_shipping", "fixed_shipping"].includes(c.shape.kind) ? "shipping" : c.shape.kind === "percent_items" || c.shape.kind === "fixed_items" ? "items" : "order"
    return t === target || (target === "order" && t === "items") || (target === "items" && t === "order")
  })
  if (overlaps.length > 0) out.push("stacking")
  if ((input.kind === "percent_order" || input.kind === "percent_category") && value >= 50) out.push("big_percent")
  if (input.kind === "fixed_order" && (input.minimum === null || input.minimum === undefined || Number(input.minimum) < value)) out.push("fixed_without_minimum")
  if (input.validity === "none" && (input.limit === null || input.limit === undefined || Number(input.limit) === 0) && input.audience === "everyone") out.push("no_end")
  if (ctx.active.some((c) => c.code && c.code.toUpperCase() === cleanCode(input.code))) out.push("code_taken")
  return out
}
