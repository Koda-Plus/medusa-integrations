/**
 * THE ORDER EVENT JOURNAL (`GET /order/events`). Zero imports.
 *
 * Allegro keeps 60 days of events; `from` returns the events after a given
 * id, oldest first. The import uses the journal only to learn WHICH checkout
 * forms need attention: every event becomes (or touches) one row per form in
 * `allegro_order_import`, unique by the form id. The cursor moves only after
 * those rows are written, so an event can be read twice but never lost, and
 * reading it twice changes nothing.
 *
 * EVENT IDS ARE OPAQUE. Allegro documents them as strings, and the id in its
 * own example (`MTEzMjQzODU2ODEwMTUzMQ`) is a number in base64, whose text
 * order is not the order of the events. So the plugin never compares ids:
 * the order is the order of the answer, the cursor is the last event of a
 * page, and the only events left out are the cursor itself (when an answer
 * repeats it, with whatever came before it) and repeats inside one page.
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

/**
 * The new events of one page of the journal, in the order Allegro returned
 * them. Ids are never compared: when the page repeats the cursor, only what
 * follows it counts; a repeated id inside the page counts once.
 */
export function eventsAfter(page: readonly OrderEvent[], from: string | null): OrderEvent[] {
  const at = from ? page.findIndex((e) => e.id === from) : -1
  const seen = new Set<string>()
  const out: OrderEvent[] = []
  for (const e of page.slice(at + 1)) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out
}

/** The intents of a batch, merged per checkout form (a cancellation wins over an import); the last event of a form is the last one in the batch. */
export function intentsByForm(events: readonly OrderEvent[]): Map<string, { intent: EventIntent; lastEventId: string; lastType: string }> {
  const rank: Record<EventIntent, number> = { ignore: 0, refresh: 1, import: 2, cancel: 3 }
  const out = new Map<string, { intent: EventIntent; lastEventId: string; lastType: string }>()
  for (const e of events) {
    if (!e.checkoutFormId) continue
    const intent = intentOf(e.type)
    const prev = out.get(e.checkoutFormId)
    out.set(e.checkoutFormId, {
      intent: prev && rank[prev.intent] > rank[intent] ? prev.intent : intent,
      lastEventId: e.id,
      lastType: e.type,
    })
  }
  return out
}

export interface JournalCursor {
  id: string
  /** When the event at the cursor happened (Allegro keeps 60 days). */
  at: string | null
}

export interface DrainInput {
  /** The stored cursor; "0" when the account had no event when the import started. */
  from: string
  pageSize: number
  maxPages: number
  /** One page of `GET /order/events?from=` (null: from the start of the journal). */
  fetchPage(from: string | null): Promise<OrderEvent[]>
  /** Writes the rows of a page; returns how many rows it touched. */
  apply(events: OrderEvent[]): Promise<number>
  /** Stores the cursor, called only after `apply` of the same page succeeded. */
  save(cursor: JournalCursor): Promise<void>
}

/**
 * Drains the journal page by page: the rows of a page are written first, then
 * the cursor moves to the last event of that page. A crash between the two
 * reads the page again, which changes nothing. A page with nothing new stops
 * the drain without moving the cursor.
 */
export async function drainJournal(input: DrainInput): Promise<{ read: number; touched: number; cursor: string }> {
  let from = input.from
  let read = 0
  let touched = 0
  for (let page = 0; page < input.maxPages; page += 1) {
    const after = from === "0" ? null : from
    const raw = await input.fetchPage(after)
    const events = eventsAfter(raw, after)
    if (events.length === 0) break
    read += events.length
    touched += await input.apply(events)
    const last = events[events.length - 1]
    await input.save({ id: last.id, at: last.occurredAt })
    from = last.id
    if (raw.length < input.pageSize) break
  }
  return { read, touched, cursor: from }
}

/** A stored cursor older than Allegro's retention points at events that are gone. */
export function cursorExpired(cursorSetAt: Date | null, now: Date, retentionDays: number): boolean {
  if (!cursorSetAt) return false
  return now.getTime() - cursorSetAt.getTime() > (retentionDays - 2) * 24 * 60 * 60 * 1000
}
