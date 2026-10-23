import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CodeMailInput, CodeMailResponse, CodeMailSendResponse } from "../../../../../modules/coupons/lib/contract"
import { codeMailState, sendCodeMail } from "../../../../../workflows/coupons/code-mail"
import { fail, idParam } from "../../helpers"

/** GET /admin/coupons/:id/code-mail: who is on the coupon, who got the code and when, and whether it can be sent now. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "No such coupon." })
    return
  }
  try {
    const body: CodeMailResponse = await codeMailState(req.scope, id)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The recipients of the code could not be read.")
  }
}

/**
 * POST /admin/coupons/:id/code-mail  { customerIds, message }
 *
 * E-mails the code through the store's adapter (option sendCode) to the
 * people who did not get it before; new ones go onto the coupon's customer
 * rule first. 400 with the keys of what is wrong.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "No such coupon." })
    return
  }
  const actor = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } }).auth_context?.actor_id ?? null
  try {
    const body: CodeMailSendResponse = await sendCodeMail(req.scope, id, (req.body ?? {}) as Partial<CodeMailInput>, actor)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The code was not sent.")
  }
}
