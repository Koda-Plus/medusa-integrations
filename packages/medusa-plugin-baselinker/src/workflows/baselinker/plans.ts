/**
 * Storage of the writer plans (`baselinker_plan_item`) and of the per-item
 * quarantine (`baselinker_quarantine`), through the generated service
 * methods. Planning and deciding stay in the pure `lib/*` files; this file
 * only reads and writes rows.
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import type { PlanAction, PlanChange, PlanKind, PlanStatus, PlanSummary } from "../../modules/baselinker/lib/contract"
import type { PlanItemRow, QuarantineRow } from "../../modules/baselinker/lib/dto"
import { afterFailure, afterSuccess } from "../../modules/baselinker/lib/quarantine"

/**
 * What applying one item did. `countable` failures are about the item itself
 * (BaseLinker refused this card, Medusa refused this product) and count
 * towards its quarantine; an outage is not the item's fault and does not.
 */
export type Outcome = { ok: true } | { ok: false; error: string; countable: boolean }

/** Status of a plan row from what happened to it in this run. */
export function rowStatus(args: {
  applicable: boolean
  outcome: Outcome | undefined
  quarantined: boolean
  overCap: boolean
}): PlanStatus {
  if (!args.applicable) return "info"
  if (args.outcome) return args.outcome.ok ? "applied" : "failed"
  if (args.quarantined) return "quarantined"
  if (args.overCap) return "over_cap"
  return "planned"
}

/** One row of a plan, as the planners and the appliers produce it. */
export interface PlanItemData {
  itemKey: string
  action: PlanAction
  status: PlanStatus
  reason?: string | null
  label?: string | null
  sku?: string | null
  productId?: string | null
  variantId?: string | null
  blProductId?: string | null
  changes?: PlanChange[]
  error?: string | null
  appliedAt?: Date | null
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Replaces the stored plan of one kind in the current mode. */
export async function replacePlan(svc: BaseLinkerModuleService, kind: PlanKind, runId: string | null, items: readonly PlanItemData[]): Promise<void> {
  const demo = svc.isDemo()
  const old = (await svc.listBaseLinkerPlanItems({ kind } as never, { take: null, select: ["id"] } as never)) as unknown as Array<{ id: string }>
  for (const part of chunks(old.map((r) => r.id), 500)) await svc.deleteBaseLinkerPlanItems(part)
  const rows = items.map((i) => ({
    kind,
    run_id: runId,
    item_key: i.itemKey,
    action: i.action,
    status: i.status,
    reason: i.reason ?? null,
    label: i.label ? i.label.slice(0, 300) : null,
    sku: i.sku ?? null,
    product_id: i.productId ?? null,
    variant_id: i.variantId ?? null,
    bl_product_id: i.blProductId ?? null,
    changes: i.changes && i.changes.length > 0 ? i.changes : null,
    error: i.error ? svc.mask(i.error).slice(0, 1000) : null,
    applied_at: i.appliedAt ?? null,
    demo,
  }))
  for (const part of chunks(rows, 500)) await svc.createBaseLinkerPlanItems(part as never)
}

export function emptySummary(): PlanSummary {
  return { total: 0, create: 0, update: 0, draft: 0, skip: 0, conflict: 0, applied: 0, failed: 0, overCap: 0, quarantined: 0 }
}

export function summarize(items: ReadonlyArray<{ action: string; status: string }>): PlanSummary {
  const s = emptySummary()
  for (const i of items) {
    s.total += 1
    if (i.action === "create") s.create += 1
    else if (i.action === "update") s.update += 1
    else if (i.action === "draft") s.draft += 1
    else if (i.action === "skip") s.skip += 1
    else if (i.action === "conflict") s.conflict += 1
    if (i.status === "applied") s.applied += 1
    else if (i.status === "failed") s.failed += 1
    else if (i.status === "over_cap") s.overCap += 1
    else if (i.status === "quarantined") s.quarantined += 1
  }
  return s
}

/** The stored plan of one kind, summarized (for the status page). */
export async function storedSummary(svc: BaseLinkerModuleService, kind: PlanKind): Promise<PlanSummary> {
  const rows = (await svc.listBaseLinkerPlanItems({ kind, demo: svc.isDemo() } as never, {
    take: null,
    select: ["action", "status"],
  } as never)) as unknown as Array<Pick<PlanItemRow, "action" | "status">>
  return summarize(rows)
}

/* ------------------------------------------------------------------ */
/* Quarantine                                                          */
/* ------------------------------------------------------------------ */

/** Quarantine rows of one kind in the current mode, by item key. */
export async function quarantineRows(svc: BaseLinkerModuleService, kind: PlanKind): Promise<Map<string, QuarantineRow>> {
  const rows = (await svc.listBaseLinkerQuarantines({ kind, demo: svc.isDemo() } as never, { take: null } as never)) as unknown as QuarantineRow[]
  return new Map(rows.map((r) => [r.item_key, r]))
}

export function quarantinedKeys(rows: ReadonlyMap<string, QuarantineRow>): Set<string> {
  const out = new Set<string>()
  for (const [key, row] of rows) if (row.quarantined_at) out.add(key)
  return out
}

/** Counts one more failure per item; returns the keys quarantined by it. */
export async function noteFailures(
  svc: BaseLinkerModuleService,
  kind: PlanKind,
  failures: ReadonlyArray<{ key: string; label: string | null; error: string }>,
  known: ReadonlyMap<string, QuarantineRow>,
): Promise<string[]> {
  const threshold = svc.getOptions().quarantineAfter
  const now = new Date()
  const newly: string[] = []
  for (const f of failures) {
    const prev = known.get(f.key) ?? null
    const next = afterFailure(prev ? { failures: prev.failures, quarantinedAt: prev.quarantined_at } : null, threshold, now)
    const error = svc.mask(f.error).slice(0, 1000)
    if (next.quarantinedAt && !prev?.quarantined_at) newly.push(f.key)
    if (prev) {
      await svc.updateBaseLinkerQuarantines({ id: prev.id, failures: next.failures, last_error: error, quarantined_at: next.quarantinedAt, label: f.label } as never)
    } else {
      try {
        await svc.createBaseLinkerQuarantines({
          kind,
          item_key: f.key,
          label: f.label,
          failures: next.failures,
          last_error: error,
          quarantined_at: next.quarantinedAt,
          demo: svc.isDemo(),
        } as never)
      } catch {
        /* Another run created it a moment ago: the next failure counts on it. */
      }
    }
  }
  return newly
}

/** Resets the count of items that went through. */
export async function noteSuccesses(svc: BaseLinkerModuleService, keys: readonly string[], known: ReadonlyMap<string, QuarantineRow>): Promise<void> {
  for (const key of keys) {
    const prev = known.get(key)
    if (!prev) continue
    const next = afterSuccess({ failures: prev.failures, quarantinedAt: prev.quarantined_at })
    if (next) await svc.updateBaseLinkerQuarantines({ id: prev.id, failures: next.failures, quarantined_at: null, last_error: null } as never)
  }
}

/** A person released one quarantined item: the next run tries it again. */
export async function releaseQuarantine(svc: BaseLinkerModuleService, id: string, by: string | null): Promise<boolean> {
  const rows = (await svc.listBaseLinkerQuarantines({ id, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as QuarantineRow[]
  const row = rows[0]
  if (!row) return false
  await svc.updateBaseLinkerQuarantines({
    id: row.id,
    failures: 0,
    quarantined_at: null,
    released_at: new Date(),
    released_by: by,
  } as never)
  return true
}

export async function quarantinedCount(svc: BaseLinkerModuleService): Promise<number> {
  const [, n] = (await svc.listAndCountBaseLinkerQuarantines({ demo: svc.isDemo(), quarantined_at: { $ne: null } } as never, {
    take: 1,
    select: ["id"],
  } as never)) as unknown as [unknown[], number]
  return n
}
