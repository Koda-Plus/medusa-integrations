import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STORE_LIST_PER_MINUTE } from "../../../../../../modules/fakturownia/lib/constants"
import type { StoreDocumentsResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { sharedLimiter } from "../../../../../../modules/fakturownia/lib/rate-limit"
import { customerDocuments, customerIdOf, ownedOrder } from "../../../../../../workflows/fakturownia/storefront"

/**
 * GET /store/fakturownia/orders/:orderId/documents
 *
 * The documents of an order of the LOGGED-IN customer (session or bearer
 * token, plus the publishable API key every store route needs): VAT
 * invoices, proformas, receipts and corrections issued in Fakturownia, with
 * their number, date, amount, payment, KSeF number and the URL of the PDF.
 * 401 without a customer, 404 for an order that is not theirs (or does not
 * exist), 429 after 30 requests a minute. Reads the database only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req as never)
  if (!customerId) {
    res.status(401).json({ message: "Log in to see your documents." })
    return
  }
  const limit = sharedLimiter("store-list", STORE_LIST_PER_MINUTE).hit(customerId)
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds))
    res.status(429).json({ message: "Too many requests. Try again in a moment." })
    return
  }
  const order = await ownedOrder(req.scope, req.params.orderId, customerId)
  if (!order) {
    res.status(404).json({ message: "Order not found." })
    return
  }
  const body: StoreDocumentsResponse = { order_id: order.id, documents: await customerDocuments(req.scope, order.id) }
  res.setHeader("Cache-Control", "private, no-store")
  res.json(body)
}
