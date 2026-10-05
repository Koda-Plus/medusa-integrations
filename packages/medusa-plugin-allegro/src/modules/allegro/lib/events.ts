/**
 * THE ORDER EVENT JOURNAL (`GET /order/events`). Zero imports.
 *
 * Allegro keeps 60 days of events; `from` returns the events after a given
 * id, oldest first. The import uses the journal only to learn WHICH checkout
 * forms need attention: every event becomes (or touches) one row per form in
 * `allegro_order_import`, unique by the form id. The cursor moves only after
 * those rows are written, so an event can be read twice but never lost, and
 * reading it twice changes nothing.
 */

export interface OrderEvent {
  id: string
  type: string
  occurredAt: string | null
  checkoutFormId: string | null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function eventsFromApi(raw: unknown): OrderEvent[] {
  const out: OrderEvent[] = []
  for (const item of Array.isArray(obj(raw).events) ? (obj(raw).events as unknown[]) : []) {
    const e = obj(item)
    const id = e.id === undefined || e.id === null ? "" : String(e.id).trim()
    if (!id) continue
    const form = obj(obj(e.order).checkoutForm)
    const occurred = typeof e.occurredAt === "string" && Number.isFinite(Date.parse(e.occurredAt)) ? new Date(e.occurredAt).toISOString() : null
    out.push({
      id,
      type: String(e.type ?? "").toUpperCase(),
      occurredAt: occurred,
      checkoutFormId: form.id === undefined || form.id === null ? null : String(form.id),
    })
  }
  return out
}

/** `GET /order/event-stats`: the newest event id, or null on an account without events. */
export function latestEventId(raw: unknown): string | null {
  const latest = obj(obj(raw).latestEvent)
  return latest.id === undefined || latest.id === null ? null : String(latest.id)
}

/** What an event asks of the import. */
export type EventIntent = "import" | "cancel" | "refresh" | "ignore"

export function intentOf(type: string): EventIntent {
  switch (type) {
    case "READY_FOR_PROCESSING":
      return "import"
    case "BUYER_CANCELLED":
    case "AUTO_CANCELLED":
      return "cancel"
    case "FULFILLMENT_STATUS_CHANGED":
    case "BUYER_MODIFIED":
    case "FILLED_IN":
      return "refresh"
    default:
      /* BOUGHT: no checkout form yet, nothing to import until it is ready. */
      return "ignore"
  }
}

/** Ids are numeric strings that grow; compared as numbers when they are, as text otherwise. */
export function compareEventIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1
    return a < b ? -1 : a > b ? 1 : 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** The intents of a batch, merged per checkout form (a cancellation wins over an import). */
export function intentsByForm(events: readonly OrderEvent[]): Map<string, { intent: EventIntent; lastEventId: string; lastType: string }> {
  const rank: Record<EventIntent, number> = { ignore: 0, refresh: 1, import: 2, cancel: 3 }
  const out = new Map<string, { intent: EventIntent; lastEventId: string; lastType: string }>()
  for (const e of events) {
    if (!e.checkoutFormId) continue
    const intent = intentOf(e.type)
    const prev = out.get(e.checkoutFormId)
    if (!prev) {
      out.set(e.checkoutFormId, { intent, lastEventId: e.id, lastType: e.type })
      continue
    }
    out.set(e.checkoutFormId, {
      intent: rank[intent] >= rank[prev.intent] ? intent : prev.intent,
      lastEventId: compareEventIds(e.id, prev.lastEventId) > 0 ? e.id : prev.lastEventId,
      lastType: compareEventIds(e.id, prev.lastEventId) > 0 ? e.type : prev.lastType,
    })
  }
  return out
}

/** A stored cursor older than Allegro's retention points at events that are gone. */
export function cursorExpired(cursorSetAt: Date | null, now: Date, retentionDays: number): boolean {
  if (!cursorSetAt) return false
  return now.getTime() - cursorSetAt.getTime() > (retentionDays - 2) * 24 * 60 * 60 * 1000
}
