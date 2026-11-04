/**
 * THE DPD STATUSES (stage 5). A pass every 5 minutes (dpd-sync-statuses)
 * asks InfoServices (or the simulator of demo and the sandbox) for the
 * events of the waybills that are due, stores them once (DS5), folds them
 * into the tracking of the row, writes the stage with a compare and set,
 * emits the status events and runs the fulfillmentStatus writer, which marks
 * the Medusa fulfillment shipped and delivered (6.4).
 *
 * Between processes only the database decides (S12): the claim of
 * pickDueForStatus, the compare and set of applyTracking and the writer
 * marks (claimMark, releaseMark). exclusive("status") and
 * exclusive("status:<id>") guard one process only; no lock is ever taken on
 * an order id.
 *
 * Neither the eventDataList values (apart from the new waybill of a repin)
 * nor the InfoServices login, password or envelope ever go to a log, a
 * history row, an event or an answer.
 */

import {
  PACING_MAX_WAIT_MS,
  STATUS_BATCH_WAYBILLS,
  STATUS_EVENT_RETENTION_DAYS,
  STATUS_MAX_AGE_DAYS,
  STATUS_PASS_BUDGET_MS,
  STATUS_PRUNE_EVERY_MS,
  STATUS_SPACING_BEFORE_HANDOVER_MIN,
  STATUS_SPACING_MIN,
  STATUS_WRITER_MIN_ROWS,
  STATUS_WRITER_RESERVE_MS,
  WRITER_MARK_STALE_MS,
} from "../../modules/dpd/lib/constants"
import type { StatusHistoryAction, StatusSource, WriterRetryResult } from "../../modules/dpd/lib/contract"
import { shipmentStageOf, toShipmentEvent, waybillsOf, type ShipmentRow } from "../../modules/dpd/lib/dto"
import { SHIPMENT_CREATED_EVENT, SHIPMENT_DELIVERED_EVENT, SHIPMENT_STATUS_CHANGED_EVENT } from "../../modules/dpd/lib/events"
import { eventSecond, statusDedupeKey, statusSourceOf, type WaybillEventsOutcome } from "../../modules/dpd/lib/infoservices"
import { buildCodeMap, type CodeMap } from "../../modules/dpd/lib/status-codes"
import type { DueRow, MarkColumn, TrackingExpect, TrackingWrite } from "../../modules/dpd/lib/store"
import { clip } from "../../modules/dpd/lib/text"
import {
  foldRow,
  hasPossession,
  statusSettingKey,
  trackingDone,
  trackingOf,
  waybillsToAsk,
  type MappedEvent,
  type StatusProblemValue,
  type StatusPrunedValue,
  type StatusSyncValue,
} from "../../modules/dpd/lib/tracking"
import type DpdModuleService from "../../modules/dpd/service"
import { mustFind, sourceOf } from "./create"
import {
  ActionError,
  annotateFulfillment,
  coreFlowsFor,
  dpdService,
  emitShipmentEvent,
  errorText,
  exclusive,
  getSetting,
  isArmed,
  listShipments,
  readFulfillmentForStatus,
  recordEvent,
  requireArmed,
  statusReaderFor,
  storeFor,
  type CoreFlows,
  type CreateOrderShipmentInput,
  type FulfillmentStatusState,
  type Scope,
  type StatusReader,
} from "./runtime"

export type StatusPassResult = {
  ran: boolean
  source: StatusSource
  /** Rows claimed by pickDueForStatus. */
  picked: number
  /** Calls made (or simulated). */
  asked: number
  newEvents: number
  stageChanges: number
  repins: number
  writerRuns: number
  /** Writer backlog rows run without a DPD call (due_kind writer, and trackingDone rows with writerBacklog; 6.19). */
  backlog: number
  /** Writer marks released as writer_interrupted (E4, 6.19). */
  interrupted: number
  /** Why the pass stopped early, if it did. */
  stoppedBy: "auth" | "budget" | "limit" | null
  pruned: number
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000
const MARK_COLUMNS: readonly MarkColumn[] = ["shipped_marked_at", "delivered_marked_at"]
const READ_FAILED_NOTE = "Not written to Medusa yet: the fulfillment could not be read. Write it again."
const WAITING_NOTE = "Not written to Medusa yet: waiting for the shipped mark of another write. Write it again if it stays."
/** Skips after which nothing is left to write, so a stale error is cleared by a retry (O34). */
const NOTHING_LEFT: readonly WriterSkip[] = ["not_outbound", "no_fulfillment", "stage_canceled", "nothing_wanted", "fulfillment_gone", "fulfillment_canceled"]

function whenMs(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (typeof v === "string" && v !== "") {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

/** The `at` of a stored status setting, read leniently. */
function settingAt(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return whenMs((value as { at?: unknown }).at)
}

function norm(waybill: string): string {
  return waybill.trim().toUpperCase()
}

/** The Medusa column a writer mark stands for. */
function medusaColumn(col: MarkColumn): "shipped_at" | "delivered_at" {
  return col === "shipped_marked_at" ? "shipped_at" : "delivered_at"
}

/** demo and sandbox: statuses are simulated (DS9); the sandbox history says so in its message too (S6). */
function simulation(svc: DpdModuleService): { simulated: boolean; prefix: string } {
  const o = svc.getOptions()
  if (o.demo) return { simulated: true, prefix: "" }
  return o.mode === "live" ? { simulated: false, prefix: "" } : { simulated: true, prefix: "Simulated status: " }
}

/** A history entry of the statuses (S6): kind action, the actor, data.action from STATUS_HISTORY_ACTIONS, simulated in demo and the sandbox. */
async function recordStatusAction(
  scope: Scope,
  row: ShipmentRow,
  actor: string | null,
  message: string,
  data: { action: StatusHistoryAction } & Record<string, unknown>,
): Promise<void> {
  const svc = dpdService(scope)
  const sim = simulation(svc)
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: sourceOf(actor),
    actor,
    message: message.startsWith("Simulated status: ") ? message : `${sim.prefix}${message}`,
    data: sim.simulated ? { ...data, simulated: true } : data,
    mode: svc.mode(),
  })
}

/** The row as stored now; the given row when it is gone or the read fails (logged). */
async function reread(scope: Scope, row: ShipmentRow): Promise<ShipmentRow> {
  const svc = dpdService(scope)
  try {
    return (await listShipments(svc, { id: row.id }, { take: 1 }))[0] ?? row
  } catch (err) {
    svc.getLogger().warn(`[dpd] status ${row.id}: reading the shipment failed: ${errorText(svc, err)}`)
    return row
  }
}

/**
 * The row after releaseStaleMarks released `released`: read fresh; when the
 * read fails, `row` with those columns null in memory (6.19 point 3), so a
 * released mark never reaches the writer again as a claim.
 */
async function afterRelease(scope: Scope, row: ShipmentRow, released: readonly MarkColumn[]): Promise<ShipmentRow> {
  if (released.length === 0) return row
  const fallback: ShipmentRow = { ...row }
  for (const col of released) fallback[col] = null
  return reread(scope, fallback)
}

/* ------------------------------------------------------------------ */
/* The pass (6.9)                                                      */
/* ------------------------------------------------------------------ */

/**
 * The job (DS6, 6.9). exclusive("status") already held in this process: the
 * idle result (ran false, source statusSourceOf(o), every count 0, stoppedBy
 * null). Source off: no claim, only the retention (ran false). Else
 * pickDueForStatus with STATUS_BATCH_WAYBILLS (and the writer backlog when
 * the fulfillmentStatus writer is armed, not demo), releaseStaleMarks (armed
 * or not, not demo) and refreshRow per status
 * row in the order of prev_checked_at until the budget (less
 * STATUS_WRITER_RESERVE_MS while backlog rows wait) or the call limit, then
 * runStatusWriter alone per writer backlog row, at least
 * STATUS_WRITER_MIN_ROWS of them, then until the budget (6.19),
 * unclaimStatus for the rows not reached (E3), retention once a day,
 * lastSyncAt. Never throws.
 */
export async function runStatusPass(scope: Scope, now?: Date): Promise<StatusPassResult> {
  const at = now ?? new Date()
  let source: StatusSource = "off"
  try {
    source = statusSourceOf(dpdService(scope).getOptions())
  } catch {
    /* no service: nothing to do, the idle result below */
  }
  const idle: StatusPassResult = { ran: false, source, picked: 0, asked: 0, newEvents: 0, stageChanges: 0, repins: 0, writerRuns: 0, backlog: 0, interrupted: 0, stoppedBy: null, pruned: 0 }
  try {
    return (await exclusive("status", () => statusPass(scope, at, idle))) ?? idle
  } catch {
    return idle
  }
}

/** The order of the claim (E3): prev_checked_at ascending, never asked first, then the id. */
function claimOrder(a: DueRow, b: DueRow): number {
  const x = whenMs(a.prev_checked_at)
  const y = whenMs(b.prev_checked_at)
  if (x !== y) {
    if (x === null) return -1
    if (y === null) return 1
    return x - y
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

async function statusPass(scope: Scope, now: Date, idle: StatusPassResult): Promise<StatusPassResult> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const mode = svc.mode()
  const store = storeFor(scope)
  const logger = svc.getLogger()
  const reader = statusReaderFor(scope)
  if (!reader) return { ...idle, ran: false, source: "off", pruned: await prune(scope, now) }
  const out: StatusPassResult = { ...idle, ran: true, source: reader.source }
  try {
    let hadProblem = false
    if (reader.source === "dpd") {
      try {
        hadProblem = (await getSetting(svc, statusSettingKey(mode, "problem"))) !== null
      } catch (err) {
        logger.warn(`[dpd] Statuses: reading the status problem failed: ${errorText(svc, err)}`)
      }
    }
    let writerBacklog = false
    if (mode !== "demo") {
      try {
        writerBacklog = await isArmed(svc, "fulfillmentStatus")
      } catch (err) {
        logger.warn(`[dpd] Statuses: reading the writers failed: ${errorText(svc, err)}`)
      }
    }
    const ctx: StatusContext = {
      reader,
      map: buildCodeMap(o.statusMap),
      now,
      callsLeft: { n: STATUS_BATCH_WAYBILLS },
      deadline: Date.now() + STATUS_PASS_BUDGET_MS,
      actor: "system",
      trigger: "pass",
    }
    let rows: DueRow[] = []
    try {
      rows = await store.pickDueForStatus({
        mode,
        now,
        limit: STATUS_BATCH_WAYBILLS,
        maxAgeDays: STATUS_MAX_AGE_DAYS,
        spacingMin: STATUS_SPACING_MIN,
        spacingBeforeHandoverMin: STATUS_SPACING_BEFORE_HANDOVER_MIN,
        writerBacklog,
        markStaleMs: WRITER_MARK_STALE_MS,
      })
    } catch (err) {
      logger.warn(`[dpd] Statuses: picking due rows failed: ${errorText(svc, err)}`)
    }
    out.picked = rows.length
    const statusRows = rows.filter((r) => r.due_kind !== "writer").sort(claimOrder)
    const writerRows = rows.filter((r) => r.due_kind === "writer").sort(claimOrder)
    const giveBack: DueRow[] = []
    /* The status rows never use up the pass the writer backlog needs: they stop asking earlier while backlog rows wait. */
    const passDeadline = ctx.deadline
    if (writerRows.length > 0) ctx.deadline = passDeadline - STATUS_WRITER_RESERVE_MS

    const backlogRun = async (row: DueRow): Promise<void> => {
      const done = await backlogRow(scope, row, now)
      out.backlog += 1
      out.interrupted += done.released
      if (done.readFailed) giveBack.push(row)
      else if (done.writer && done.writer.skipped === null) out.writerRuns += 1
    }

    let i = 0
    for (; i < statusRows.length; i += 1) {
      if (out.stoppedBy) break
      if (ctx.callsLeft.n <= 0) {
        out.stoppedBy = "limit"
        break
      }
      if (Date.now() >= ctx.deadline) {
        out.stoppedBy = "budget"
        break
      }
      const row = statusRows[i]
      try {
        /*
         * A parcel back at the shop (6.5): no call; with the writer armed its
         * pending write runs as backlog (6.19 point 3). Disarmed (or the
         * writers unreadable), its stale marks are still released: the claim
         * moved last_checked_at, which uses up the one check of a stale mark.
         */
        if (trackingDone(row, now)) {
          if (writerBacklog) await backlogRun(row)
          else if (mode !== "demo") {
            const rel = await releaseStaleMarks(scope, row, { actor: "system", now, checkedBefore: row.prev_checked_at, anyError: false })
            out.interrupted += rel.released.length
            if (rel.readFailed) giveBack.push(row)
          }
          continue
        }
        /*
         * Stale marks are released before the call whether or not the writer
         * is armed: releasing needs no writer, and the claim (with the refresh
         * below) moves last_checked_at past the one check of the mark, so a
         * pass with the writer disarmed would lose that check for good.
         */
        let current: ShipmentRow = row
        if (mode !== "demo") {
          const rel = await releaseStaleMarks(scope, row, { actor: "system", now, checkedBefore: row.prev_checked_at, anyError: false })
          out.interrupted += rel.released.length
          current = await afterRelease(scope, row, rel.released)
        }
        const run = await refreshRow(scope, current, ctx)
        out.asked += run.asked
        out.newEvents += run.newEvents
        out.stageChanges += run.stageChanged ? 1 : 0
        out.repins += run.repins
        out.writerRuns += run.writer && run.writer.skipped === null ? 1 : 0
        if (run.asked === 0 && run.outcome === "skipped") giveBack.push(row)
        if (hadProblem && run.answered > 0) {
          await releaseProblem(scope)
          hadProblem = false
        }
        if (run.outcome === "auth") {
          await recordAuthProblem(scope, now)
          logger.error("[dpd] status pass: InfoServices refused the login; statuses stop until it answers again.")
          out.stoppedBy = "auth"
        }
      } catch (err) {
        logger.warn(`[dpd] status ${row.id}: ${errorText(svc, err)}`)
      }
    }

    /* The writer backlog (6.19): no DPD call, no callsLeft, also after a stop on limit or auth; the first rows also after the budget. */
    let j = 0
    for (; j < writerRows.length; j += 1) {
      if (j >= STATUS_WRITER_MIN_ROWS && Date.now() >= passDeadline) {
        out.stoppedBy ??= "budget"
        break
      }
      const row = writerRows[j]
      try {
        await backlogRun(row)
      } catch (err) {
        logger.warn(`[dpd] status ${row.id}: ${errorText(svc, err)}`)
      }
    }

    const rest = [...statusRows.slice(i), ...writerRows.slice(j), ...giveBack]
    if (rest.length > 0) {
      try {
        await store.unclaimStatus(
          rest.map((r) => ({ id: r.id, prev_checked_at: r.prev_checked_at })),
          now,
        )
      } catch (err) {
        logger.warn(`[dpd] Statuses: giving back the claim failed: ${errorText(svc, err)}`)
      }
    }
  } catch (err) {
    logger.warn(`[dpd] Statuses: ${errorText(svc, err)}`)
  }

  out.pruned = await prune(scope, now)
  try {
    const value: StatusSyncValue = { at: new Date().toISOString(), source: reader.source, asked: out.asked, newEvents: out.newEvents }
    await store.setSetting(statusSettingKey(mode, "lastSyncAt"), value, null)
  } catch (err) {
    logger.warn(`[dpd] Statuses: saving the last sync failed: ${errorText(svc, err)}`)
  }
  if (out.asked > 0 || out.backlog > 0 || out.interrupted > 0 || out.pruned > 0 || out.stoppedBy) {
    logger.info(
      `[dpd] Statuses: ${out.picked} picked, ${out.asked} asked, ${out.newEvents} new events, ${out.stageChanges} stage changes, ${out.repins} repins, ${out.writerRuns} writer runs, ${out.backlog} backlog rows, ${out.interrupted} marks released, ${out.pruned} events pruned.${out.stoppedBy ? ` Stopped by ${out.stoppedBy}.` : ""}`,
    )
  }
  return out
}

/** 6.19 point 3: stale marks released, then the writer alone; a failed read of the fulfillment gives the claim back without a writer. */
async function backlogRow(scope: Scope, row: DueRow, now: Date): Promise<{ readFailed: boolean; released: number; writer: WriterRun | null }> {
  const rel = await releaseStaleMarks(scope, row, { actor: "system", now, checkedBefore: row.prev_checked_at, anyError: false })
  if (rel.readFailed) return { readFailed: true, released: 0, writer: null }
  const current = await afterRelease(scope, row, rel.released)
  const writer = await runStatusWriter(scope, current, { actor: "system", now })
  return { readFailed: false, released: rel.released.length, writer }
}

/** DS17 once a day (also with the source off); a failure is logged and tried again by the next pass. */
async function prune(scope: Scope, now: Date): Promise<number> {
  const svc = dpdService(scope)
  const mode = svc.mode()
  const store = storeFor(scope)
  const logger = svc.getLogger()
  let deleted = 0
  try {
    const last = await getSetting(svc, statusSettingKey(mode, "prunedAt"))
    const at = settingAt(last?.value)
    if (at !== null && now.getTime() - at < STATUS_PRUNE_EVERY_MS) return 0
    deleted = await store.pruneStatusEvents(mode, new Date(now.getTime() - STATUS_EVENT_RETENTION_DAYS * DAY_MS), now)
    const value: StatusPrunedValue = { at: now.toISOString(), deleted }
    await store.setSetting(statusSettingKey(mode, "prunedAt"), value, null)
  } catch (err) {
    logger.warn(`[dpd] Statuses: pruning failed: ${errorText(svc, err)}`)
  }
  return deleted
}

/** S8: the login problem of InfoServices, kept until the next answered call. */
async function recordAuthProblem(scope: Scope, now: Date): Promise<void> {
  const svc = dpdService(scope)
  try {
    const value: StatusProblemValue = { code: "statuses_auth", at: now.toISOString() }
    await storeFor(scope).setSetting(statusSettingKey(svc.mode(), "problem"), value, null)
  } catch (err) {
    svc.getLogger().warn(`[dpd] Statuses: saving the login problem failed: ${errorText(svc, err)}`)
  }
}

async function releaseProblem(scope: Scope): Promise<void> {
  const svc = dpdService(scope)
  try {
    await storeFor(scope).releaseSetting(statusSettingKey(svc.mode(), "problem"))
  } catch (err) {
    svc.getLogger().warn(`[dpd] Statuses: clearing the login problem failed: ${errorText(svc, err)}`)
  }
}

/* ------------------------------------------------------------------ */
/* One row (6.10)                                                      */
/* ------------------------------------------------------------------ */

/** What one row did. `outcome` "auth" stops the pass; "partial": some waybills unclear or skipped. */
export type RowRun = {
  row: ShipmentRow
  asked: number
  newEvents: number
  changed: boolean
  outcome: "ok" | "partial" | "auth" | "skipped"
  writer: WriterRun | null
  /** Waybills with an ok outcome (6.10); 0: no fold, no write, no writer. */
  answered: number
  /** Waybills with an unclear outcome. */
  unclear: number
  /** Asking stopped on nothingSent (a refresh answers 429 when answered is 0). */
  rateLimited: boolean
  /** RowFold.repins.length (history written whatever the compare and set gave). */
  repins: number
  /** The won applyTracking changed the stage (status_changed emitted). */
  stageChanged: boolean
}
/** Shared context of one pass or one refresh. */
export type StatusContext = {
  reader: StatusReader
  map: CodeMap
  now: Date
  /** Calls left; the row stops asking at 0. */
  callsLeft: { n: number }
  /** Date.now() past this: stop asking. */
  deadline: number
  actor: string | null
  trigger: "pass" | "refresh"
}

/** The waybills a refresh asks (10.3 point 6, O33): every live one, done too, plus the repinned ones not done yet. */
function refreshAsks(row: Pick<ShipmentRow, "waybills"> & { tracking?: unknown }): string[] {
  return trackingOf(row)
    .filter((e) => e.supersededBy === null || !e.done)
    .map((e) => e.waybill)
}

/** 6.1 for one row: ask, insert events (DS5), foldRow, applyTracking, emit, annotateFulfillment on a repinned row (E57), runStatusWriter. */
export async function refreshRow(scope: Scope, row: ShipmentRow, ctx: StatusContext): Promise<RowRun> {
  const svc = dpdService(scope)
  const mode = svc.mode()
  const logger = svc.getLogger()
  const ask = ctx.trigger === "refresh" ? refreshAsks(row) : waybillsToAsk(trackingOf(row)).map((e) => e.waybill)
  const answered = new Map<string, MappedEvent[]>()
  let asked = 0
  let unclear = 0
  let newEvents = 0
  let foreign = 0
  let auth = false
  let cut = false
  let rateLimited = false

  for (const waybill of ask) {
    if (ctx.callsLeft.n <= 0 || Date.now() >= ctx.deadline) {
      cut = true
      break
    }
    ctx.callsLeft.n -= 1
    let outcome: WaybillEventsOutcome
    try {
      outcome = await ctx.reader.events(row, waybill, ctx.now)
    } catch (err) {
      outcome = { kind: "unclear", code: "network", message: clip(errorText(svc, err), 1000), httpStatus: 0, ms: 0 }
    }
    if (outcome.kind === "nothingSent") {
      ctx.callsLeft.n += 1
      cut = true
      rateLimited = true
      break
    }
    asked += 1
    if (outcome.kind === "auth") {
      auth = true
      break
    }
    if (outcome.kind === "unclear") {
      unclear += 1
      logger.warn(svc.mask(`[dpd] status ${row.id}: ${waybill} unclear ${outcome.code} ${outcome.httpStatus}`))
      continue
    }
    const mapped: MappedEvent[] = []
    for (const event of outcome.value.events) {
      /* S4: the event belongs to the asked waybill unless DPD names another one. */
      const own = event.waybill.trim() || waybill
      const inserted = await recordEvent(scope, {
        shipment_id: row.id,
        order_id: row.order_id,
        waybill: own,
        kind: "status",
        status: event.code,
        previous_status: null,
        source: ctx.reader.source,
        actor: null,
        message: event.description,
        data: {
          eventTime: event.eventTimeRaw,
          depot: event.depot,
          depotName: event.depotName,
          country: event.country,
          ...(ctx.reader.source === "simulated" ? { simulated: true } : {}),
        },
        dedupe_key: statusDedupeKey(mode, { ...event, waybill: own }),
        object_id: event.objectId ?? undefined,
        occurred_at: event.eventTime ? new Date(event.eventTime) : ctx.now,
        mode,
      })
      if (inserted) newEvents += 1
      if (norm(own) === norm(waybill)) mapped.push({ ...event, waybill, known: ctx.map.lookup(event.code), eventId: inserted?.id ?? null })
      else foreign += 1
    }
    answered.set(waybill, mapped)
  }
  if (foreign > 0) logger.warn(`[dpd] status ${row.id}: ${foreign} events of another waybill kept in the history only`)

  if (answered.size === 0) {
    return {
      row,
      asked,
      newEvents,
      changed: false,
      outcome: auth ? "auth" : asked === 0 ? "skipped" : "partial",
      writer: null,
      answered: 0,
      unclear,
      rateLimited,
      repins: 0,
      stageChanged: false,
    }
  }

  const fold = foldRow(row, answered, ctx.now)
  const write: TrackingWrite = { tracking: fold.tracking, stage: fold.stage, status: fold.status, status_at: fold.statusAt ? new Date(fold.statusAt) : null }
  if (fold.repins.length > 0) {
    write.waybills = fold.waybills
    write.boxes = fold.boxes
  }
  if (ctx.trigger === "refresh") write.last_checked_at = ctx.now
  const expect: TrackingExpect = { stage: row.stage ?? null, status: row.status ?? null, status_at: row.status_at ?? null, tracking: row.tracking ?? null, waybills: row.waybills ?? null, handed_over_at: row.handed_over_at ?? null }
  const after = await storeFor(scope).applyTracking(row.id, write, expect)

  let latest: ShipmentRow
  let changed = false
  let stageChanged = false
  if (after) {
    latest = after
    changed = true
    stageChanged = (after.stage ?? null) !== (row.stage ?? null)
    if (stageChanged) await emitStageChange(scope, row, after, fold.stageEventId)
  } else {
    /* Lost: someone wrote the row after this read; no event, the winner emitted. */
    const [stored] = await listShipments(svc, { id: row.id }, { take: 1 })
    if (!stored) {
      return { row, asked, newEvents, changed: false, outcome: auth ? "auth" : unclear > 0 || cut ? "partial" : "ok", writer: null, answered: answered.size, unclear, rateLimited, repins: 0, stageChanged: false }
    }
    latest = stored
  }

  /*
   * E57: dpd_waybills follows the stored row, not this fold's repins, so a
   * failed annotate or a restart after the compare and set is put right by
   * the next won write (the old waybill is asked once more after its repin)
   * or by the repeat of the repin. annotateFulfillment returns early when
   * dpd_waybills already matches.
   */
  if (trackingOf(latest).some((e) => e.supersededBy !== null) && (after !== null || fold.repins.length > 0 || fold.repeats.length > 0)) {
    await annotateFulfillment(scope, latest)
  }

  /* S6: the repin history is written whatever the compare and set gave, for a repeat too (E57); the dedupe keys make it once. */
  for (const r of [...fold.repins, ...fold.repeats]) {
    const eventTime = (answered.get(r.from) ?? []).find((e) => e.code === r.code && e.eventTime === r.at)?.eventTimeRaw ?? r.at
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      waybill: r.from,
      kind: "action",
      source: sourceOf(ctx.actor),
      actor: ctx.actor,
      message: `DPD moved the parcel to a new waybill: ${r.from} to ${r.to} (${r.code}).`,
      data: { action: "repin", from: r.from, to: r.to, code: r.code, box: r.box, role: r.role, eventTime },
      dedupe_key: `repin:${mode}:${row.id}:${r.from}:${r.to}`,
      mode,
    })
  }
  for (const e of fold.repinUnclear) {
    await recordEvent(scope, {
      shipment_id: row.id,
      order_id: row.order_id,
      waybill: e.waybill,
      kind: "action",
      source: sourceOf(ctx.actor),
      actor: ctx.actor,
      message: `DPD event ${e.code} moves the parcel, but no single new waybill was found.`,
      data: { action: "repin_unclear", code: e.code, eventTime: e.eventTimeRaw },
      dedupe_key: `repinx:${mode}:${e.waybill}:${e.code}:${eventSecond(e.eventTimeRaw)}`,
      mode,
    })
  }

  const writer = await runStatusWriter(scope, latest, { actor: ctx.actor, now: ctx.now })
  return {
    row: await reread(scope, latest),
    asked,
    newEvents,
    changed,
    outcome: auth ? "auth" : unclear > 0 || cut ? "partial" : "ok",
    writer,
    answered: answered.size,
    unclear,
    rateLimited,
    repins: fold.repins.length,
    stageChanged,
  }
}

/* ------------------------------------------------------------------ */
/* Refresh one shipment (6.12, 10.3)                                   */
/* ------------------------------------------------------------------ */

/** POST .../refresh-status (DS18, 6.12, 10.3). Throws ActionError: not_found, wrong_state, not_configured, busy, rate_limited, statuses_auth, status_unavailable. */
export async function refreshShipmentStatus(scope: Scope, id: string, input: { actor: string | null; now?: Date }): Promise<ShipmentRow> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const mode = svc.mode()
  const row = await mustFind(scope, id)
  if (row.mode === "demo" && !row.fulfillment_id) {
    throw new ActionError(409, "wrong_state", "A sample demo row does not move; create a demo shipment from an order to see statuses.")
  }
  if (row.kind !== "outbound" || (row.state !== "created" && row.state !== "labeled") || waybillsOf(row.waybills).length === 0 || row.stage === "canceled") {
    throw new ActionError(409, "wrong_state", "Only a created or labeled outbound shipment with waybills can ask DPD for its status.")
  }
  const reader = statusReaderFor(scope)
  if (!reader) throw new ActionError(409, "not_configured", "Statuses are not configured: set infoLogin, infoPassword and infoChannel.")
  const result = await exclusive(`status:${row.id}`, async () => {
    const at = input.now ?? new Date()
    let hadProblem = false
    if (reader.source === "dpd") {
      try {
        hadProblem = (await getSetting(svc, statusSettingKey(mode, "problem"))) !== null
      } catch (err) {
        svc.getLogger().warn(`[dpd] Statuses: reading the status problem failed: ${errorText(svc, err)}`)
      }
    }
    /*
     * A person is not held to the one check of a stale mark (6.19 point 5):
     * the refresh writes last_checked_at, after which no pass looks at the
     * mark again, so it releases a stale mark first, as the pass does, also
     * with the writer disarmed (releasing needs no writer).
     */
    let current: ShipmentRow = row
    if (mode !== "demo") {
      const rel = await releaseStaleMarks(scope, row, { actor: input.actor, now: at, checkedBefore: null, anyError: false })
      current = await afterRelease(scope, row, rel.released)
    }
    /* The message of a refused login, for the answer (the client never puts the URL or the envelope in it). */
    let authMessage = ""
    const watched: StatusReader = {
      source: reader.source,
      events: async (r, waybill, now) => {
        const outcome = await reader.events(r, waybill, now)
        if (outcome.kind === "auth") authMessage = outcome.message
        return outcome
      },
    }
    const ctx: StatusContext = {
      reader: watched,
      map: buildCodeMap(o.statusMap),
      now: at,
      callsLeft: { n: refreshAsks(current).length },
      deadline: Date.now() + STATUS_PASS_BUDGET_MS,
      actor: input.actor,
      trigger: "refresh",
    }
    const run = await refreshRow(scope, current, ctx)
    if (hadProblem && run.answered > 0) await releaseProblem(scope)
    const auth = run.outcome === "auth"
    if (auth || !(run.answered === 0 && run.rateLimited)) {
      const outcome: StatusRefreshData["outcome"] = auth ? "auth" : run.answered === 0 ? "unavailable" : run.outcome === "partial" ? "partial" : "ok"
      await recordStatusAction(scope, row, input.actor, `Status asked from DPD: ${run.answered} of ${run.asked} waybills answered, ${run.newEvents} new events.`, {
        action: "status_refresh",
        asked: run.asked,
        answered: run.answered,
        newEvents: run.newEvents,
        outcome,
      })
    }
    if (auth) {
      await recordAuthProblem(scope, at)
      throw new ActionError(502, "statuses_auth", `InfoServices refused the login: ${svc.mask(authMessage)}`)
    }
    if (run.answered === 0 && run.rateLimited) {
      throw new ActionError(429, "rate_limited", "Too many calls to InfoServices right now; nothing was asked. Try again in a moment.", undefined, undefined, PACING_MAX_WAIT_MS / 1000)
    }
    if (run.answered === 0) {
      throw new ActionError(502, "status_unavailable", "DPD did not answer clearly for any waybill of this shipment; nothing changed. Try again later.")
    }
    return run.row
  })
  if (result === null) throw new ActionError(409, "busy", "The status of this shipment is being asked right now.")
  return result
}

/* ------------------------------------------------------------------ */
/* The writer fulfillmentStatus (6.4, 6.11)                            */
/* ------------------------------------------------------------------ */

export type MarkStep = "marked" | "already" | "demo" | "failed" | "lost_claim"
export type WriterSkip =
  | "not_outbound" | "no_fulfillment" | "stage_canceled" | "nothing_wanted" | "not_armed"
  | "fulfillment_gone" | "fulfillment_canceled" | "read_failed"
export type WriterRun = { skipped: WriterSkip | null; shipped: MarkStep | null; delivered: MarkStep | null; error: string | null }

/** dpd_event.data of the history entry status_refresh (6.12, 10.3); simulated only in demo and sandbox. */
export type StatusRefreshData = { action: "status_refresh"; asked: number; answered: number; newEvents: number; outcome: "ok" | "partial" | "auth" | "unavailable"; simulated?: true }
/** dpd_event.data of the history entry writer_retry (6.13, 10.4): the error retried (masked, at most 200 chars; null for a stale mark without an error, E4) and what the writer did. */
export type WriterRetryData = { action: "writer_retry"; error: string | null; outcome: WriterSkip | MarkStep | null; simulated?: true }

/** status_writer_error written by releaseStaleMarks (E4, 6.19). */
export const WRITER_INTERRUPTED_MESSAGE = "Interrupted: the write to Medusa stopped after its claim (the process ended). It is written again."

/**
 * Path c of 6.19, pure: the writer marks set and older than
 * WRITER_MARK_STALE_MS at `now`, not looked at since they got old
 * (checkedBefore null, or before the mark plus WRITER_MARK_STALE_MS), with
 * status_writer_error null unless anyError.
 */
export function staleMarkCandidates(
  row: Pick<ShipmentRow, "shipped_marked_at" | "delivered_marked_at"> & { status_writer_error?: string | null },
  input: { now: Date; checkedBefore: Date | string | null; anyError: boolean },
): MarkColumn[] {
  if (row.status_writer_error && !input.anyError) return []
  const checked = whenMs(input.checkedBefore)
  const out: MarkColumn[] = []
  for (const col of MARK_COLUMNS) {
    const mark = whenMs(row[col])
    if (mark === null || mark > input.now.getTime() - WRITER_MARK_STALE_MS) continue
    if (checked !== null && checked >= mark + WRITER_MARK_STALE_MS) continue
    out.push(col)
  }
  return out
}
/** The candidates whose fresh fulfillment read shows shipped_at (for delivered_marked_at: delivered_at) null; [] in demo, without candidates, or for a gone or canceled fulfillment. Throws on a module error. */
export async function staleMarks(scope: Scope, row: ShipmentRow, input: { now: Date; checkedBefore: Date | string | null; anyError: boolean }): Promise<MarkColumn[]> {
  const candidates = staleMarkCandidates(row, input)
  if (candidates.length === 0 || dpdService(scope).getOptions().demo || !row.fulfillment_id) return []
  const f = await readFulfillmentForStatus(scope, row.fulfillment_id)
  if (!f || f.canceled_at) return []
  return candidates.filter((col) => !f[medusaColumn(col)])
}
/** staleMarks, then releaseMark(id, col, WRITER_INTERRUPTED_MESSAGE, the mark of `row`) and the history writer_interrupted per column released: a mark claimed again since `row` was read is never released. Never throws: a read failure gives readFailed true and releases nothing. */
export async function releaseStaleMarks(
  scope: Scope,
  row: ShipmentRow,
  input: { actor: string | null; now: Date; checkedBefore: Date | string | null; anyError: boolean },
): Promise<{ released: MarkColumn[]; readFailed: boolean }> {
  const svc = dpdService(scope)
  const logger = svc.getLogger()
  let columns: MarkColumn[]
  try {
    columns = await staleMarks(scope, row, input)
  } catch (err) {
    logger.warn(`[dpd] status ${row.id}: reading the fulfillment failed: ${errorText(svc, err)}`)
    return { released: [], readFailed: true }
  }
  const released: MarkColumn[] = []
  for (const col of columns) {
    const markedAt = whenMs(row[col])
    if (markedAt === null) continue
    try {
      if (!(await storeFor(scope).releaseMark(row.id, col, WRITER_INTERRUPTED_MESSAGE, new Date(markedAt)))) continue
    } catch (err) {
      logger.warn(`[dpd] status ${row.id}: releasing ${col} failed: ${errorText(svc, err)}`)
      continue
    }
    released.push(col)
    await recordStatusAction(
      scope,
      row,
      input.actor,
      `The write to Medusa (${col}) stopped after its claim and Medusa has no ${medusaColumn(col)}; the mark is released and written again.`,
      { action: "writer_interrupted", column: col, code: "writer_interrupted" },
    )
    logger.warn(`[dpd] status ${row.id}: ${col} released after an interrupted write.`)
  }
  return { released, readFailed: false }
}

/** 6.4 points 1 to 9 on a fresh row; never throws (a failure is a released claim and the history). */
export async function runStatusWriter(scope: Scope, row: ShipmentRow, input: { actor: string | null; now: Date }): Promise<WriterRun> {
  const run: WriterRun = { skipped: null, shipped: null, delivered: null, error: null }
  const svc = dpdService(scope)
  const logger = svc.getLogger()
  try {
    await writeStatus(scope, row, input, run)
  } catch (err) {
    /* A store error (SQL) mid-way: logged; a claim it left is released by the stale mark rule (6.19). */
    const message = clip(errorText(svc, err), 500)
    logger.warn(`[dpd] status ${row.id}: the write to Medusa stopped: ${message}`)
    run.error ??= message
  }
  return run
}

async function writeStatus(scope: Scope, row: ShipmentRow, input: { actor: string | null; now: Date }, run: WriterRun): Promise<void> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const store = storeFor(scope)
  const logger = svc.getLogger()
  const { actor, now } = input
  const history = (message: string, data: { action: StatusHistoryAction } & Record<string, unknown>) => recordStatusAction(scope, row, actor, message, data)

  /* 1 and 2. */
  if (row.kind !== "outbound") {
    run.skipped = "not_outbound"
    return
  }
  const orderId = row.order_id
  const fulfillmentId = row.fulfillment_id
  if (!orderId || !fulfillmentId) {
    run.skipped = "no_fulfillment"
    return
  }
  if (row.stage === "canceled") {
    run.skipped = "stage_canceled"
    return
  }
  const entries = trackingOf(row)
  const wantShip = hasPossession(entries) && !row.shipped_marked_at
  let wantDeliver = row.stage === "delivered" && !row.delivered_marked_at
  if (!wantShip && !wantDeliver) {
    run.skipped = "nothing_wanted"
    return
  }
  /* 3. Not requireArmed: the pass never throws. */
  let armed = false
  try {
    armed = await isArmed(svc, "fulfillmentStatus")
  } catch (err) {
    logger.warn(`[dpd] status ${row.id}: reading the writers failed: ${errorText(svc, err)}`)
  }
  if (!armed) {
    run.skipped = "not_armed"
    return
  }

  /* 4. Demo: the history only, no Medusa. */
  if (o.demo) {
    if (wantShip) {
      if (await store.claimMark(row.id, "shipped_marked_at", now)) {
        await history("Simulated status: the fulfillment would be marked shipped.", { action: "writer_demo_shipped", column: "shipped_marked_at" })
        run.shipped = "demo"
      } else run.shipped = "lost_claim"
    }
    if (wantDeliver && (row.shipped_marked_at || run.shipped === "demo")) {
      if (await store.claimMark(row.id, "delivered_marked_at", now)) {
        await history("Simulated status: the fulfillment would be marked delivered.", { action: "writer_demo_delivered", column: "delivered_marked_at" })
        run.delivered = "demo"
      } else run.delivered = "lost_claim"
    }
    return
  }

  let current: ShipmentRow = row
  /* 10. A write left undone on a row no longer due gets a note, so the counter, the filter and the retry see it (E24). */
  const notePending = async (): Promise<void> => {
    if (run.skipped !== null && run.skipped !== "read_failed") return
    const pendingShip = wantShip && (run.shipped === null || run.shipped === "lost_claim")
    const pendingDeliver = wantDeliver && run.delivered === null
    if (!(pendingShip || pendingDeliver) || !trackingDone(current, now)) return
    try {
      await store.notePendingMark(row.id, pendingShip ? "shipped_marked_at" : "delivered_marked_at", run.skipped === "read_failed" ? READ_FAILED_NOTE : WAITING_NOTE)
    } catch (err) {
      logger.warn(`[dpd] status ${row.id}: noting the pending write failed: ${errorText(svc, err)}`)
    }
  }

  /* 5. A fresh read of the fulfillment; nothing is claimed before it. */
  let f: FulfillmentStatusState | null
  try {
    f = await readFulfillmentForStatus(scope, fulfillmentId)
  } catch (err) {
    logger.warn(`[dpd] status ${row.id}: reading the fulfillment failed: ${errorText(svc, err)}`)
    run.skipped = "read_failed"
    await notePending()
    return
  }
  if (!f) {
    run.skipped = "fulfillment_gone"
    return
  }
  if (f.canceled_at) {
    run.skipped = "fulfillment_canceled"
    return
  }
  const read = f
  const fresh = async (): Promise<FulfillmentStatusState | null> => {
    try {
      return await readFulfillmentForStatus(scope, fulfillmentId)
    } catch {
      return null
    }
  }
  /* 6. The core flows load only after a won claim, inside its try (E10). */
  let flows: CoreFlows | null = null
  let shippedInMedusa = Boolean(read.shipped_at)
  /* A simulated status (sandbox) never mails a customer: Medusa passes no_notification to its shipment.created and delivered events. */
  const quiet = simulation(svc).simulated ? { no_notification: true } : {}

  /* 7. Shipped. */
  if (wantShip) {
    if (!(await store.claimMark(row.id, "shipped_marked_at", now))) {
      run.shipped = "lost_claim"
      await notePending()
      return
    }
    if (read.shipped_at) {
      await history("The Medusa fulfillment was already shipped.", { action: "writer_already_shipped", column: "shipped_marked_at" })
      run.shipped = "already"
    } else {
      try {
        flows ??= await coreFlowsFor(scope)
        const live = entries.filter((e) => e.role === "outbound" && e.supersededBy === null).map((e) => e.waybill)
        await flows.createOrderShipmentWorkflow(scope).run({
          input: { order_id: orderId, fulfillment_id: fulfillmentId, items: foldItems(read.items), labels: labelsFor(read.labels, live), ...quiet },
        })
        await history("The Medusa fulfillment was marked shipped.", { action: "writer_shipped", column: "shipped_marked_at" })
        run.shipped = "marked"
      } catch (err) {
        const message = clip(errorText(svc, err), 500)
        if ((await fresh())?.shipped_at) {
          /* A person or another instance shipped it meanwhile. */
          await history("The Medusa fulfillment was already shipped.", { action: "writer_already_shipped", column: "shipped_marked_at" })
          run.shipped = "already"
        } else {
          await store.releaseMark(row.id, "shipped_marked_at", message, now)
          await history(`Marking the Medusa fulfillment shipped failed: ${clip(message, 300)}`, { action: "writer_failed", column: "shipped_marked_at", code: "writer_failed" })
          logger.warn(`[dpd] status ${row.id}: marking the fulfillment shipped failed: ${message}`)
          run.shipped = "failed"
          run.error = message
          return
        }
      }
    }
    /* A stage written meanwhile by another call (E24): delivered is decided on the row as it is now. */
    shippedInMedusa = true
    current = await reread(scope, row)
    wantDeliver = current.stage === "delivered" && !current.delivered_marked_at
  }

  /* 8. Delivered, only after shipped is written in Medusa (E9): a claim of another process is not enough. */
  if (wantDeliver && shippedInMedusa) {
    if (!(await store.claimMark(row.id, "delivered_marked_at", now))) {
      run.delivered = "lost_claim"
    } else if (read.delivered_at) {
      await history("The Medusa fulfillment was already delivered.", { action: "writer_already_delivered", column: "delivered_marked_at" })
      run.delivered = "already"
    } else {
      try {
        flows ??= await coreFlowsFor(scope)
        await flows.markOrderFulfillmentAsDeliveredWorkflow(scope).run({ input: { orderId, fulfillmentId, ...quiet } })
        await history("The Medusa fulfillment was marked delivered.", { action: "writer_delivered", column: "delivered_marked_at" })
        run.delivered = "marked"
      } catch (err) {
        const message = clip(errorText(svc, err), 500)
        if ((await fresh())?.delivered_at) {
          await history("The Medusa fulfillment was already delivered.", { action: "writer_already_delivered", column: "delivered_marked_at" })
          run.delivered = "already"
        } else {
          await store.releaseMark(row.id, "delivered_marked_at", message, now)
          await history(`Marking the Medusa fulfillment delivered failed: ${clip(message, 300)}`, { action: "writer_failed", column: "delivered_marked_at", code: "writer_failed" })
          logger.warn(`[dpd] status ${row.id}: marking the fulfillment delivered failed: ${message}`)
          run.delivered = "failed"
          run.error = message
          return
        }
      }
    }
  }
  await notePending()
}

/**
 * POST .../retry-status-writer (DS18, 6.13, 10.4). The row must have
 * status_writer_error or a stale writer mark (staleMarks with anyError
 * false, E4; else wrong_state), then requireArmed(fulfillmentStatus)
 * (state before the writer, O34); releaseStaleMarks with anyError true,
 * runStatusWriter, then the history writer_retry. A skip that leaves nothing to write (not_outbound,
 * no_fulfillment, stage_canceled, nothing_wanted, fulfillment_gone,
 * fulfillment_canceled) clears the stale error through
 * store.transition(id, [row.state], { status_writer_error: null }) (O34).
 * No exclusive lock: claimMark decides between processes. The row only;
 * retryStatusWriterRun also says what the writer did (E56).
 */
export async function retryStatusWriter(scope: Scope, id: string, input: { actor: string | null; now?: Date }): Promise<ShipmentRow> {
  return (await retryStatusWriterRun(scope, id, input)).row
}

/**
 * What the panel says after a retry (6.13 point 9, E56), pure: a refusal of
 * Medusa or a store error that stopped the writer (run.error, E62) first,
 * then a skip with nothing left to write, a skip that tried nothing, a
 * claim another process holds, and written only when every step that ran
 * was marked, already or demo. No step at all ("delivered" waits for a
 * shipped mark another process holds) is in_progress.
 */
export function writerRetryResult(run: WriterRun): WriterRetryResult {
  const steps = [run.shipped, run.delivered].filter((x): x is MarkStep => x !== null)
  if (steps.includes("failed") || run.error !== null) return "failed"
  if (run.skipped !== null) return NOTHING_LEFT.includes(run.skipped) ? "nothing_left" : "not_written"
  if (steps.length === 0 || steps.includes("lost_claim")) return "in_progress"
  return "written"
}

/** retryStatusWriter with what the writer did; the route answers both (RetryStatusWriterResponse, E56). */
export async function retryStatusWriterRun(scope: Scope, id: string, input: { actor: string | null; now?: Date }): Promise<{ row: ShipmentRow; result: WriterRetryResult }> {
  const svc = dpdService(scope)
  const at = input.now ?? new Date()
  const row = await mustFind(scope, id)
  if (!row.status_writer_error && (await staleMarks(scope, row, { now: at, checkedBefore: null, anyError: false })).length === 0) {
    throw new ActionError(409, "wrong_state", "This shipment has no failed or interrupted write to Medusa.")
  }
  await requireArmed(scope, "fulfillmentStatus")
  const rel = await releaseStaleMarks(scope, row, { actor: input.actor, now: at, checkedBefore: null, anyError: true })
  const current = await afterRelease(scope, row, rel.released)
  const run = await runStatusWriter(scope, current, { actor: input.actor, now: at })
  let outcome: WriterSkip | MarkStep | null
  if (run.skipped !== null) {
    outcome = run.skipped
    if (NOTHING_LEFT.includes(run.skipped)) await storeFor(scope).transition(row.id, [current.state], { status_writer_error: null })
  } else {
    /* A store error stopped the writer before a step had an outcome (E62): failed, never "nothing". */
    outcome = run.shipped ?? run.delivered ?? (run.error !== null ? "failed" : null)
  }
  await recordStatusAction(scope, row, input.actor, "A person asked to write the status to Medusa again.", {
    action: "writer_retry",
    error: row.status_writer_error ? clip(svc.mask(row.status_writer_error), 200) : null,
    outcome,
  })
  return { row: await reread(scope, current), result: writerRetryResult(run) }
}

/** Fulfillment items folded by line_item_id; quantity read from a number, a numeric string or a BigNumber like { numeric }. */
export function foldItems(items: ReadonlyArray<{ line_item_id: string; quantity: unknown }>): Array<{ id: string; quantity: number }> {
  const out: Array<{ id: string; quantity: number }> = []
  for (const item of items) {
    const quantity = quantityOf(item.quantity)
    const hit = out.find((x) => x.id === item.line_item_id)
    if (hit) hit.quantity += quantity
    else out.push({ id: item.line_item_id, quantity })
  }
  return out
}

function quantityOf(v: unknown): number {
  const raw = v !== null && typeof v === "object" && "numeric" in v ? (v as { numeric: unknown }).numeric : v
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN
  return Number.isFinite(n) ? n : 0
}

/** DS10: the existing labels with their id, plus { tracking_number, tracking_url: "", label_url: "" } for each live outbound waybill not there yet. */
export function labelsFor(existing: FulfillmentStatusState["labels"], waybills: readonly string[]): CreateOrderShipmentInput["labels"] {
  /* The whole list (H14): Medusa replaces the labels with what it gets, so an existing one left out would be deleted. */
  const out: CreateOrderShipmentInput["labels"] = existing.map((l) => ({ id: l.id, tracking_number: l.tracking_number ?? "", tracking_url: l.tracking_url ?? "", label_url: l.label_url ?? "" }))
  const known = new Set(existing.map((l) => l.tracking_number).filter((t): t is string => typeof t === "string" && t !== ""))
  for (const waybill of waybills) {
    if (known.has(waybill)) continue
    known.add(waybill)
    out.push({ tracking_number: waybill, tracking_url: "", label_url: "" })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Events (6.14, 6.15)                                                 */
/* ------------------------------------------------------------------ */

/** dpd.shipment.created for a row that just won its state (DS11); demo rows with demo true. */
export async function emitCreated(scope: Scope, row: ShipmentRow): Promise<void> {
  await emitShipmentEvent(scope, SHIPMENT_CREATED_EVENT, toShipmentEvent(row, { previousStatus: null, previousStage: null, eventId: null }))
}
/** status_changed after a won applyTracking with a new stage, then delivered when the new stage is delivered. */
export async function emitStageChange(scope: Scope, before: ShipmentRow, after: ShipmentRow, eventId: string | null): Promise<void> {
  const data = toShipmentEvent(after, { previousStatus: before.status ?? null, previousStage: shipmentStageOf(before.stage), eventId })
  await emitShipmentEvent(scope, SHIPMENT_STATUS_CHANGED_EVENT, data)
  if (after.stage === "delivered") await emitShipmentEvent(scope, SHIPMENT_DELIVERED_EVENT, data)
}
