/**
 * THE SALES DOCUMENT OF AN ORDER (FS or PA), EXACTLY ONCE:
 *
 * 1. One task row per order (`order.document`, unique by kind and order)
 *    before anything goes to the network. Its document kind is decided once,
 *    from `salesDocument` and the buyer's NIP, and frozen in the row.
 * 2. The queue claims the row atomically (`claimTask`).
 * 3. When an earlier attempt ended without a clear answer (`unknown`), or after
 *    any failed attempt, the bridge is asked first which documents the order
 *    has, and a sales document found there is adopted, not issued again.
 * 4. The bridge itself looks for the order tag before it creates (under the
 *    order lock and the Sfera lock), so one order never gets two.
 *
 * Queued only when the option allows it (`salesDocument` is not `none`), a
 * person armed the documents writer, and the bridge has the capability.
 */

import type { BridgeHealth, ContractDocument, DocumentDto } from "../../modules/subiekt/lib/contract"
import { supports } from "../../modules/subiekt/lib/capabilities"
import { decideDocumentKind, documentCapability, findSalesDocument, type DocumentKind } from "../../modules/subiekt/lib/documents"
import { BridgeError } from "../../modules/subiekt/lib/bridge-client"
import { toDocumentDto } from "../../modules/subiekt/lib/dto"
import { buyerContext, recordDocument } from "./orders"
import { enqueueTask } from "./queue"
import { bridgeFor, getConnection, markReachable, subiektService, type Scope } from "./runtime"
import { writerActive } from "./writers"

/**
 * After a fresh ZK or WZ: queue the sales document when it is due at this
 * point (`salesDocumentAfter`). Returns whether a task was queued; the caller
 * starts the queue when it is not already running.
 */
export async function queueSalesDocument(scope: Scope, orderId: string, after: "zk" | "wz"): Promise<boolean> {
  const svc = subiektService(scope)
  const o = svc.getOptions()
  if (o.salesDocument === "none" || o.salesDocumentAfter !== after) return false
  if (!(await writerActive(scope, "documents"))) return false
  const ctx = await buyerContext(scope, orderId)
  if (!ctx || ctx.canceled) return false
  const kind = decideDocumentKind(o.salesDocument, ctx.nip)
  if (!kind) return false
  await enqueueTask(scope, {
    kind: "order.document",
    orderId,
    displayId: ctx.displayId,
    status: "pending",
    trigger: after,
    detail: { kind, nip: ctx.nip },
  })
  return true
}

export interface IssueDocumentResult {
  order_id: string
  skipped: null | "order_canceled"
  created: boolean
  adopted: boolean
  document: DocumentDto | null
  warnings: string[]
}

/** One attempt at the sales document of an order. Throws `BridgeError` for the queue to classify. */
export async function issueSalesDocument(scope: Scope, orderId: string, kind: DocumentKind, reconcile: boolean): Promise<IssueDocumentResult> {
  const svc = subiektService(scope)
  const ctx = await buyerContext(scope, orderId)
  if (!ctx) throw Object.assign(new Error(`Order ${orderId} does not exist in Medusa.`), { code: "order_not_found", retryable: false })
  if (ctx.canceled) return { order_id: orderId, skipped: "order_canceled", created: false, adopted: false, document: null, warnings: [] }

  const bridge = bridgeFor(scope)
  if (!svc.isDemo()) {
    const health = ((await getConnection(svc)).health as unknown as BridgeHealth | null) ?? null
    if (!supports(health, documentCapability(kind))) {
      throw new BridgeError({
        code: "not_supported",
        message: `The bridge does not report ${documentCapability(kind)}: update it to contract 1.1 or enable ${kind.toUpperCase()} in its configuration (Bridge:Documents).`,
        status: 0,
        retryable: false,
      })
    }
  }

  if (reconcile) {
    // Unclear answer before: ask which documents the order has before creating anything.
    const status = await bridge.getOrder(orderId)
    const found = findSalesDocument(status?.documents ?? [])
    if (found) {
      const { row } = await recordDocument(scope, { orderId, document: found, source: "bridge", allowFulfillment: false })
      await markReachable(svc)
      return { order_id: orderId, skipped: null, created: false, adopted: true, document: toDocumentDto(row), warnings: [] }
    }
  }

  const res = await bridge.issueDocument(orderId, { kind, display_id: ctx.displayId, note: null })
  const document: ContractDocument = res.document
  const { row } = await recordDocument(scope, { orderId, document, source: "bridge", allowFulfillment: false })
  await markReachable(svc)
  return { order_id: orderId, skipped: null, created: res.created, adopted: false, document: toDocumentDto(row), warnings: res.warnings ?? [] }
}
