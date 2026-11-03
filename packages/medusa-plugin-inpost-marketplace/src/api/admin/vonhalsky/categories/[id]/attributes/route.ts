import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AttributesResponse } from "../../../../../../modules/vonhalsky/lib/contract"
import { vonHalskySvc } from "../../../../../../modules/vonhalsky/lib/store"
import { attributesOf, toAttributeDto, toCategoryDto } from "../../../../../../workflows/vonhalsky/categories"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/**
 * GET /admin/vonhalsky/categories/:id/attributes?fresh=1: the parameters of
 * a marketplace leaf category (kept for 7 days; `fresh` reads them again).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a marketplace category id." })
    return
  }
  await respond(res, async () => {
    const [row] = ((await vonHalskySvc(req.scope).listVonHalskyCategories({ remote_id: id }, { take: 1 })) ?? []) as Array<Record<string, any>>
    const attributes = (await attributesOf(req.scope, id, req.query.fresh === "1")) ?? []
    const body: AttributesResponse = { category: row ? toCategoryDto(row) : null, attributes: attributes.map(toAttributeDto) }
    return body
  })
}
