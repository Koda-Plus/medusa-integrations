/**
 * EDITING a coupon, all through Medusa's own promotion workflows: the
 * promotion (code, code or automatic, value, buy X get Y, its own limit),
 * its campaign (dates, a usage budget), its audience and minimum rules, its
 * target rules (categories, the store's pools, products left out) and the store's own terms
 * through the store's adapter. What the form does not show is never written.
 */

import { batchPromotionRulesWorkflow, createCampaignsWorkflow, updateCampaignsWorkflow, updatePromotionsWorkflow } from "@medusajs/medusa/core-flows"
import type { CouponDto, CouponPatch } from "../../modules/coupons/lib/contract"
import { checkPatch, editWarnings, limitLivesIn, patchIsEmpty, ruleChanges, targetChanges, type NormalizedPatch, type RuleRow } from "../../modules/coupons/lib/edit"
import { poolTargetRules } from "../../modules/coupons/lib/wizard"
import { CouponInputError } from "./errors"
import { readPromotions, toCoupons } from "./reads"
import { couponsService, promotionModule, queryOf, type Scope } from "./runtime"
import { poolAttributes, storeLookups, writeTerms } from "./terms"

type WorkflowScope = Parameters<typeof updatePromotionsWorkflow>[0]

async function ruleRows(scope: Scope, id: string): Promise<{ rules: RuleRow[]; targets: RuleRow[]; buys: RuleRow[] }> {
  const { data } = await queryOf(scope).graph({
    entity: "promotion",
    fields: [
      "id",
      "rules.id",
      "rules.attribute",
      "rules.operator",
      "application_method.target_rules.id",
      "application_method.target_rules.attribute",
      "application_method.target_rules.operator",
      "application_method.buy_rules.id",
      "application_method.buy_rules.attribute",
      "application_method.buy_rules.operator",
    ],
    filters: { id },
  })
  type R = { id?: string; attribute?: string; operator?: string }
  const p = (data?.[0] ?? {}) as { rules?: R[]; application_method?: { target_rules?: R[]; buy_rules?: R[] } }
  const rows = (list: R[] | undefined) => (list ?? []).filter((r) => r?.id).map((r) => ({ id: String(r.id), attribute: String(r.attribute ?? ""), operator: String(r.operator ?? "") }))
  return { rules: rows(p.rules), targets: rows(p.application_method?.target_rules), buys: rows(p.application_method?.buy_rules) }
}

/**
 * Writes a checked patch onto promotion `id`. Shared by the edit form and
 * by a copy (./duplicate.ts), which writes the form's changes on the copy.
 */
export async function applyPatch(scope: Scope, id: string, before: { code?: string | null; limit?: number | null; campaign?: { id?: string | null; budget?: { type?: string | null } | null } | null }, current: CouponDto, p: NormalizedPatch): Promise<void> {
  const ws = scope as WorkflowScope
  const promotion: Record<string, unknown> = { id }
  if (p.code) promotion.code = p.code
  if (p.automatic !== undefined) promotion.is_automatic = p.automatic
  const am: Record<string, unknown> = {}
  if (p.value !== undefined) am.value = p.value
  if (p.buyGet) {
    am.buy_rules_min_quantity = p.buyGet.buy
    am.apply_to_quantity = p.buyGet.free
    am.max_quantity = p.buyGet.free
  }
  if (Object.keys(am).length) promotion.application_method = am

  const limitIn = limitLivesIn(before)
  if (p.limit !== undefined && limitIn === "promotion") promotion.limit = p.limit

  /* Dates live in the campaign: change it, or start one when the coupon had none. */
  const campaignId = before.campaign?.id ?? null
  const campaignUpdate: Record<string, unknown> = {}
  if (p.dates && campaignId) {
    campaignUpdate.starts_at = p.dates.startsAt
    campaignUpdate.ends_at = p.dates.endsAt
  } else if (p.dates && (p.dates.startsAt || p.dates.endsAt)) {
    const code = String(p.code ?? before.code ?? id)
    const { result } = await createCampaignsWorkflow(ws).run({
      input: {
        campaignsData: [
          {
            name: code,
            campaign_identifier: `koda-coupons-${code.toLowerCase()}-${Date.now().toString(36)}`,
            starts_at: p.dates.startsAt,
            ends_at: p.dates.endsAt,
          },
        ],
      } as never,
    })
    const created = String((result as Array<{ id: string }>)[0]?.id ?? "")
    if (created) promotion.campaign_id = created
  }
  if (p.limit !== undefined && limitIn === "campaign" && campaignId) campaignUpdate.budget = { limit: p.limit }

  if (Object.keys(promotion).length > 1) await updatePromotionsWorkflow(ws).run({ input: { promotionsData: [promotion] } as never })
  if (campaignId && Object.keys(campaignUpdate).length) await updateCampaignsWorkflow(ws).run({ input: { campaignsData: [{ id: campaignId, ...campaignUpdate }] } as never })

  const rows = await ruleRows(scope, id)
  const rules = ruleChanges(p, rows.rules)
  if (rules.create.length || rules.delete.length) {
    await batchPromotionRulesWorkflow(ws).run({ input: { id, rule_type: "rules", create: rules.create, update: [], delete: rules.delete } as never })
  }

  if (p.categoryIds !== undefined || p.poolIds !== undefined || p.excludedVariantIds !== undefined) {
    const { pools } = p.poolIds !== undefined ? await storeLookups(scope) : { pools: [] }
    const poolRules = p.poolIds !== undefined ? (poolTargetRules(p.poolIds, pools) as Array<{ attribute: string; operator: "in"; values: string[] }>) : []
    const changes = targetChanges(p, rows.targets, { attrs: poolAttributes(pools), rules: poolRules })
    if (changes.create.length || changes.delete.length) {
      await batchPromotionRulesWorkflow(ws).run({ input: { id, rule_type: "target_rules", create: changes.create, update: [], delete: changes.delete } as never })
    }
    /* Medusa's own buy X get Y counts the same categories it gives. */
    if (current.shape.kind === "buy_get" && !current.terms?.buyGet && p.categoryIds !== undefined) {
      const buys = targetChanges({ categoryIds: p.categoryIds }, rows.buys, { attrs: [], rules: [] })
      if (buys.create.length || buys.delete.length) {
        await batchPromotionRulesWorkflow(ws).run({ input: { id, rule_type: "buy_rules", create: buys.create, update: [], delete: buys.delete } as never })
      }
    }
  }

  if (p.terms) await writeTerms(scope, id, p.terms, { code: String(p.code ?? before.code ?? ""), kind: current.terms?.buyGet ? "store_buy_get" : current.shape.kind })
}

export async function updateCoupon(scope: Scope, id: string, patch: CouponPatch, now: Date = new Date()): Promise<{ coupon: CouponDto; warnings: string[]; changed: boolean }> {
  const [before] = await readPromotions(scope, { id }, 1)
  if (!before) throw new CouponInputError(404, ["not_found"], "No such coupon.")
  const [current] = await toCoupons(scope, [before], undefined, now)

  const o = couponsService(scope).getOptions()
  const check = checkPatch(patch ?? {}, current, { features: o.storeTerms?.features ?? [], nobody: o.nobodyCustomerId })
  if (!check.ok || !check.value) throw new CouponInputError(400, check.errors, `The coupon was not changed: ${check.errors.join(", ")}.`)
  const p = check.value
  if (patchIsEmpty(p)) return { coupon: current, warnings: [], changed: false }

  if (p.code) {
    const same = await promotionModule(scope).listPromotions({ code: p.code }, { take: 1 })
    if (same.some((x: { id?: string }) => x.id !== id)) throw new CouponInputError(409, ["code_taken"], `The code ${p.code} is taken.`)
  }

  await applyPatch(scope, id, before, current, p)

  const [after] = await readPromotions(scope, { id }, 1)
  if (!after) throw new CouponInputError(500, ["not_saved"], "Medusa did not return the coupon.")
  couponsService(scope).getLogger().info(`[coupons] Edited ${after.code ?? id} (${id}): ${Object.keys(p).join(", ")}.`)
  const [coupon] = await toCoupons(scope, [after], undefined, now)
  return { coupon, warnings: editWarnings(p, current), changed: true }
}
