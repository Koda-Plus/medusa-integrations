/**
 * Orders on the Medusa side of the bridge: reading an order for the ZK,
 * recording documents Subiekt issued and their side effects.
 */

import { createOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import type { IEventBusModuleService, IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { ContractDocument, ContractOrder } from "../../modules/subiekt/lib/contract"
import { ORDER_METADATA, PLUGIN_EVENTS } from "../../modules/subiekt/lib/constants"
import type { DocumentRow } from "../../modules/subiekt/lib/dto"
import {
  ORDER_FIELDS,
  PayloadError,
  buildOrderPayload,
  dueDaysFromMetadata,
  type OrderRecord,
} from "../../modules/subiekt/lib/order-payload"
import { paymentState, readyForSubiekt, type PaymentCollectionRecord, type PaymentState } from "../../modules/subiekt/lib/payment"
import { money } from "../../modules/subiekt/lib/numbers"
import { queryOf, subiektService, type Scope } from "./runtime"

export type GraphOrder = OrderRecord & { payment_collections?: PaymentCollectionRecord[] | null }

export async function loadOrder(scope: Scope, orderId: string): Promise<GraphOrder | null> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: [...ORDER_FIELDS], filters: { id: orderId } })
  return (data[0] as GraphOrder | undefined) ?? null
}

export function paymentOf(scope: Scope, order: GraphOrder): PaymentState {
  const o = subiektService(scope).getOptions()
  return paymentState({
    collections: order.payment_collections ?? [],
    totalGross: money(order.total),
    prepaidProviders: o.prepaidProviders,
    codProviders: o.codProviders,
    dueDays: dueDaysFromMetadata(order.metadata ?? null),
  })
}

/** Whether an order may go to Subiekt now (payment) and what to call it in logs. */
export async function orderReadiness(scope: Scope, orderId: string): Promise<{ ready: boolean; displayId: number | null; canceled: boolean } | null> {
  const order = await loadOrder(scope, orderId)
  if (!order) return null
  return {
    ready: readyForSubiekt(paymentOf(scope, order)),
    displayId: typeof order.display_id === "number" ? order.display_id : null,
    canceled: order.status === "canceled",
  }
}

export interface OrderSubmission {
  orderId: string
  displayId: number | null
  skip: null | "order_canceled"
  payload: ContractOrder | null
  omitted: Array<{ line_id: string; title: string | null }>
}

/** The body of `POST /v1/orders` for one order, or a reason to skip it. */
export async function buildSubmission(scope: Scope, orderId: string): Promise<OrderSubmission> {
  const order = await loadOrder(scope, orderId)
  if (!order) throw new PayloadError("order_not_found", `Order ${orderId} does not exist in Medusa.`)
  const displayId = typeof order.display_id === "number" ? order.display_id : null
  if (order.status === "canceled") return { orderId, displayId, skip: "order_canceled", payload: null, omitted: [] }

  const o = subiektService(scope).getOptions()
  const { payload, omitted } = buildOrderPayload(order, paymentOf(scope, order), {
    stripSkuSuffixes: o.stripSkuSuffixes,
    omitLinesWithoutCode: o.omitLinesWithoutCode,
    forwardMetadataKeys: o.forwardMetadataKeys,
    taxIdMetadataKeys: o.taxIdMetadataKeys,
  })
  return { orderId, displayId, skip: null, payload, omitted }
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export interface RecordDocumentInput {
  orderId: string | null
  document: ContractDocument
  source: string
  eventId?: string | null
  /** A WZ from Subiekt may create the Medusa fulfillment (`fulfillOnWz`). Never for a WZ Medusa asked for. */
  allowFulfillment: boolean
}

export interface RecordDocumentResult {
  row: DocumentRow
  fresh: boolean
  fulfillmentError: string | null
}

async function displayIdOf(scope: Scope, orderId: string | null): Promise<number | null> {
  if (!orderId) return null
  const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "display_id"], filters: { id: orderId } })
  const row = data[0] as { display_id?: number | null } | undefined
  return typeof row?.display_id === "number" ? row.display_id : null
}

/** Adds keys to order metadata without dropping what other code stored there. */
export async function patchOrderMetadata(scope: Scope, orderId: string, patch: Record<string, unknown>): Promise<boolean> {
  const orders = (scope as { resolve<T>(k: string): T }).resolve<IOrderModuleService>(Modules.ORDER)
  const current = await orders.retrieveOrder(orderId, { select: ["id", "metadata"] }).catch(() => null)
  if (!current) return false
  const metadata = { ...((current.metadata ?? {}) as Record<string, unknown>), ...patch }
  await orders.updateOrders(orderId, { metadata })
  return true
}

function joinNumbers(existing: unknown, number: string): string {
  const list = typeof existing === "string" && existing.trim() ? existing.split(",").map((s) => s.trim()) : []
  if (!list.includes(number)) list.push(number)
  return list.join(", ")
}

/**
 * Stores a document once and runs its side effects once:
 * order metadata, the `subiekt.document_issued` event and, for a WZ from
 * Subiekt with `fulfillOnWz`, the Medusa fulfillment.
 */
export async function recordDocument(scope: Scope, input: RecordDocumentInput): Promise<RecordDocumentResult> {
  const svc = subiektService(scope)
  const demo = svc.isDemo()
  const doc = input.document
  const status = doc.status ?? "open"
  const issuedAt = doc.issued_at ? new Date(doc.issued_at) : new Date()

  const existing = (await svc.listSubiektDocuments({ kind: doc.kind, number: doc.number, demo, order_id: input.orderId } as never, { take: 1 } as never)) as unknown as DocumentRow[]
  if (!existing[0]) {
    const other = (await svc.listSubiektDocuments({ kind: doc.kind, number: doc.number, demo } as never, { take: 1, select: ["id", "order_id"] } as never)) as unknown as DocumentRow[]
    if (other[0]) {
      svc.getLogger().warn(
        `[subiekt] ${doc.number} was already recorded for order ${other[0].order_id ?? "?"} and now arrives for ${input.orderId ?? "?"}. ` +
          "Did the bridge switch to another Subiekt database? Both are kept.",
      )
    }
  }
  let row: DocumentRow
  if (existing[0]) {
    row = existing[0]
    const changes: Record<string, unknown> = {}
    if (row.status !== status) changes.status = status
    if (!row.order_id && input.orderId) changes.order_id = input.orderId
    if ((doc.related?.length ?? 0) > 0 && JSON.stringify(row.related ?? []) !== JSON.stringify(doc.related)) changes.related = doc.related
    if (Object.keys(changes).length > 0) {
      row = (await svc.updateSubiektDocuments({ id: row.id, ...changes } as never)) as unknown as DocumentRow
    }
    if (row.applied_at) return { row, fresh: false, fulfillmentError: null }
  } else {
    try {
      row = (await svc.createSubiektDocuments({
        order_id: input.orderId,
        display_id: await displayIdOf(scope, input.orderId),
        kind: doc.kind,
        number: doc.number,
        subiekt_id: doc.id ?? null,
        status,
        issued_at: issuedAt,
        source: input.source,
        warehouse: doc.warehouse ?? null,
        related: doc.related ?? [],
        event_id: input.eventId ?? null,
        demo,
      } as never)) as unknown as DocumentRow
    } catch {
      // The same document arrived twice at once (create answer and feed): the unique index chose one.
      const again = (await svc.listSubiektDocuments({ kind: doc.kind, number: doc.number, demo, order_id: input.orderId } as never, { take: 1 } as never)) as unknown as DocumentRow[]
      if (!again[0]) throw new Error(`Could not store ${doc.number}.`)
      return { row: again[0], fresh: false, fulfillmentError: null }
    }
  }

  /* Side effects, once. */
  let fulfillmentError: string | null = null
  if (input.orderId && status !== "canceled") {
    const meta: Record<string, unknown> = {}
    if (doc.kind === "ZK") {
      meta[ORDER_METADATA.zkNumber] = doc.number
      meta[ORDER_METADATA.zkIssuedAt] = issuedAt.toISOString()
    } else if (doc.kind === "WZ") {
      const orders = (scope as { resolve<T>(k: string): T }).resolve<IOrderModuleService>(Modules.ORDER)
      const current = await orders.retrieveOrder(input.orderId, { select: ["id", "metadata"] }).catch(() => null)
      meta[ORDER_METADATA.wzNumber] = joinNumbers((current?.metadata as Record<string, unknown> | null)?.[ORDER_METADATA.wzNumber], doc.number)
      meta[ORDER_METADATA.wzIssuedAt] = issuedAt.toISOString()
    }
    if (Object.keys(meta).length > 0) await patchOrderMetadata(scope, input.orderId, meta)

    const o = svc.getOptions()
    if (doc.kind === "WZ" && input.allowFulfillment && o.fulfillOnWz && !demo) {
      fulfillmentError = await fulfillFromWz(scope, input.orderId, doc.number, o.stockLocationId || null)
    }
  }

  try {
    const bus = (scope as { resolve<T>(k: string): T }).resolve<IEventBusModuleService>(Modules.EVENT_BUS)
    await bus.emit({
      name: PLUGIN_EVENTS.documentIssued,
      data: { order_id: input.orderId, kind: doc.kind, number: doc.number, status, source: input.source, demo },
    })
  } catch (err) {
    svc.getLogger().warn(`[subiekt] Could not emit ${PLUGIN_EVENTS.documentIssued} for ${doc.number}: ${(err as Error).message}`)
  }

  row = (await svc.updateSubiektDocuments({ id: row.id, applied_at: new Date() } as never)) as unknown as DocumentRow
  return { row, fresh: true, fulfillmentError }
}

/** Fulfills every unfulfilled item of an order after a WZ. Returns an error text instead of throwing. */
async function fulfillFromWz(scope: Scope, orderId: string, wzNumber: string, locationId: string | null): Promise<string | null> {
  const svc = subiektService(scope)
  try {
    const { data } = await queryOf(scope).graph({
      entity: "order",
      fields: ["id", "status", "items.*", "items.detail.*"],
      filters: { id: orderId },
    })
    const order = data[0] as { status?: string; items?: Array<{ id: string; quantity?: unknown; detail?: { fulfilled_quantity?: unknown } | null }> } | undefined
    if (!order || order.status === "canceled") return null
    const items = (order.items ?? [])
      .map((i) => ({ id: i.id, quantity: Math.round(money(i.quantity) - money(i.detail?.fulfilled_quantity)) }))
      .filter((i) => i.quantity > 0)
    if (items.length === 0) return null
    await createOrderFulfillmentWorkflow(scope as never).run({
      input: { order_id: orderId, items, ...(locationId ? { location_id: locationId } : {}), metadata: { [ORDER_METADATA.wzNumber]: wzNumber } },
    })
    svc.getLogger().info(`[subiekt] ${wzNumber}: order ${orderId} fulfilled (${items.length} lines).`)
    return null
  } catch (err) {
    const message = svc.mask((err as Error)?.message ?? String(err))
    svc.getLogger().warn(`[subiekt] ${wzNumber}: could not fulfill order ${orderId}: ${message}`)
    return message
  }
}

/** Marks the stored documents of an order as canceled after the bridge confirmed it. */
export async function markDocumentsCanceled(scope: Scope, orderId: string, documents: ContractDocument[]): Promise<void> {
  const svc = subiektService(scope)
  const demo = svc.isDemo()
  for (const d of documents) {
    if (d.status !== "canceled") continue
    const rows = (await svc.listSubiektDocuments({ kind: d.kind, number: d.number, demo, order_id: orderId } as never, { take: 1 } as never)) as unknown as DocumentRow[]
    if (rows[0] && rows[0].status !== "canceled") await svc.updateSubiektDocuments({ id: rows[0].id, status: "canceled" } as never)
    else if (!rows[0]) await recordDocument(scope, { orderId, document: d, source: "bridge", allowFulfillment: false })
  }
}
