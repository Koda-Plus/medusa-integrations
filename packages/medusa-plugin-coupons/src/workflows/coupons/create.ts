/**
 * THE WRITES of Coupons by Koda Plus, all through Medusa's own promotion
 * workflows: a coupon is created as a standard promotion (and a campaign
 * holding its dates, when it has any), and paused or turned back on by its
 * status. Editing lives in ./update.ts; deleting, and the conditions the
 * edit form does not show, stay on Medusa's own promotion page.
 */

import { createCampaignsWorkflow, createPromotionsWorkflow, updatePromotionsWorkflow } from "@medusajs/medusa/core-flows"
import type { CouponDto, WizardInput } from "../../modules/coupons/lib/contract"
import { toCouponDto } from "../../modules/coupons/lib/describe"
import { checkWizard, promotionInput, wizardWarnings } from "../../modules/coupons/lib/wizard"
import { readPromotions } from "./reads"
import { couponsService, promotionModule, type Scope } from "./runtime"

export class CouponInputError extends Error {
  readonly status: number
  readonly errors: string[]
  constructor(status: number, errors: string[], message: string) {
    super(message)
    this.name = "CouponInputError"
    this.status = status
    this.errors = errors
  }
}

type WorkflowScope = Parameters<typeof createPromotionsWorkflow>[0]

export async function createCoupon(scope: Scope, input: WizardInput, now: Date = new Date()): Promise<{ coupon: CouponDto; warnings: string[] }> {
  const o = couponsService(scope).getOptions()
  const check = checkWizard(input, { now, currencyCode: o.currencyCode })
  if (!check.ok || !check.value) throw new CouponInputError(400, check.errors, `The coupon is not complete: ${check.errors.join(", ")}.`)
  const w = check.value

  /* Medusa keeps codes unique; say it in words before its error does. */
  const same = await promotionModule(scope).listPromotions({ code: w.code }, { take: 1 })
  if (same.length > 0) throw new CouponInputError(409, ["code_taken"], `The code ${w.code} is taken.`)

  const existing = (await readPromotions(scope)).map((p) => toCouponDto(p, undefined, now))
  const warnings = wizardWarnings(input, { active: existing, memberGroupIds: o.memberGroupIds })

  const { promotion, campaign } = promotionInput(w)
  let campaignId: string | null = null
  if (campaign) {
    const { result } = await createCampaignsWorkflow(scope as WorkflowScope).run({ input: { campaignsData: [campaign] } as never })
    campaignId = String((result as Array<{ id: string }>)[0]?.id ?? "") || null
  }
  const { result } = await createPromotionsWorkflow(scope as WorkflowScope).run({
    input: { promotionsData: [{ ...promotion, ...(campaignId ? { campaign_id: campaignId } : {}) }] } as never,
  })
  const id = String((result as Array<{ id: string }>)[0]?.id ?? "")
  const [created] = await readPromotions(scope, { id }, 1)
  if (!created) throw new CouponInputError(500, ["not_saved"], "Medusa did not return the new promotion.")
  couponsService(scope).getLogger().info(`[coupons] Created ${w.code} (${id})${campaignId ? ` in campaign ${campaignId}` : ""}.`)
  return { coupon: toCouponDto(created, undefined, now), warnings: warnings.filter((x) => x !== "code_taken") }
}

/** Pause (inactive) or turn back on (active). Expired coupons stay expired: their dates live in the campaign. */
export async function setCouponStatus(scope: Scope, id: string, status: "active" | "inactive"): Promise<CouponDto> {
  await updatePromotionsWorkflow(scope as WorkflowScope).run({ input: { promotionsData: [{ id, status }] } as never })
  const [p] = await readPromotions(scope, { id }, 1)
  if (!p) throw new CouponInputError(404, ["not_found"], "No such coupon.")
  return toCouponDto(p, undefined)
}
