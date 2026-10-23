import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CodeMailInput, CodeMailPreviewResponse } from "../../../../../../modules/coupons/lib/contract"
import { previewCodeMail } from "../../../../../../workflows/coupons/code-mail"
import { fail, idParam } from "../../../helpers"

/**
 * POST /admin/coupons/:id/code-mail/preview  { customerIds?, message }
 *
 * The e-mail as the first person would get it, rendered by the store
 * (option previewCode). Sends nothing and writes nothing.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "No such coupon." })
    return
  }
  try {
    const body: CodeMailPreviewResponse = await previewCodeMail(req.scope, id, (req.body ?? {}) as Partial<CodeMailInput>)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The preview could not be made.")
  }
}
