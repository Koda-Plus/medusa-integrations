/**
 * A COPY of a coupon under a new code, with the form's changes on top (for
 * example a coupon for another customer: 7GRATIS1 becomes 8GRATIS1 with the same rules). The
 * copy is a new Medusa promotion with every rule, target and buy rule of the
 * original, its own campaign when the original had dates, and the store's
 * own terms copied through the store's adapter. The original is untouched.
 */

import { createCampaignsWorkflow, createPromotionsWorkflow, deletePromotionsWorkflow } from "@medusajs/medusa/core-flows"
import type { CouponDto, DuplicateInput } from "../../modules/coupons/lib/contract"
import type { PromotionLike, RuleLike } from "../../modules/coupons/lib/describe"
import { ruleValues } from "../../modules/coupons/lib/describe"
import { checkPatch, editWarnings, patchIsEmpty } from "../../modules/coupons/lib/edit"
import { cleanCode } from "../../modules/coupons/lib/wizard"
import { CouponInputError } from "./errors"
import { readPromotions, toCoupons } from "./reads"
import { couponsService, promotionModule, type Scope } from "./runtime"
import { readTerms, writeTerms } from "./terms"
import { applyPatch } from "./update"

type WorkflowScope = Parameters<typeof createPromotionsWorkflow>[0]

const CODE = /^[A-Z0-9][A-Z0-9_-]{2,39}$/

function rulesOf(list: RuleLike[] | null | undefined): Array<{ attribute: string; operator: string; values: string[] }> {
  return (list ?? [])
    .map((r) => ({ attribute: String(r.attribute ?? ""), operator: String(r.operator ?? "in"), values: ruleValues(r) }))
    .filter((r) => r.attribute && r.values.length)
}

/** The createPromotionsWorkflow input of a copy of `p` under `code`. */
export function copyInput(p: PromotionLike, code: string): Record<string, unknown> {
  const am = p.application_method ?? {}
  const method: Record<string, unknown> = {
    type: am.type ?? "percentage",
    target_type: am.target_type ?? "order",
    allocation: am.allocation ?? "across",
    value: Number(am.value ?? 0),
  }
  if (am.currency_code) method.currency_code = am.currency_code
  if (am.max_quantity !== null && am.max_quantity !== undefined) method.max_quantity = Number(am.max_quantity)
  if (am.apply_to_quantity !== null && am.apply_to_quantity !== undefined) method.apply_to_quantity = Number(am.apply_to_quantity)
  if (am.buy_rules_min_quantity !== null && am.buy_rules_min_quantity !== undefined) method.buy_rules_min_quantity = Number(am.buy_rules_min_quantity)
  const targets = rulesOf(am.target_rules)
  if (targets.length) method.target_rules = targets
  const buys = rulesOf(am.buy_rules)
  if (buys.length) method.buy_rules = buys
  return {
    code,
    type: p.type === "buyget" ? "buyget" : "standard",
    status: "active",
    is_automatic: p.is_automatic === true,
    ...(p.limit !== null && p.limit !== undefined && Number(p.limit) > 0 ? { limit: Number(p.limit) } : {}),
    application_method: method,
    rules: rulesOf(p.rules),
  }
}

export async function duplicateCoupon(scope: Scope, id: string, input: DuplicateInput, now: Date = new Date()): Promise<{ coupon: CouponDto; warnings: string[] }> {
  const o = couponsService(scope).getOptions()
  const [original] = await readPromotions(scope, { id }, 1)
  if (!original) throw new CouponInputError(404, ["not_found"], "No such coupon.")
  const code = cleanCode(input?.code)
  if (!CODE.test(code)) throw new CouponInputError(400, ["code"], "The code of the copy: 3 to 40 letters, digits, dashes.")
  const same = await promotionModule(scope).listPromotions({ code }, { take: 1 })
  if (same.length > 0) throw new CouponInputError(409, ["code_taken"], `The code ${code} is taken.`)

  const [source] = await toCoupons(scope, [original], undefined, now)
  /* The form's changes are checked against the original (the copy starts as its twin), the code aside. */
  const patch = { ...(input.patch ?? {}) }
  delete patch.code
  const features = o.storeTerms?.features ?? []
  const check = checkPatch(patch, { ...source, used: 0 }, { features, nobody: o.nobodyCustomerId })
  if (!check.ok || !check.value) throw new CouponInputError(400, check.errors, `The copy was not made: ${check.errors.join(", ")}.`)

  const ws = scope as WorkflowScope
  let campaignId: string | null = null
  const startsAt = original.campaign?.starts_at ?? null
  const endsAt = original.campaign?.ends_at ?? null
  if (!check.value.dates && (startsAt || endsAt)) {
    const { result } = await createCampaignsWorkflow(ws).run({
      input: { campaignsData: [{ name: code, campaign_identifier: `koda-coupons-${code.toLowerCase()}-${Date.now().toString(36)}`, starts_at: startsAt, ends_at: endsAt }] } as never,
    })
    campaignId = String((result as Array<{ id: string }>)[0]?.id ?? "") || null
  }
  const { result } = await createPromotionsWorkflow(ws).run({
    input: { promotionsData: [{ ...copyInput(original, code), ...(campaignId ? { campaign_id: campaignId } : {}) }] } as never,
  })
  const copyId = String((result as Array<{ id: string }>)[0]?.id ?? "")
  if (!copyId) throw new CouponInputError(500, ["not_saved"], "Medusa did not return the copy.")

  try {
    const terms = (await readTerms(scope, [id]))[id] ?? null
    const kind = source.terms?.buyGet ? "store_buy_get" : source.shape.kind
    if (terms && !check.value.terms) await writeTerms(scope, copyId, terms, { code, kind })
    const [copied] = await readPromotions(scope, { id: copyId }, 1)
    if (!copied) throw new CouponInputError(500, ["not_saved"], "Medusa did not return the copy.")
    const [copyDto] = await toCoupons(scope, [copied], undefined, now)
    if (!patchIsEmpty(check.value)) await applyPatch(scope, copyId, copied, { ...copyDto, terms: copyDto.terms ?? terms }, check.value)
  } catch (err) {
    /* No half copy: without its terms or its changes it would work differently from what the form showed. */
    await deletePromotionsWorkflow(ws).run({ input: { ids: [copyId] } as never }).catch(() => undefined)
    throw err
  }

  const [after] = await readPromotions(scope, { id: copyId }, 1)
  if (!after) throw new CouponInputError(500, ["not_saved"], "Medusa did not return the copy.")
  couponsService(scope).getLogger().info(`[coupons] Copied ${original.code ?? id} (${id}) as ${code} (${copyId}).`)
  const [coupon] = await toCoupons(scope, [after], undefined, now)
  return { coupon, warnings: editWarnings(check.value, source).filter((w) => w !== "code_changed") }
}
