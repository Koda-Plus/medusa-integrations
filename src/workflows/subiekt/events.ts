/**
 * THE EVENT FEED: documents Subiekt issued on its own (a WZ the warehouse
 * printed from a ZK), read with a cursor. The cursor moves after every
 * applied event, so a crash in the middle repeats at most one event, and
 * applying an event is idempotent (documents are unique, side effects run
 * once).
 *
 * The bridge may also call `POST /hooks/subiekt` when something new waits.
 * That webhook only starts this read earlier; the feed stays the source of
 * truth, so a lost webhook costs two minutes, not a missing WZ.
 */

import { EVENTS_MAX_PAGES, EVENTS_PAGE_SIZE } from "../../modules/subiekt/lib/constants"
import type { BridgeEvent, RunTrigger } from "../../modules/subiekt/lib/contract"
import { describeError } from "../../modules/subiekt/lib/bridge-client"
import { recordDocument } from "./orders"
import { bridgeFor, exclusive, getConnection, markReachable, markUnreachable, recordRun, saveConnection, subiektService, type Scope } from "./runtime"

export interface PullStats {
  read: number
  applied: number
  duplicates: number
  ignored: number
  fulfillmentErrors: string[]
  stockChanged: boolean
  cursor: string
}

async function applyEvent(scope: Scope, event: BridgeEvent, stats: PullStats): Promise<void> {
  const doc = event.data?.document
  if ((event.type === "document.issued" || event.type === "document.canceled") && doc?.kind && doc.number) {
    const document = event.type === "document.canceled" ? { ...doc, status: "canceled" as const } : doc
    const res = await recordDocument(scope, {
      orderId: typeof event.data.order_id === "string" ? event.data.order_id : null,
      document,
      source: event.data.source ?? "subiekt",
      eventId: String(event.id),
      allowFulfillment: true,
    })
    if (res.fresh) stats.applied += 1
    else stats.duplicates += 1
    if (res.fulfillmentError && stats.fulfillmentErrors.length < 10) stats.fulfillmentErrors.push(`${doc.number}: ${res.fulfillmentError}`)
    return
  }
  if (event.type === "stock.changed") {
    stats.stockChanged = true
    return
  }
  // Unknown types are skipped on purpose: version 1.x of the contract may add some.
  stats.ignored += 1
}

/** Reads and applies new events. Returns null when a read already runs in this process. */
export async function pullEvents(scope: Scope, trigger: RunTrigger): Promise<PullStats | null> {
  return exclusive("events", async () => {
    const svc = subiektService(scope)
    const o = svc.getOptions()
    const conn = await getConnection(svc)
    const startCursor = Number(conn.events_cursor ?? 0) || 0
    const stats: PullStats = { read: 0, applied: 0, duplicates: 0, ignored: 0, fulfillmentErrors: [], stockChanged: false, cursor: String(startCursor) }
    if (!o.eventsEnabled || (!o.demo && !svc.isConfigured())) return stats

    const startedAt = new Date()
    const bridge = bridgeFor(scope)
    let cursor = startCursor
    let restarted = false
    try {
      for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
        const res = await bridge.listEvents(cursor, EVENTS_PAGE_SIZE)
        if (res.events.length === 0 && typeof res.head_id === "number" && res.head_id < cursor && !restarted) {
          // The bridge feed restarted (new bridge database, or another bridge): read it again from the start.
          svc.getLogger().warn(`[subiekt] The bridge event feed ends at ${res.head_id}, before our cursor ${cursor}: reading it again from 0.`)
          restarted = true
          cursor = 0
          await saveConnection(svc, { events_cursor: "0" })
          page -= 1
          continue
        }
        const events = [...res.events].sort((a, b) => a.id - b.id)
        for (const event of events) {
          if (event.id <= cursor) continue
          stats.read += 1
          await applyEvent(scope, event, stats)
          cursor = event.id
          await saveConnection(svc, { events_cursor: String(cursor) })
        }
        if (!res.has_more || events.length === 0) break
      }
      stats.cursor = String(cursor)
      await markReachable(svc, { events_read_at: new Date() })
      if (stats.read > 0 || trigger === "manual") {
        await recordRun(svc, {
          kind: "events",
          trigger,
          status: stats.fulfillmentErrors.length > 0 ? "partial" : "success",
          startedAt,
          stats: { ...stats },
          message: stats.read > 0 ? `${stats.applied} new document(s) from Subiekt.` : "Nothing new.",
        })
      }
      return stats
    } catch (err) {
      const d = describeError(err)
      const failuresBefore = conn.consecutive_failures ?? 0
      await markUnreachable(svc, d.message)
      // While the bridge stays down, one error run when it starts and one every hour, not one every 2 minutes.
      if (failuresBefore === 0 || trigger === "manual" || (failuresBefore + 1) % 30 === 0) {
        await recordRun(svc, { kind: "events", trigger, status: "error", startedAt, stats: { ...stats, cursor: String(cursor) }, message: `[${d.code}] ${d.message}` })
      }
      return stats
    }
  })
}
