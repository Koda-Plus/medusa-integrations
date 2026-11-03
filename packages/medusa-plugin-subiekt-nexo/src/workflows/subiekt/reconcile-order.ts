/**
 * ONE ORDER, SUBIEKT AGAINST THE PLUGIN (0.3.0), from the order page.
 *
 * "Check in Subiekt" asks the bridge which documents the order has
 * (`GET /v1/orders/{id}`) and compares them with the plugin tables. "Link"
 * records a document Subiekt already has instead of creating a second one, and
 * settles the queue task waiting for it; on a document the plugin knows it
 * records the status Subiekt reports (realized or canceled). Nothing is
 * written in Subiekt. The document always comes from a fresh bridge answer,
 * never from the request.
 */

import type { DocumentDto, OrderCheckResponse } from "../../modules/subiekt/lib/contract"
import type { DocumentRow, TaskRow } from "../../modules/subiekt/lib/dto"
import { toDocumentDto } from "../../modules/subiekt/lib/dto"
import { compareOrderDocuments, findRemoteDocument, settleableStatus, taskSettledBy } from "../../modules/subiekt/lib/reconcile"
import { recordDocument } from "./orders"
import { findTask, updateTask } from "./queue"
import { bridgeFor, markReachable, subiektService, type Scope } from "./runtime"
import { queueSalesDocument } from "./sales-documents"

async function localDocuments(scope: Scope, orderId: string): Promise<DocumentRow[]> {
  const svc = subiektService(scope)
  return (await svc.listSubiektDocuments({ order_id: orderId, demo: svc.isDemo() } as never, {
    take: 50,
    order: { created_at: "ASC" },
  } as never)) as unknown as DocumentRow[]
}

/** Asks the bridge. Throws the bridge error for the route to answer with. */
export async function checkOrderInSubiekt(scope: Scope, orderId: string): Promise<OrderCheckResponse> {
  const svc = subiektService(scope)
  const remote = await bridgeFor(scope).getOrder(orderId)
  await markReachable(svc)
  const local = await localDocuments(scope, orderId)
  return {
    mode: svc.isDemo() ? "demo" : "live",
    orderId,
    checkedAt: new Date().toISOString(),
    foundInSubiekt: Boolean(remote),
    entries: compareOrderDocuments(local, remote?.documents ?? []),
  }
}

export class LinkError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface LinkResult {
  document: DocumentDto
  settledTaskId: string | null
  check: OrderCheckResponse
}

/** Records one document of the order as Subiekt reports it now, and settles the task waiting for it. */
export async function linkOrderDocument(scope: Scope, orderId: string, kind: string, number: string): Promise<LinkResult> {
  const svc = subiektService(scope)
  const remote = await bridgeFor(scope).getOrder(orderId)
  await markReachable(svc)
  const document = findRemoteDocument(remote?.documents ?? [], kind, number)
  if (!document) throw new LinkError(409, `Subiekt does not report ${kind} ${number} for this order (any more). Check again.`)

  const settles = taskSettledBy(document.kind)
  const task: TaskRow | null = settles ? await findTask(scope, settles, orderId, null) : null
  if (task?.status === "running") throw new LinkError(409, "The task of this document is being sent right now. Try again in a minute.")

  const { row, fresh } = await recordDocument(scope, { orderId, document, source: "linked", allowFulfillment: false })

  let settledTaskId: string | null = null
  if (task && settleableStatus(task.status) && row.status !== "canceled") {
    await updateTask(scope, task.id, {
      status: "succeeded",
      succeeded_at: new Date(),
      next_attempt_at: null,
      last_error: null,
      last_error_code: null,
      result: { ...(task.result ?? {}), number: row.number, created: false, linked: true },
    })
    settledTaskId = task.id
  }
  if (fresh && row.status !== "canceled" && (row.kind === "ZK" || row.kind === "WZ")) {
    await queueSalesDocument(scope, orderId, row.kind === "ZK" ? "zk" : "wz").catch((err: unknown) => {
      svc.getLogger().warn(`[subiekt] ${row.number} linked, the sales document was not queued: ${svc.mask((err as Error)?.message ?? String(err))}`)
    })
  }
  svc.getLogger().info(`[subiekt] ${row.number} linked to order ${orderId} by a person (${row.status}).`)

  const local = await localDocuments(scope, orderId)
  return {
    document: toDocumentDto(row),
    settledTaskId,
    check: {
      mode: svc.isDemo() ? "demo" : "live",
      orderId,
      checkedAt: new Date().toISOString(),
      foundInSubiekt: Boolean(remote),
      entries: compareOrderDocuments(local, remote?.documents ?? []),
    },
  }
}
