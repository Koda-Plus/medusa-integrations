/**
 * DELETING a coupon nobody used (a copy made by mistake, a test), through
 * Medusa's own deletePromotionsWorkflow. A coupon with any use or any order
 * (canceled ones too) is never deleted: it is disabled instead, so the
 * order history keeps its promotion. The server checks it itself and
 * answers 409 with the reason.
 *
 * The store's terms of the coupon (option storeTerms) are forgotten with it,
 * and the campaign the creator made for its dates goes too when no other
 * promotion is in it.
 */
import { deleteCampaignsWorkflow, deletePromotionsWorkflow } from "@medusajs/medusa/core-flows"
import { deleteBlockers } from "../../modules/coupons/lib/code-mail"
import type { DeleteResponse } from "../../modules/coupons/lib/contract"
import { CouponInputError } from "./errors"
import { ordersUsing, readPromotions, toCoupons } from "./reads"
import { couponsService, num, queryOf, type Scope } from "./runtime"
import { writeTerms } from "./terms"

type WorkflowScope = Parameters<typeof deletePromotionsWorkflow>[0]

/** Campaigns the creator makes for a coupon's dates (wizard.ts, update.ts). */
const OWN_CAMPAIGN = /^koda-coupons-/

export async function deleteCoupon(scope: Scope, id: string): Promise<DeleteResponse> {
  const [p] = await readPromotions(scope, { id }, 1)
  if (!p) throw new CouponInputError(404, ["not_found"], "No such coupon.")
  const orders = await ordersUsing(scope, id)
  const blockers = deleteBlockers({ used: num(p.used), orders })
  if (blockers.length) {
    throw new CouponInputError(409, blockers, `${p.code ?? id} was used (${orders} order(s)): disable it instead, the orders keep their promotion.`)
  }
  const [coupon] = await toCoupons(scope, [p])
  const log = couponsService(scope).getLogger()

  /* The campaign holding its dates, when the creator made it for this coupon alone. */
  let campaignId: string | null = null
  if (p.campaign?.id) {
    try {
      const { data } = await queryOf(scope).graph({ entity: "campaign", fields: ["id", "campaign_identifier", "promotions.id"], filters: { id: p.campaign.id } })
      const row = (data?.[0] ?? {}) as { campaign_identifier?: string | null; promotions?: Array<{ id?: string }> | null }
      const others = (row.promotions ?? []).filter((x) => x?.id && x.id !== id)
      if (OWN_CAMPAIGN.test(String(row.campaign_identifier ?? "")) && others.length === 0) campaignId = p.campaign.id
    } catch {
      campaignId = null
    }
  }

  await deletePromotionsWorkflow(scope as WorkflowScope).run({ input: { ids: [id] } as never })

  if (coupon.terms) {
    await writeTerms(scope, id, null, { code: coupon.code, kind: coupon.shape.kind }).catch((err) => log.warn(`[coupons] The store's terms of the deleted ${coupon.code} stay: ${(err as Error)?.message ?? err}`))
  }
  if (campaignId) {
    await deleteCampaignsWorkflow(scope as WorkflowScope)
      .run({ input: { ids: [campaignId] } as never })
      .catch((err) => log.warn(`[coupons] The campaign ${campaignId} of the deleted ${coupon.code} stays: ${(err as Error)?.message ?? err}`))
  }
  log.info(`[coupons] Deleted ${coupon.code || id} (${id}), never used${campaignId ? `, with its campaign ${campaignId}` : ""}.`)
  return { id, code: coupon.code, deleted: true }
}
