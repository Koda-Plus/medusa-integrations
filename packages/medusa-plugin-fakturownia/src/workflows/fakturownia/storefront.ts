/**
 * THE DOCUMENTS OF A LOGGED-IN CUSTOMER, FOR A STOREFRONT ACCOUNT PAGE.
 *
 * OWNERSHIP IS THE ORDER'S CUSTOMER ID. A customer sees the documents of an
 * order only when `order.customer_id` is the id of the logged-in customer
 * (the actor of the session or the bearer token). Never by e-mail: a guest
 * order placed with the same address belongs to nobody's account, and an
 * e-mail is easy to know. A document of someone else's order answers 404,
 * exactly like a document that does not exist.
 *
 * Only documents issued in Fakturownia are listed (VAT invoices, proformas,
 * receipts and their corrections), with what is printed on them; the PDF is
 * fetched by the backend (generated in demo mode), never by the browser
 * from Fakturownia.
 */

import type { StoreDocumentDto } from "../../modules/fakturownia/lib/contract"
import { isCustomerVisible, toStoreDocumentDto, type DocumentRow } from "../../modules/fakturownia/lib/dto"
import { documentsOfOrder, fakturowniaService, getDocument, queryOf, type Scope } from "./runtime"

/** The logged-in customer of a store request, or null (an admin token or no session does not count). */
export function customerIdOf(req: { auth_context?: { actor_id?: string | null; actor_type?: string | null } | null }): string | null {
  const ctx = req.auth_context
  if (!ctx || ctx.actor_type !== "customer") return null
  return typeof ctx.actor_id === "string" && ctx.actor_id ? ctx.actor_id : null
}

/** The order when it belongs to the customer; null otherwise (missing or someone else's). */
export async function ownedOrder(scope: Scope, orderId: string, customerId: string): Promise<{ id: string; display_id: number | null } | null> {
  if (!orderId || !customerId) return null
  const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "customer_id", "display_id"], filters: { id: orderId } })
  const order = data[0] as { id?: string; customer_id?: string | null; display_id?: number | null } | undefined
  if (!order?.id || !order.customer_id || order.customer_id !== customerId) return null
  return { id: order.id, display_id: order.display_id ?? null }
}

/** The customer's documents of an order, oldest first, in the current mode. */
export async function customerDocuments(scope: Scope, orderId: string): Promise<StoreDocumentDto[]> {
  const svc = fakturowniaService(scope)
  const rows = (await documentsOfOrder(svc, orderId)).filter(isCustomerVisible)
  const byId = new Map(rows.map((r) => [r.id, r]))
  return rows.map((r) => toStoreDocumentDto(r, r.corrects_document_id ? byId.get(r.corrects_document_id)?.number ?? null : null))
}

/** A document the customer may download: visible, of the current mode, of an order they own. */
export async function customerDocument(scope: Scope, documentId: string, customerId: string): Promise<DocumentRow | null> {
  const svc = fakturowniaService(scope)
  const row = await getDocument(svc, documentId)
  if (!row || Boolean(row.demo) !== svc.isDemo() || !isCustomerVisible(row)) return null
  return (await ownedOrder(scope, row.order_id, customerId)) ? row : null
}
