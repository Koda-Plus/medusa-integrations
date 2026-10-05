/**
 * PLANS IN THE DATABASE: one row per kind and target, kept between runs so
 * the failures of an item add up and the item can be quarantined, plus a
 * summary per kind (when it was planned, whether it was refused, the last
 * apply). Shared by the stock push, the price push and publish by EAN.
 */

import type AllegroModuleService from "../../modules/allegro/service"
import { QUARANTINE_AFTER } from "../../modules/allegro/lib/constants"
import type { AllegroPlanKind, AllegroPlanSummaryDto } from "../../modules/allegro/lib/contract"
import type { PlanItemRow } from "../../modules/allegro/lib/dto"
import { chunks, getState, setState } from "./runtime"

export interface PlanEntryInput {
  targetKey: string
  allegroId: string | null
  variantId: string | null
  productId: string | null
  sku: string | null
  title: string | null
  action: string
  reason: string
  status: string
  current: Record<string, unknown> | null
  target: Record<string, unknown> | null
}

interface SummaryState {
  plannedAt: string | null
  refused: string | null
  counts: Record<string, number>
  lastApply: { at: string | null; applied: number; failed: number; message: string | null } | null
}

/* One summary per mode, like the plan rows. */
const summaryId = (svc: AllegroModuleService, kind: AllegroPlanKind) => `plan:${kind}${svc.isDemo() ? ":demo" : ""}`

export async function loadPlanRows(svc: AllegroModuleService, kind: AllegroPlanKind): Promise<PlanItemRow[]> {
  return (await svc.listAllegroPlanItems({ kind } as never, { take: null })) as unknown as PlanItemRow[]
}

/** Targets whose failures reached the quarantine threshold, and not released by a person. */
export function quarantinedOf(rows: readonly PlanItemRow[]): Set<string> {
  return new Set(rows.filter((r) => r.status === "quarantined" || (r.failures ?? 0) >= QUARANTINE_AFTER).map((r) => r.target_key))
}

/**
 * Writes a fresh plan: rows for every entry (failures kept), rows of targets
 * that left the plan removed. A row in quarantine stays in quarantine.
 */
export async function savePlan(svc: AllegroModuleService, kind: AllegroPlanKind, entries: readonly PlanEntryInput[], demo: boolean): Promise<void> {
  const existing = await loadPlanRows(svc, kind)
  const byKey = new Map(existing.map((r) => [r.target_key, r]))
  const keep = new Set(entries.map((e) => e.targetKey))
  const now = new Date()
  const creates: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  for (const e of entries) {
    const row = byKey.get(e.targetKey)
    const data = {
      kind,
      target_key: e.targetKey,
      allegro_id: e.allegroId,
      variant_id: e.variantId,
      product_id: e.productId,
      sku: e.sku,
      title: e.title,
      action: e.action,
      reason: e.reason,
      status: e.status,
      current: e.current,
      target: e.target,
      planned_at: now,
      demo,
    }
    if (!row) creates.push({ ...data, failures: 0 })
    else {
      /* A target that is in sync again needs no quarantine any more. */
      const failures = e.status === "in_sync" ? 0 : row.failures ?? 0
      updates.push({ id: row.id, ...data, failures, ...(e.status === "in_sync" ? { last_error: null } : {}) })
    }
  }
  const removed = existing.filter((r) => !keep.has(r.target_key) || Boolean(r.demo) !== demo).map((r) => r.id)
  for (const part of chunks(removed, 500)) await svc.deleteAllegroPlanItems(part)
  for (const part of chunks(creates, 200)) await svc.createAllegroPlanItems(part as never)
  for (const part of chunks(updates, 200)) await svc.updateAllegroPlanItems(part as never)
}

export async function updatePlanRows(svc: AllegroModuleService, updates: ReadonlyArray<Record<string, unknown> & { id: string }>): Promise<void> {
  for (const part of chunks(updates, 200)) await svc.updateAllegroPlanItems(part as never)
}

export async function planSummary(svc: AllegroModuleService, kind: AllegroPlanKind): Promise<AllegroPlanSummaryDto> {
  const s = await getState<SummaryState>(svc, summaryId(svc, kind))
  const rows = (await svc.listAllegroPlanItems({ kind } as never, { take: null, select: ["status"] })) as unknown as Array<{ status: string }>
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1
  return { kind, plannedAt: s?.plannedAt ?? null, refused: s?.refused ?? null, counts, lastApply: s?.lastApply ?? null }
}

export async function setPlanSummary(svc: AllegroModuleService, kind: AllegroPlanKind, patch: Partial<SummaryState>): Promise<void> {
  const s = (await getState<SummaryState>(svc, summaryId(svc, kind))) ?? { plannedAt: null, refused: null, counts: {}, lastApply: null }
  await setState(svc, summaryId(svc, kind), { ...s, ...patch })
}

/** A person releases a quarantined item: it is planned again on the next run. */
export async function releasePlanItem(svc: AllegroModuleService, id: string): Promise<boolean> {
  const rows = (await svc.listAllegroPlanItems({ id } as never, { take: 1 })) as unknown as PlanItemRow[]
  const row = rows[0]
  if (!row) return false
  await svc.updateAllegroPlanItems({ id, failures: 0, status: row.status === "quarantined" ? "deferred" : row.status, last_error: null } as never)
  return true
}

/** After a task failed: the failure counted, the item quarantined at the threshold. */
export function failurePatch(row: Pick<PlanItemRow, "failures">, message: string): { status: string; failures: number; last_error: string } {
  const failures = (row.failures ?? 0) + 1
  return { status: failures >= QUARANTINE_AFTER ? "quarantined" : "failed", failures, last_error: message.slice(0, 1000) }
}
