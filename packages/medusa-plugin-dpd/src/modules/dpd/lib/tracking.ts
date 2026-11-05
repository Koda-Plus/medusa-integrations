import { readStoredBoxes } from "./boxes"
import { SHIPMENT_STAGES, STAGES_AFTER_READY, STATUS_MAX_AGE_DAYS, WAYBILL_PATTERN, type DpdMode, type ShipmentStage } from "./constants"
import { waybillsOf, type ShipmentRow } from "./dto"
import type { InfoEvent } from "./infoservices"
import type { ResolvedCode } from "./status-codes"

/**
 * THE STATE OF EVERY WAYBILL OF A SHIPMENT (dpd_shipment.tracking, DS4, 6.2):
 * its stage, whether DPD has it in hand, its newest event and its repins. The
 * fold of the events and the stage of the row are pure functions here; the
 * status pass (workflows/dpd/statuses.ts) asks, folds and writes.
 *
 * Nothing about the receiver: eventDataList is never read here, only the new
 * waybill of a repin (repinCandidate) is taken from it.
 */

export type TrackingRole = "outbound" | "return"

/** One waybill of a shipment (6.2). dpd_shipment.tracking is a list of these: box order, then the repinned old waybills. */
export type TrackingEntry = {
  waybill: string
  /** The position in waybills and boxes.items; an old waybill keeps its own after a repin. */
  box: number
  role: TrackingRole
  /** The stage of the newest known event that is not a notification. Delivered, and returned set by an event of this waybill (code not null), stay until a repin code (6.2 step 5, E7, O51). */
  stage: ShipmentStage | null
  /** Code and eventTime (ISO UTC) of the event that set `stage`. */
  code: string | null
  at: string | null
  possession: boolean
  /** The newest event that is not a notification, known or not: the source of the row status. */
  lastCode: string | null
  lastAt: string | null
  /** The DPD description of lastCode (O42); never data of the receiver (eventDataList is never read here). */
  description: string | null
  supersededBy: string | null
  supersededAt: string | null
  /** The waybill this one was repinned from. */
  from: string | null
  checkedAt: string | null
  /** Not asked any more: delivered, or repinned and asked once after the repin. */
  done: boolean
}

/** An event after the map and the insert: what the fold reads. */
export type MappedEvent = InfoEvent & {
  known: ResolvedCode | null
  /** The dpd_event id when this pass inserted it; null for a repeat (on conflict do nothing). */
  eventId: string | null
}

/** A repin the fold found (DS3). */
export type Repin = { from: string; to: string; box: number; role: TrackingRole; code: string; at: string; eventId: string | null }

function textOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}

function stageOrNull(v: unknown): ShipmentStage | null {
  return (SHIPMENT_STAGES as readonly unknown[]).includes(v) ? (v as ShipmentStage) : null
}

/** A new entry of a waybill without one: outbound, nothing known yet. */
function freshEntry(waybill: string, box: number): TrackingEntry {
  return {
    waybill,
    box,
    role: "outbound",
    stage: null,
    code: null,
    at: null,
    possession: false,
    lastCode: null,
    lastAt: null,
    description: null,
    supersededBy: null,
    supersededAt: null,
    from: null,
    checkedAt: null,
    done: false,
  }
}

/** One stored entry read leniently; null without a waybill. */
function entryOf(v: unknown): TrackingEntry | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  const waybill = textOrNull(r.waybill)
  if (!waybill) return null
  const box = typeof r.box === "number" && Number.isInteger(r.box) && r.box >= 0 ? r.box : 0
  return {
    waybill,
    box,
    role: r.role === "return" ? "return" : "outbound",
    stage: stageOrNull(r.stage),
    code: textOrNull(r.code),
    at: textOrNull(r.at),
    possession: r.possession === true,
    lastCode: textOrNull(r.lastCode),
    lastAt: textOrNull(r.lastAt),
    description: textOrNull(r.description),
    supersededBy: textOrNull(r.supersededBy),
    supersededAt: textOrNull(r.supersededAt),
    from: textOrNull(r.from),
    checkedAt: textOrNull(r.checkedAt),
    done: r.done === true,
  }
}

/**
 * The tracking column read leniently and reconciled with waybills (E6):
 * an entry is kept when its waybill is in waybills, or when it is superseded
 * and its supersededBy chain ends in a waybill of waybills; the first entry
 * of a waybill wins; a kept live entry takes box = its index in waybills;
 * every waybill without a live entry gets a new outbound entry at its index
 * (stage null, possession false). Order: box order, then the superseded
 * entries. Rows before stage 5 (no tracking): one outbound entry per
 * waybill (6.2). So waybills changed by stage 2 (waybill_mismatch, then
 * acceptShipment) are asked, and the stale ones are not. Full body from step 0.
 */
export function readTracking(value: unknown, waybills: readonly string[]): TrackingEntry[] {
  const stored: TrackingEntry[] = []
  const seen = new Set<string>()
  for (const v of Array.isArray(value) ? value : []) {
    const e = entryOf(v)
    if (!e || seen.has(e.waybill)) continue
    seen.add(e.waybill)
    stored.push(e)
  }
  const byWaybill = new Map(stored.map((e) => [e.waybill, e]))
  /* A superseded entry stays while its chain of supersededBy ends in a stored waybill. */
  const endsInWaybills = (e: TrackingEntry): boolean => {
    const visited = new Set<string>([e.waybill])
    let next = e.supersededBy
    while (next !== null && !visited.has(next)) {
      if (waybills.includes(next)) return true
      visited.add(next)
      next = byWaybill.get(next)?.supersededBy ?? null
    }
    return false
  }
  const live: TrackingEntry[] = []
  const used = new Set<string>()
  waybills.forEach((waybill, box) => {
    if (used.has(waybill)) return
    used.add(waybill)
    const e = byWaybill.get(waybill)
    live.push(e && e.supersededBy === null ? { ...e, box } : freshEntry(waybill, box))
  })
  const superseded = stored.filter((e) => e.supersededBy !== null && !used.has(e.waybill) && endsInWaybills(e))
  return [...live, ...superseded]
}

/** readTracking(row.tracking, waybillsOf(row.waybills)). Full body from step 0. */
export function trackingOf(row: Pick<ShipmentRow, "waybills"> & { tracking?: unknown }): TrackingEntry[] {
  return readTracking(row.tracking, waybillsOf(row.waybills))
}

/**
 * The entries to ask in this run: not done (live ones, and a repinned one
 * once after its repin), never asked first, then the oldest checkedAt, then
 * the order of readTracking (box order). A row cut by the call limit or the
 * budget goes on with the waybills it did not ask, so a row with more
 * waybills than one pass has calls still gets every one asked.
 */
export function waybillsToAsk(entries: readonly TrackingEntry[]): TrackingEntry[] {
  const checked = (e: TrackingEntry) => msOf(e.checkedAt) ?? -Infinity
  return entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.done)
    .sort((a, b) => checked(a.e) - checked(b.e) || a.i - b.i)
    .map(({ e }) => e)
}

const ENTITY_CDATA = /^<!\[CDATA\[([\s\S]*)\]\]>$/

/**
 * DS3: for 230402, 230403, 230408 only. The one value of event.data (CDATA
 * removed, trimmed) that matches WAYBILL_PATTERN and differs from
 * event.waybill: { to }. Candidates are deduplicated by value first, so the
 * same waybill under 01, 02 and 03 (the shape of the PDF s.16) is one
 * candidate (E15). None or several different ones: "unclear" (problem
 * repin_unclear in the history). Any other code: null.
 */
export function repinCandidate(event: Pick<InfoEvent, "waybill" | "code" | "data">, known: ResolvedCode | null): { to: string } | "unclear" | null {
  if (!known?.repin) return null
  const own = event.waybill.trim()
  const candidates = new Set<string>()
  for (const item of event.data) {
    let v = String(item.value ?? "").trim()
    const m = ENTITY_CDATA.exec(v)
    if (m) v = m[1].trim()
    if (WAYBILL_PATTERN.test(v) && v !== own) candidates.add(v)
  }
  if (candidates.size !== 1) return "unclear"
  const [to] = [...candidates]
  return { to }
}

/** Milliseconds of an ISO time, or null. */
function msOf(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** Milliseconds of a stored time (a Date or the text of a timestamptz), or null. */
function whenMs(v: Date | string | null | undefined): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (typeof v === "string" && v !== "") return msOf(v)
  return null
}

const DAY_MS = 86_400_000

/** delivered, and returned set by an event of this waybill, change only by a repin code (6.2 step 5, E7, O51). */
function sticky(stage: ShipmentStage | null, code: string | null): boolean {
  return stage === "delivered" || (stage === "returned" && code !== null)
}

export type WaybillFold = {
  /** The entry updated (checkedAt = now, done per 6.5), plus a new entry when a repin happened. */
  entries: TrackingEntry[]
  repin: Repin | null
  /** The repin of an entry superseded before this fold, seen again with the same new waybill (E57): no new entry, only what the history and dpd_waybills redo. */
  repeat: Repin | null
  /** Events with a repin code and no single candidate. */
  repinUnclear: MappedEvent[]
  /** The dpd_event id of the event that set the entry stage, when this pass inserted it; null for a repeat. */
  stageEventId: string | null
}

/** Steps 1 to 7 of 6.2 for one waybill. Pure; `events` in answer order. */
export function foldWaybill(entry: TrackingEntry, events: readonly MappedEvent[], now: Date): WaybillFold {
  const supersededBefore = entry.supersededBy !== null
  /* 1. By eventTime, ties in answer order; an unreadable time stays out of the fold (it is in the history only). */
  const timed = events
    .map((e, i) => ({ e, i, t: msOf(e.eventTime) }))
    .filter((x): x is { e: MappedEvent; i: number; t: number } => x.t !== null && x.e.code !== "")
    .sort((a, b) => a.t - b.t || a.i - b.i)
  /* 2. Notifications never move anything. */
  const moves = timed.filter((x) => x.e.known?.notification !== true)

  /* 3. Possession stays once seen. */
  const possession = entry.possession || moves.some((x) => x.e.known?.possession === true)

  /*
   * 4 and 5. The stage replayed from the whole answer (DS5: an ALL answer is
   * the whole history, so the stage never depends on what earlier passes
   * saw): the known codes in time order, and a sticky stage moves only by a
   * repin code later in time. A late event older than the stored stage (a
   * return scan a partner reports late) still counts. The event that set the
   * stored stage joins the replay when the answer lacks it (a partial answer
   * never moves the stage back), unless its code is unknown in this answer.
   * A stored stage that no known code set (a new entry, a return entry made
   * by a repin) gives way to the codes of this answer. The in_transit a
   * redirect gives its new waybill (E60) is a floor: the codes of that
   * waybill ranked below it (its own 030103 data registered) never take the
   * stage back to preparing, so the row never falls back to ready.
   */
  const unknownCodes = new Set(moves.filter((x) => x.e.known === null).map((x) => x.e.code))
  type Step = { t: number; stage: ShipmentStage; code: string; at: string | null; repin: boolean; eventId: string | null }
  const steps: Step[] = []
  const storedMs = msOf(entry.at)
  if (
    entry.stage !== null &&
    entry.code !== null &&
    storedMs !== null &&
    !unknownCodes.has(entry.code) &&
    !moves.some((x) => x.e.code === entry.code && x.t === storedMs)
  ) {
    steps.push({ t: storedMs, stage: entry.stage, code: entry.code, at: entry.at, repin: false, eventId: null })
  }
  for (const x of moves) {
    const k = x.e.known
    if (k !== null) steps.push({ t: x.t, stage: k.stage, code: x.e.code, at: x.e.eventTime, repin: Boolean(k.repin), eventId: x.e.eventId })
  }
  /* Stable: at the same time the stored event first, then the answer order. */
  steps.sort((a, b) => a.t - b.t)
  let byKnown = false
  let stage = entry.stage
  let code = entry.code
  let at = entry.at
  let stageEventId: string | null = null
  const floorRank = entry.from !== null && entry.code === null && entry.stage !== null ? STAGE_RANK[entry.stage] : undefined
  for (const x of steps) {
    if (floorRank !== undefined && (STAGE_RANK[x.stage] ?? floorRank) < floorRank) continue
    if (byKnown && sticky(stage, code) && !x.repin) continue
    stage = x.stage
    code = x.code
    at = x.at
    stageEventId = x.eventId
    byKnown = true
  }
  if (!byKnown) {
    /* No known code: in_transit from the newest unknown one; never over a stage a known code set. */
    const newestUnknown = [...moves].reverse().find((x) => x.e.known === null)
    if (newestUnknown) {
      stage = "in_transit"
      code = newestUnknown.e.code
      at = newestUnknown.e.eventTime
      stageEventId = newestUnknown.e.eventId
    }
  }

  /*
   * 6. A repin code with one candidate moves the parcel to a new waybill,
   * once (E2: never again for a superseded entry). The same repin seen again
   * on a superseded entry is a repeat (E57): it moves nothing.
   */
  let repin: Repin | null = null
  let repeat: Repin | null = null
  const repinUnclear: MappedEvent[] = []
  for (const x of moves) {
    const candidate = repinCandidate(x.e, x.e.known)
    if (candidate === "unclear") repinUnclear.push(x.e)
    else if (candidate && x.e.known?.repin) {
      const role: TrackingRole = x.e.known.repin === "return" ? "return" : entry.role
      const found: Repin = { from: entry.waybill, to: candidate.to, box: entry.box, role, code: x.e.code, at: new Date(x.t).toISOString(), eventId: x.e.eventId }
      if (!supersededBefore) repin ??= found
      else if (repeat === null && candidate.to === entry.supersededBy) repeat = found
    }
  }

  /* 7. The newest event that is not a notification, known or not, unless the stored one is newer. */
  let lastCode = entry.lastCode
  let lastAt = entry.lastAt
  let description = entry.description
  const newest = moves.length > 0 ? moves[moves.length - 1] : null
  if (newest && newest.t >= (msOf(entry.lastAt) ?? Number.NEGATIVE_INFINITY)) {
    lastCode = newest.e.code
    lastAt = newest.e.eventTime
    description = newest.e.description
  }

  const updated: TrackingEntry = {
    ...entry,
    stage,
    code,
    at,
    possession,
    lastCode,
    lastAt,
    description,
    supersededBy: repin ? repin.to : entry.supersededBy,
    supersededAt: repin ? repin.at : entry.supersededAt,
    checkedAt: now.toISOString(),
    /* 6.5: delivered, or repinned and now asked once after the repin. */
    done: stage === "delivered" || supersededBefore,
  }
  if (!repin) return { entries: [updated], repin: null, repeat, repinUnclear, stageEventId }
  const next: TrackingEntry = {
    waybill: repin.to,
    box: entry.box,
    role: repin.role,
    /* No code: a returned stage made by the repin is not sticky (6.2 step 5). */
    stage: repin.role === "return" ? "returned" : "in_transit",
    code: null,
    at: null,
    possession: true,
    lastCode: null,
    lastAt: null,
    description: null,
    supersededBy: null,
    supersededAt: null,
    from: entry.waybill,
    checkedAt: null,
    done: false,
  }
  return { entries: [updated, next], repin, repeat: null, repinUnclear, stageEventId }
}

export type RowFold = {
  tracking: TrackingEntry[]
  stage: ShipmentStage | null
  status: string | null
  /** ISO UTC of lastAt of the status entry. */
  statusAt: string | null
  /** Changed only by a repin; else the stored values. */
  waybills: string[]
  /** Changed only by a repin and only in the item whose waybill equals Repin.from (E26); else the stored value. */
  boxes: unknown
  repins: Repin[]
  /** WaybillFold.repeat of the entries folded now (E57): the history of these repins and dpd_waybills are written again if a failure or a restart lost them; the dedupe key and the compare in annotateFulfillment make it once. */
  repeats: Repin[]
  repinUnclear: MappedEvent[]
  /**
   * The event_id of 6.6 and 6.15 (E11): among the entries folded now (a
   * superseded one too) whose stage equals the new row stage, the
   * WaybillFold.stageEventId that is not null with the newest `at`, then
   * the lower box. Null when there is none: the stage came from an earlier
   * pass, or from rule 4 with O17 (ready).
   */
  stageEventId: string | null
}

/**
 * Every answered waybill folded, the rest kept (6.1); row stage by rowStage,
 * status by rowStatus; a repin swaps the waybill in place in waybills (at
 * the index of `from`) and in boxes: readStoredBoxes(row.boxes), then the
 * first item whose waybill equals `from` gets { ...item, waybill: to }
 * (E26). No such item (a row accepted with waybill_count_mismatch has fewer
 * boxes than waybills) or boxes null: boxes stay as stored, never an item
 * added and never an index past items.length. `answered` holds only
 * waybills with an ok outcome.
 * A Repin of an entry that was superseded before this fold, or whose `to`
 * already has an entry in tracking, is dropped (E2): no new entry, not in
 * `repins`, waybills and boxes unchanged; the old entry keeps supersededBy
 * and supersededAt, the rest of its fold (stage, lastCode, checkedAt, done)
 * stays. The old waybill asked once more after its repin (DS3, ALL) brings
 * the same repin event again, so this is the normal path, not an error;
 * that repin, with the same new waybill, is in `repeats` (E57).
 */
export function foldRow(row: ShipmentRow, answered: ReadonlyMap<string, readonly MappedEvent[]>, now: Date): RowFold {
  const entries = trackingOf(row)
  const waybills = waybillsOf(row.waybills)
  let boxes: unknown = row.boxes
  const known = new Set(entries.map((e) => e.waybill))
  const kept: TrackingEntry[] = []
  const added: TrackingEntry[] = []
  const folded: Array<{ entry: TrackingEntry; stageEventId: string | null }> = []
  const repins: Repin[] = []
  const repeats: Repin[] = []
  const repinUnclear: MappedEvent[] = []
  for (const entry of entries) {
    const events = answered.get(entry.waybill)
    if (!events) {
      kept.push(entry)
      continue
    }
    const fold = foldWaybill(entry, events, now)
    let updated = fold.entries[0]
    repinUnclear.push(...fold.repinUnclear)
    if (fold.repeat) repeats.push(fold.repeat)
    const repin = fold.repin
    if (repin && (entry.supersededBy !== null || known.has(repin.to))) {
      /* E2: a repin already made (or a waybill the row has) is dropped; the entry keeps the supersededBy it had. */
      updated = { ...updated, supersededBy: entry.supersededBy, supersededAt: entry.supersededAt }
    } else if (repin) {
      known.add(repin.to)
      added.push(...fold.entries.slice(1))
      repins.push(repin)
      const at = waybills.indexOf(repin.from)
      if (at >= 0) waybills[at] = repin.to
      boxes = swapBoxWaybill(boxes, repin.from, repin.to)
    }
    kept.push(updated)
    folded.push({ entry: updated, stageEventId: fold.stageEventId })
  }
  const tracking = readTracking([...kept, ...added], waybills)
  const stage = rowStage(tracking, { stage: row.stage, handed_over_at: row.handed_over_at, waybills })
  const status = rowStatus(tracking)
  const storedStatusAt = whenMs(row.status_at)
  /* E11: the newest event inserted now among the entries folded now at the new row stage, then the lower box. */
  let stageEventId: string | null = null
  let best: { at: number; box: number } | null = null
  for (const f of folded) {
    if (f.stageEventId === null || f.entry.stage !== stage) continue
    const fAt = msOf(f.entry.at) ?? Number.NEGATIVE_INFINITY
    if (best === null || fAt > best.at || (fAt === best.at && f.entry.box < best.box)) {
      best = { at: fAt, box: f.entry.box }
      stageEventId = f.stageEventId
    }
  }
  return {
    tracking,
    stage,
    /* No event at all: the stored status stays. */
    status: status.status ?? row.status,
    statusAt: status.status !== null ? status.statusAt : storedStatusAt === null ? null : new Date(storedStatusAt).toISOString(),
    waybills,
    boxes,
    repins,
    repeats,
    repinUnclear,
    stageEventId,
  }
}

/** E26: the first box that carried `from` gets `to`; no such box, or boxes unreadable: the stored value as it is. */
function swapBoxWaybill(boxes: unknown, from: string, to: string): unknown {
  const stored = readStoredBoxes(boxes)
  if (!stored) return boxes
  const at = stored.items.findIndex((item) => item.waybill === from)
  if (at < 0) return boxes
  const items = stored.items.map((item, i) => (i === at ? { ...item, waybill: to } : item))
  return { ...stored, items }
}

/**
 * The row stage of 6.2 (rules 1 to 5; canceled is never overwritten). In
 * rule 4 a live outbound entry without a stage counts as preparing (ready
 * with handed_over_at set), so rule 4 never gives delivered: delivered comes
 * only from rule 3 (E1, O48). Rule 4 giving preparing on a row with
 * handed_over_at set gives ready (O17, 6.16).
 */
export function rowStage(entries: readonly TrackingEntry[], row: Pick<ShipmentRow, "stage" | "handed_over_at" | "waybills">): ShipmentStage | null {
  if (row.stage === "canceled") return "canceled"
  const live = entries.filter((e) => e.supersededBy === null)
  /* 1. A return under way or back, before everything else. */
  if (live.some((e) => e.role === "return" || e.stage === "returned")) return "returned"
  /* 2. */
  if (live.some((e) => e.stage === "problem")) return "problem"
  /* 3. Delivered only when every live outbound waybill is. */
  const outbound = live.filter((e) => e.role === "outbound")
  if (outbound.length > 0 && outbound.every((e) => e.stage === "delivered")) return "delivered"
  /* 4. The lowest stage; a live outbound waybill without one counts as preparing (E1, O48), so this rule never gives delivered. */
  if (live.some((e) => e.stage !== null)) {
    let lowest: ShipmentStage | null = null
    for (const e of outbound) {
      const s: ShipmentStage = e.stage ?? "preparing"
      const rank = STAGE_RANK[s]
      if (rank === undefined || s === "delivered") continue
      if (lowest === null || rank < (STAGE_RANK[lowest] ?? rank)) lowest = s
    }
    if (lowest !== null) return lowest === "preparing" && row.handed_over_at ? "ready" : lowest
  }
  /* 5. Nothing known: the stored stage stays. */
  return stageOrNull(row.stage)
}

/** lastCode and lastAt of the newest entry (superseded ones too); null and null without events. Full body from step 0 (toShipmentDto reads the description, E18). */
export function rowStatus(entries: readonly TrackingEntry[]): { status: string | null; statusAt: string | null; description: string | null } {
  let newest: TrackingEntry | null = null
  let newestMs = Number.NEGATIVE_INFINITY
  for (const e of entries) {
    if (e.lastCode === null || e.lastAt === null) continue
    const ms = Date.parse(e.lastAt)
    if (!Number.isFinite(ms) || ms <= newestMs) continue
    newest = e
    newestMs = ms
  }
  return newest ? { status: newest.lastCode, statusAt: newest.lastAt, description: newest.description } : { status: null, statusAt: null, description: null }
}

/** 6.5: STATUS_MAX_AGE_DAYS passed since the handover (or since the row, without one). */
function pastStatusAge(row: Pick<ShipmentRow, "handed_over_at" | "created_at">, now: Date): boolean {
  const since = whenMs(row.handed_over_at) ?? whenMs(row.created_at)
  return since !== null && since <= now.getTime() - STATUS_MAX_AGE_DAYS * DAY_MS
}

/** The parcel came back to the shop: a live return waybill is delivered. */
function backAtShop(entries: readonly TrackingEntry[]): boolean {
  return entries.some((e) => e.supersededBy === null && e.role === "return" && e.stage === "delivered")
}

/** 6.5: no more asks (also the selection of the retention, DS17). */
export function trackingDone(row: Pick<ShipmentRow, "kind" | "state" | "stage" | "handed_over_at" | "created_at" | "waybills"> & { tracking?: unknown }, now: Date): boolean {
  if (row.kind !== "outbound") return true
  if (row.state !== "created" && row.state !== "labeled") return true
  if (row.stage === "delivered" || row.stage === "canceled") return true
  if (pastStatusAge(row, now)) return true
  const entries = trackingOf(row)
  if (row.stage === "returned" && backAtShop(entries)) return true
  /* Nothing left to ask (6.10 point 1): no waybill, or every one done. */
  return waybillsToAsk(entries).length === 0
}

/**
 * E61: a returned row whose way back is over, so it no longer waits for a
 * person (group returns, not problems): a live return waybill is delivered
 * back at the shop, or STATUS_MAX_AGE_DAYS passed and the plugin stopped
 * following it (6.5). RETURN_DONE_SQL in store.ts is the same rule.
 */
export function returnDone(row: Pick<ShipmentRow, "stage" | "handed_over_at" | "created_at" | "waybills"> & { tracking?: unknown }, now: Date): boolean {
  if (row.stage !== "returned") return false
  return pastStatusAge(row, now) || backAtShop(trackingOf(row))
}

/** wantShip of 6.4: some entry (superseded too, any role) has possession. Full body from step 0 (isPickedUp needs it). */
export function hasPossession(entries: readonly TrackingEntry[]): boolean {
  return entries.some((e) => e.possession)
}

/**
 * DS13: shipped_marked_at set, or hasPossession(trackingOf(row)), or the
 * stage is one of STAGES_AFTER_READY. A problem stage blocks only with
 * possession: 040201 without possession is not picked up (E25, E28, O53).
 * Full body from step 0.
 */
export function isPickedUp(row: Pick<ShipmentRow, "stage" | "shipped_marked_at" | "waybills"> & { tracking?: unknown }): boolean {
  if (row.shipped_marked_at) return true
  if (hasPossession(trackingOf(row))) return true
  return (STAGES_AFTER_READY as readonly unknown[]).includes(row.stage)
}

/** The order of rule 4 of rowStage: preparing < ready < in_transit < in_point < delivered. */
export const STAGE_RANK: Readonly<Partial<Record<ShipmentStage, number>>> = { preparing: 0, ready: 1, in_transit: 2, in_point: 3, delivered: 4 }

/** dpd_setting keys of the status pass (DS6, DS15, DS17): <mode>:status:<name>. Full body from step 0. */
export const STATUS_SETTING_NAMES = ["lastSyncAt", "problem", "prunedAt"] as const
export type StatusSettingName = (typeof STATUS_SETTING_NAMES)[number]
export function statusSettingKey(mode: DpdMode, name: StatusSettingName): string {
  return `${mode}:status:${name}`
}
/** Values stored under those keys. */
export type StatusSyncValue = { at: string; source: "simulated" | "dpd"; asked: number; newEvents: number }
export type StatusProblemValue = { code: "statuses_auth"; at: string }
export type StatusPrunedValue = { at: string; deleted: number }
