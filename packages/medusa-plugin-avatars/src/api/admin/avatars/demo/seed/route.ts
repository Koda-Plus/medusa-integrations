import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { avatarsSvc } from "../../../../../modules/avatars/lib/store"
import { seedDemo } from "../../../../../workflows/avatars/demo"
import { problems } from "../../helpers"

/** POST /admin/avatars/demo/seed  Sample rows, flagged demo. Only in demo mode (409 otherwise), once. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!avatarsSvc(req.scope).isDemo()) return problems(res, 409, ["not_demo"])
  res.json(await seedDemo(req.scope))
}
