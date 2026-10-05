/**
 * ONE STATUS PASS: the way back of sent orders and of imported orders, using
 * the BaseLinker journal when it works (see `lib/journal.ts`).
 *
 * With the journal, the pass asks BaseLinker only about the orders that had
 * events since the last log id; without it (not enabled, first read, a stale
 * cursor, or every two hours as a safety net) it reads every followed order,
 * as version 0.1 did. A journal that fails or answers nothing never stops the
 * status read: the full read takes over.
 */

import { JOURNAL_LOG_TYPES } from "../../modules/baselinker/lib/constants"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { describeAnyError } from "../../modules/baselinker/lib/errors"
import { applyJournal, emptyJournal, journalPlan, parseJournal, type JournalState } from "../../modules/baselinker/lib/journal"
import { canImportOrders, canReadStatuses } from "../../modules/baselinker/lib/options"
import { syncImportedStatuses, type ImportedStatusStats } from "./order-import"
import { baselinkerService, clientFor, type Scope } from "./runtime"
import { readSetting, writeSetting } from "./settings"
import { syncStatuses, type StatusesStats } from "./statuses"

export const JOURNAL_CURSOR = "cursor:journal"

export interface StatusPass {
  mode: "journal" | "full"
  /** Orders the journal named (journal mode). */
  orders: number
  journalError: string | null
  exported: StatusesStats | null
  imported: ImportedStatusStats | null
}

export async function loadJournalState(svc: ReturnType<typeof baselinkerService>): Promise<JournalState | null> {
  return readSetting<JournalState>(svc, JOURNAL_CURSOR)
}

/** Statuses of sent and imported orders; `full` forces the read of every followed order. */
export async function runStatusPass(scope: Scope, trigger: RunTrigger, opts: { full?: boolean } = {}): Promise<StatusPass> {
  const svc = baselinkerService(scope)
  const o = svc.getOptions()
  const pass: StatusPass = { mode: "full", orders: 0, journalError: null, exported: null, imported: null }
  if (!canReadStatuses(o)) return pass
  const imports = canImportOrders(o)

  let orderIds: string[] | null = null
  let state: JournalState | null = null
  if (!o.demo && o.journal !== "off") {
    state = (await readSetting<JournalState>(svc, JOURNAL_CURSOR)) ?? emptyJournal()
    const now = Date.now()
    const plan = journalPlan(state, now, o.journal)
    if (plan.read) {
      try {
        const params: { last_log_id?: number; logs_types: readonly number[] } = { logs_types: JOURNAL_LOG_TYPES }
        if (state.lastLogId !== null) params.last_log_id = state.lastLogId
        const raw = await clientFor(svc).getJournalList(params)
        const applied = applyJournal(state, parseJournal(raw), now)
        state = applied.state
        if (!plan.full && !opts.full) orderIds = applied.orderIds
      } catch (err) {
        pass.journalError = svc.mask(describeAnyError(err).message)
      }
    }
  }

  if (orderIds !== null) {
    pass.mode = "journal"
    pass.orders = orderIds.length
    if (orderIds.length > 0) {
      pass.exported = await syncStatuses(scope, trigger, undefined, orderIds)
      if (imports) pass.imported = await syncImportedStatuses(scope, trigger, orderIds)
    }
  } else {
    pass.exported = await syncStatuses(scope, trigger)
    if (imports) pass.imported = await syncImportedStatuses(scope, trigger)
    if (state) state = { ...state, lastFullAt: Date.now() }
  }
  if (state) await writeSetting(svc, JOURNAL_CURSOR, state)
  return pass
}
