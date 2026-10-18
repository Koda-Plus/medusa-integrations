/**
 * EDITING a coupon, all through Medusa's own promotion workflows: the
 * promotion (code, code or automatic, value, its own limit), its campaign
 * (dates, a usage budget) and its audience and minimum rules. What the form
 * does not show (targets, buy X get Y, other rules) is never written.
 */

import { batchPromotionRulesWorkflow, createCampaignsWorkflow, updateCampaignsWorkflow, updatePromotionsWorkflow } from "@medusajs/medusa/core-flows"
import type { CouponDto, CouponPatch } from "../../modules/coupons/lib/contract"
import { toCouponDto } from "../../modules/coupons/lib/describe"
import { checkPatch, editWarnings, limitLivesIn, patchIsEmpty, ruleChanges, type RuleRow } from "../../modules/coupons/lib/edit"
import { CouponInputError } from "./create"
import { readPromotions } from "./reads"
import { couponsService, promotionModule, queryOf, type Scope } from "./runtime"

type WorkflowScope = Parameters<typeof updatePromotionsWorkflow>[0]

async function ruleRows(scope: Scope, id: string): Promise<RuleRow[]> {
  const { data } = await queryOf(scope).graph({ entity: "promotion", fields: ["id", "rules.id", "rules.attribute", "rules.operator"], filters: { id } })
  const p = (data?.[0] ?? {}) as { rules?: Array<{ id?: string; attribute?: string; operator?: string }> }
  return (p.rules ?? []).filter((r) => r?.id).map((r) => ({ id: String(r.id), attribute: String(r.attribute ?? ""), operator: String(r.operator ?? "") }))
}

export async function updateCoupon(scope: Scope, id: string, patch: CouponPatch, now: Date = new Date()): Promise<{ coupon: CouponDto; warnings: string[]; changed: boolean }> {
  const [before] = await readPromotions(scope, { id }, 1)
  if (!before) throw new CouponInputError(404, ["not_found"], "No such coupon.")
  const current = toCouponDto(before, undefined, now)

  const check = checkPatch(patch ?? {}, current)
  if (!check.ok || !check.value) throw new CouponInputError(400, check.errors, `The coupon was not changed: ${check.errors.join(", ")}.`)
  const p = check.value
  if (patchIsEmpty(p)) return { coupon: current, warnings: [], changed: false }

  if (p.code) {
    const same = await promotionModule(scope).listPromotions({ code: p.code }, { take: 1 })
    if (same.some((x: { id?: string }) => x.id !== id)) throw new CouponInputError(409, ["code_taken"], `The code ${p.code} is taken.`)
  }

  const ws = scope as WorkflowScope
  const promotion: Record<string, unknown> = { id }
  if (p.code) promotion.code = p.code
  if (p.automatic !== undefined) promotion.is_automatic = p.automatic
  if (p.value !== undefined) promotion.application_method = { value: p.value }

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

  const rules = ruleChanges(p, await ruleRows(scope, id))
  if (rules.create.length || rules.delete.length) {
    await batchPromotionRulesWorkflow(ws).run({ input: { id, rule_type: "rules", create: rules.create, update: [], delete: rules.delete } as never })
  }

  const [after] = await readPromotions(scope, { id }, 1)
  if (!after) throw new CouponInputError(500, ["not_saved"], "Medusa did not return the coupon.")
  couponsService(scope).getLogger().info(`[coupons] Edited ${after.code ?? id} (${id}): ${Object.keys(p).join(", ")}.`)
  return { coupon: toCouponDto(after, undefined, now), warnings: editWarnings(p, current), changed: true }
}
