import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { searchCustomers } from "../../../../../workflows/coupons/reads"
import { fail } from "../../helpers"

/** GET /admin/coupons/lookups/customers?q=: up to 10 customers by name, company or e-mail, for "one customer". */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const raw = (req.query as Record<string, unknown> | undefined)?.q
  const q = typeof raw === "string" ? raw : ""
  try {
    res.json({ customers: await searchCustomers(req.scope, q) })
  } catch (err) {
    fail(req, res, err, "The customers could not be searched.")
  }
}
