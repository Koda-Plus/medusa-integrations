import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CreateResponse, ListResponse, WizardInput } from "../../../modules/coupons/lib/contract"
import { KIT_META } from "../../../modules/coupons/lib/kit-meta"
import { createCoupon } from "../../../workflows/coupons/create"
import { listCoupons } from "../../../workflows/coupons/reads"
import { couponsService } from "../../../workflows/coupons/runtime"
import { fail } from "./helpers"

/**
 * GET /admin/coupons: every promotion as a coupon (the newest 300), its use
 * from orders, the names its rules point to, and the tiles of the page.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const o = couponsService(req.scope).getOptions()
    const { coupons, names, tiles } = await listCoupons(req.scope)
    const body: ListResponse = {
      version: KIT_META.version,
      currencyCode: o.currencyCode,
      codePrefix: o.codePrefix,
      memberGroupIds: o.memberGroupIds,
      problems: o.problems,
      coupons,
      names,
      tiles,
      codeMail: { send: Boolean(o.sendCode), preview: Boolean(o.sendCode && o.previewCode) },
    }
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The coupons could not be read. Try again in a moment.")
  }
}

/**
 * POST /admin/coupons  (the creator's three steps, `WizardInput`)
 *
 * Saves a standard Medusa promotion (and a campaign with its dates). Answers
 * 400 with the keys of what is missing, 409 when the code is taken.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const { coupon, warnings } = await createCoupon(req.scope, (req.body ?? {}) as WizardInput)
    const body: CreateResponse = { coupon, warnings }
    res.status(201).json(body)
  } catch (err) {
    fail(req, res, err, "The coupon could not be saved. Nothing was created.")
  }
}
