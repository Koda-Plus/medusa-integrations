import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { editOffer } from "../../../../../../workflows/vonhalsky/offers"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/offers/:id/edit { overrides }: "Edit offer". The
 * name, the description, the photos (https URLs in order, the first is the
 * main one), the package `{ length, width, height, weight }` (mm, g) and the
 * days to ship of one offer, over Medusa's values; a field left out stays,
 * null goes back to Medusa. Checked against the marketplace's rules (400
 * with the field's code). An offer on the marketplace gets the change: a
 * merge patch, or for a published one close, patch and reopen (`sent`).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhoff_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not an offer id of this plugin." })
    return
  }
  const body = (req.body ?? {}) as { overrides?: unknown }
  if (!("overrides" in body)) {
    res.status(400).json({ code: "nothing_to_change", message: "Send overrides: { title, description, images, dimension, daysToShip }." })
    return
  }
  await respond(res, () => editOffer(req.scope, id, body.overrides))
}
