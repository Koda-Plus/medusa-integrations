import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { writeSyncState } from "../../../../../modules/vonhalsky/lib/store"
import { syncCategories } from "../../../../../workflows/vonhalsky/categories"
import { respond } from "../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/categories/sync: reads the marketplace category tree again (the sync does it weekly). */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respond(res, async () => {
    const r = await syncCategories(req.scope)
    await writeSyncState(req.scope, { at: { categories: new Date().toISOString() } })
    return r
  })
}
