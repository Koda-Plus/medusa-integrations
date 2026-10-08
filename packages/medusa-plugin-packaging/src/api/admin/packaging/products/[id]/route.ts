import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isUnitName } from "../../../../../modules/packaging/lib/constants"
import { savePackaging } from "../../../../../workflows/packaging/save"
import { fail } from "../../../../packaging/helpers"

/**
 * POST /admin/packaging/products/:id
 *
 * Upserts the packaging of a product: the MOQ, the order step and the whole
 * ladder. Body: { moq, step, units: [{ name, pieces, ean?, sscc_prefix? }] }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const productId = req.params.id as string
  const body = (req.body ?? {}) as Record<string, unknown>
  const moq = typeof body.moq === "number" ? Math.max(0, Math.floor(body.moq)) : Number(body.moq)
  const step = typeof body.step === "number" ? Math.max(0, Math.floor(body.step)) : Number(body.step)
  if (!Number.isFinite(moq) || !Number.isFinite(step)) {
    fail(res, 400, "invalid_numbers", "The MOQ and the step are numbers.")
    return
  }
  const raw = Array.isArray(body.units) ? body.units : []
  const units = raw
    .filter((u): u is Record<string, unknown> => Boolean(u) && typeof u === "object")
    .map((u) => ({
      name: isUnitName(u.name) ? u.name : "szt.",
      pieces: typeof u.pieces === "number" ? u.pieces : Number(u.pieces),
      ean: typeof u.ean === "string" && u.ean.trim() ? u.ean.trim() : null,
      sscc_prefix: typeof u.sscc_prefix === "string" && u.sscc_prefix.trim() ? u.sscc_prefix.trim() : null,
    }))
    .filter((u) => Number.isFinite(u.pieces) && u.pieces >= 1)
  await savePackaging(req.scope, productId, { moq: Math.floor(moq), step: Math.floor(step), units })
  res.json({ ok: true })
}
