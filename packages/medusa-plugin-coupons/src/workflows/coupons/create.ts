/**
 * THE WRITES of Coupons by Koda Plus, all through Medusa's own promotion
 * workflows: a coupon is created as a standard promotion (and a campaign
 * holding its dates, when it has any), the store's own terms go to the
 * store's adapter next to it, and a coupon is paused or turned back on by
 * its status. Editing lives in ./update.ts, copies in ./duplicate.ts,
 * deleting an unused coupon in ./delete.ts.
 */

import { createCampaignsWorkflow, createPromotionsWorkflow, deletePromotionsWorkflow, updatePromotionsWorkflow } from "@medusajs/medusa/core-flows"
import type { CouponDto, WizardInput } from "../../modules/coupons/lib/contract"
import { checkWizard, promotionInput, savedKind, wizardWarnings } from "../../modules/coupons/lib/wizard"
import { CouponInputError } from "./errors"
import { readPromotions, toCoupons } from "./reads"
import { couponsService, promotionModule, type Scope } from "./runtime"
import { storeLookups, writeTerms } from "./terms"

export { CouponInputError }

type WorkflowScope = Parameters<typeof createPromotionsWorkflow>[0]

export async function createCoupon(scope: Scope, input: WizardInput, now: Date = new Date()): Promise<{ coupon: CouponDto; warnings: string[] }> {
  const o = couponsService(scope).getOptions()
  const features = o.storeTerms?.features ?? []
  const check = checkWizard(input, { now, currencyCode: o.currencyCode, memberGroupIds: o.memberGroupIds, features })
  if (!check.ok || !check.value) throw new CouponInputError(400, check.errors, `The coupon is not complete: ${check.errors.join(", ")}.`)
  const w = check.value

  /* Medusa keeps codes unique; say it in words before its error does. */
  const same = await promotionModule(scope).listPromotions({ code: w.code }, { take: 1 })
  if (same.length > 0) throw new CouponInputError(409, ["code_taken"], `The code ${w.code} is taken.`)

  const existing = await toCoupons(scope, await readPromotions(scope), undefined, now)
  const warnings = wizardWarnings(input, { active: existing, memberGroupIds: o.memberGroupIds, features })

  const storeBuyGet = features.includes("buyGet")
  const { pools } = w.poolIds.length ? await storeLookups(scope) : { pools: [] }
  const { promotion, campaign } = promotionInput(w, { buyGetMarker: storeBuyGet && o.storeTerms ? o.storeTerms.buyGetMarker : null, pools })
  let campaignId: string | null = null
  if (campaign) {
    const { result } = await createCampaignsWorkflow(scope as WorkflowScope).run({ input: { campaignsData: [campaign] } as never })
    campaignId = String((result as Array<{ id: string }>)[0]?.id ?? "") || null
  }
  const { result } = await createPromotionsWorkflow(scope as WorkflowScope).run({
    input: { promotionsData: [{ ...promotion, ...(campaignId ? { campaign_id: campaignId } : {}) }] } as never,
  })
  const id = String((result as Array<{ id: string }>)[0]?.id ?? "")

  /* The store's terms belong to the coupon: without them it would work differently, so no half-saved coupon stays. */
  if (w.terms) {
    try {
      await writeTerms(scope, id, w.terms, { code: w.code, kind: savedKind(w, storeBuyGet) })
    } catch (err) {
      await deletePromotionsWorkflow(scope as WorkflowScope).run({ input: { ids: [id] } as never }).catch(() => undefined)
      throw err
    }
  }

  const [created] = await readPromotions(scope, { id }, 1)
  if (!created) throw new CouponInputError(500, ["not_saved"], "Medusa did not return the new promotion.")
  couponsService(scope).getLogger().info(`[coupons] Created ${w.code} (${id})${campaignId ? ` in campaign ${campaignId}` : ""}${w.terms ? " with the store's terms" : ""}.`)
  const [coupon] = await toCoupons(scope, [created], undefined, now)
  return { coupon, warnings: warnings.filter((x) => x !== "code_taken") }
}

/** Pause (inactive) or turn back on (active). Expired coupons stay expired: their dates live in the campaign. */
export async function setCouponStatus(scope: Scope, id: string, status: "active" | "inactive"): Promise<CouponDto> {
  await updatePromotionsWorkflow(scope as WorkflowScope).run({ input: { promotionsData: [{ id, status }] } as never })
  const [p] = await readPromotions(scope, { id }, 1)
  if (!p) throw new CouponInputError(404, ["not_found"], "No such coupon.")
  couponsService(scope).getLogger().info(`[coupons] ${status === "inactive" ? "Paused" : "Turned on"} ${p.code ?? id} (${id}).`)
  const [coupon] = await toCoupons(scope, [p])
  return coupon
}
