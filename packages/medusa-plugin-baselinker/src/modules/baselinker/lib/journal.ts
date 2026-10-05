/**
 * THE ORDER JOURNAL: faster status pickup with fewer requests. Pure; imports
 * only the constants.
 *
 * `getJournalList` lists the order events of the last three days (status
 * changes, parcels, payments) after a log id. When it works, the status read
 * asks BaseLinker only about the orders that changed, instead of reading
 * every followed order. It must be enabled for the account ("it may return
 * an empty response; make sure it is enabled in your account API settings"),
 * and an empty answer cannot tell "nothing happened" from "not enabled", so:
 *
 *   - the full read keeps running every pass until the journal has returned
 *     at least one event (then it is known to work);
 *   - even then a full read runs every two hours, as a safety net;
 *   - a cursor older than two days goes the full way first (the journal keeps
 *     three days, and a plugin that was down longer has missed events).
 */

import { JOURNAL_FULL_PASS_MS, JOURNAL_LOG_TYPES, JOURNAL_STALE_MS } from "./constants"

export interface JournalLog {
  logId: number
  type: number
  orderId: string
  objectId: number
  /** Unix seconds. */
  date: number
}

export interface JournalState {
  lastLogId: number | null
  /** Unix seconds of the newest event seen. */
  lastEventAt: number | null
  /** Milliseconds of the last successful journal read. */
  lastReadAt: number | null
  /** Milliseconds of the last full status read. */
  lastFullAt: number | null
  /** The journal has returned events at least once: it is enabled. */
  everEvents: boolean
}

export function emptyJournal(): JournalState {
  return { lastLogId: null, lastEventAt: null, lastReadAt: null, lastFullAt: null, everEvents: false }
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** `logs` of `getJournalList`; the event id is `log_id` (the sample answer), `id` is read too. */
export function parseJournal(raw: readonly unknown[]): JournalLog[] {
  const out: JournalLog[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const l = item as Record<string, unknown>
    const logId = num(l.log_id) ?? num(l.id)
    const orderId = num(l.order_id)
    const type = num(l.log_type)
    if (logId === null || orderId === null || orderId <= 0 || type === null) continue
    out.push({ logId, type, orderId: String(orderId), objectId: num(l.object_id) ?? 0, date: num(l.date) ?? 0 })
  }
  return out.sort((a, b) => a.logId - b.logId)
}

/** What this pass does: read the journal, and whether the full status read runs too. */
export function journalPlan(state: JournalState, now: number, mode: "auto" | "off"): { read: boolean; full: boolean } {
  if (mode === "off") return { read: false, full: true }
  if (state.lastLogId === null) return { read: true, full: true }
  if (state.lastReadAt === null || now - state.lastReadAt > JOURNAL_STALE_MS) return { read: true, full: true }
  if (!state.everEvents) return { read: true, full: true }
  if (state.lastFullAt === null || now - state.lastFullAt > JOURNAL_FULL_PASS_MS) return { read: true, full: true }
  return { read: true, full: false }
}

/**
 * The state after one read, and the BaseLinker order ids that changed. Logs
 * at or below the cursor are ignored (whether `last_log_id` is inclusive is
 * not documented).
 */
export function applyJournal(state: JournalState, logs: readonly JournalLog[], now: number): { state: JournalState; orderIds: string[] } {
  const fresh = logs.filter((l) => state.lastLogId === null || l.logId > state.lastLogId)
  const orderIds = [...new Set(fresh.filter((l) => JOURNAL_LOG_TYPES.includes(l.type)).map((l) => l.orderId))]
  const lastLogId = fresh.reduce((max, l) => Math.max(max, l.logId), state.lastLogId ?? 0)
  const lastEventAt = fresh.reduce((max, l) => Math.max(max, l.date), state.lastEventAt ?? 0)
  return {
    state: {
      ...state,
      lastLogId: lastLogId > 0 ? lastLogId : state.lastLogId,
      lastEventAt: lastEventAt > 0 ? lastEventAt : state.lastEventAt,
      lastReadAt: now,
      everEvents: state.everEvents || fresh.length > 0,
    },
    orderIds,
  }
}

/** One word for the admin. */
export function journalHealth(state: JournalState | null, mode: "auto" | "off", demo: boolean): "active" | "empty" | "off" | "demo" | "unknown" {
  if (demo) return "demo"
  if (mode === "off") return "off"
  if (!state || state.lastReadAt === null) return "unknown"
  return state.everEvents ? "active" : "empty"
}
