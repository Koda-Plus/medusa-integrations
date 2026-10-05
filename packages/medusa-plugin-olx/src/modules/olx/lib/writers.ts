/**
 * WRITER SWITCHES AND THE PLAN ROWS. Pure.
 *
 * TWO SWITCHES PER WRITER. The option (`lifecycleWriter`, `priceWriter`,
 * `publishWriter`) is the hard one: `false` wins, the admin cannot override
 * it. The toggle in the admin is the runtime one, persisted with who flipped
 * it and when. A writer acts only when both say yes and, in live mode, the
 * OLX token carries the `write` scope. Demo toggles and live toggles are
 * separate rows, so a writer armed on the public demo is never armed on a
 * real account.
 *
 * ONE PLAN ROW PER ADVERT AND WRITER. The planner merges what should happen
 * now into the existing rows: a row in flight (`applying`, `unknown`) is left
 * alone, a quarantined row stays quarantined while the same action is still
 * wanted, an action that is no longer wanted goes idle, and a new action or a
 * new target starts with zero attempts.
 */

import { QUARANTINE_AFTER, type WriterKey } from "./constants"

export type PlanState = "idle" | "pending" | "held" | "applying" | "done" | "failed" | "quarantined" | "unknown"

export const PLAN_STATES: readonly PlanState[] = ["idle", "pending", "held", "applying", "done", "failed", "quarantined", "unknown"]

export interface WriterToggle {
  armed: boolean
  changedBy: string | null
  changedAt: string | null
}

export type WriterBlocker = "config_off" | "not_armed" | "not_connected" | "no_write_scope"

export interface WriterSwitchState {
  allowedByConfig: boolean
  armed: boolean
  active: boolean
  blockers: WriterBlocker[]
}

export function writerSwitchState(args: {
  allowedByConfig: boolean
  toggle: WriterToggle | null
  demo: boolean
  connected: boolean
  writeScope: boolean
}): WriterSwitchState {
  const armed = Boolean(args.toggle?.armed) && args.allowedByConfig
  const blockers: WriterBlocker[] = []
  if (!args.allowedByConfig) blockers.push("config_off")
  if (!args.demo) {
    if (!args.connected) blockers.push("not_connected")
    else if (!args.writeScope) blockers.push("no_write_scope")
  }
  if (!armed) blockers.push("not_armed")
  return { allowedByConfig: args.allowedByConfig, armed, active: blockers.length === 0, blockers }
}

/** Whether a person may arm the writer now. Disarming is always allowed. */
export function canArm(args: { allowedByConfig: boolean; demo: boolean; connected: boolean; writeScope: boolean }): { ok: true } | { ok: false; code: WriterBlocker } {
  if (!args.allowedByConfig) return { ok: false, code: "config_off" }
  if (!args.demo && !args.connected) return { ok: false, code: "not_connected" }
  if (!args.demo && !args.writeScope) return { ok: false, code: "no_write_scope" }
  return { ok: true }
}

export function toggleKey(writer: WriterKey, demo: boolean): string {
  return `writer:${writer}:${demo ? "demo" : "live"}`
}

/* ------------------------------------------------------------------ */
/* Merging a plan into the rows                                        */
/* ------------------------------------------------------------------ */

export interface PlanRowLike {
  id: string
  olx_id: string
  action: string
  state: string
  attempts: number
  reason: string | null
  from_value: unknown
  to_value: unknown
  approved_value: unknown
  paused_at: Date | string | null
  title: string | null
  variant_id: string | null
  product_id: string | null
  sku: string | null
}

export interface DesiredItem {
  olxId: string
  action: string
  reason: string
  from: unknown
  to: unknown
  /** Waits for a person (a price change above the threshold). */
  held: boolean
  variantId: string | null
  productId: string | null
  sku: string | null
  title: string | null
}

export interface PlanRowPatch {
  action?: string
  reason?: string | null
  from_value?: unknown
  to_value?: unknown
  state?: PlanState
  attempts?: number
  last_error?: string | null
  note?: string | null
  planned_at?: Date
  paused_at?: Date | null
  title?: string | null
  variant_id?: string | null
  product_id?: string | null
  sku?: string | null
}

export interface NewPlanRow extends Required<Pick<PlanRowPatch, "action" | "reason" | "from_value" | "to_value" | "state" | "attempts" | "planned_at">> {
  olx_id: string
  title: string | null
  variant_id: string | null
  product_id: string | null
  sku: string | null
}

/**
 * JSON with sorted keys at every level. Postgres `jsonb` does not keep key
 * order, so a plain `JSON.stringify` of a stored value and of a freshly built
 * one would differ on every run and rewrite rows for nothing.
 */
export function stableJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Record<string, unknown>
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          if (o[k] !== undefined) acc[k] = walk(o[k])
          return acc
        }, {})
    }
    return v
  }
  return JSON.stringify(walk(value ?? null))
}

/** Stable comparison of plan values ({ value, currency } or a status). */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string => {
    if (v === undefined || v === null) return "null"
    if (typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      return JSON.stringify(Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = typeof o[k] === "number" ? Math.round((o[k] as number) * 100) / 100 : o[k]
        return acc
      }, {}))
    }
    return JSON.stringify(v)
  }
  return norm(a) === norm(b)
}

const IN_FLIGHT = new Set(["applying", "unknown"])
const OPEN = new Set(["pending", "failed", "held"])

export function reconcilePlan(
  rows: readonly PlanRowLike[],
  desired: readonly DesiredItem[],
  args: { now: Date; resumed?: ReadonlySet<string> },
): { creates: NewPlanRow[]; updates: Array<{ id: string; patch: PlanRowPatch }> } {
  const byOlx = new Map(rows.map((r) => [r.olx_id, r]))
  const wanted = new Map(desired.map((d) => [d.olxId, d]))
  const creates: NewPlanRow[] = []
  const updates: Array<{ id: string; patch: PlanRowPatch }> = []

  const initialState = (d: DesiredItem, row: PlanRowLike | null): PlanState =>
    d.held && !(row && sameValue(row.approved_value, d.to)) ? "held" : "pending"

  for (const d of desired) {
    const row = byOlx.get(d.olxId) ?? null
    const facts = { title: d.title, variant_id: d.variantId, product_id: d.productId, sku: d.sku }
    if (!row) {
      creates.push({
        olx_id: d.olxId,
        action: d.action,
        reason: d.reason,
        from_value: d.from,
        to_value: d.to,
        state: initialState(d, null),
        attempts: 0,
        planned_at: args.now,
        ...facts,
      })
      continue
    }
    if (IN_FLIGHT.has(row.state)) continue
    const sameAction = row.action === d.action && sameValue(row.to_value, d.to)
    if (sameAction && row.state === "quarantined") {
      if (!sameValue(row.from_value, d.from) || row.reason !== d.reason) {
        updates.push({ id: row.id, patch: { from_value: d.from, reason: d.reason, ...facts } })
      }
      continue
    }
    if (sameAction && OPEN.has(row.state)) {
      const patch: PlanRowPatch = {}
      const state = row.state === "failed" ? "failed" : initialState(d, row)
      if (state !== row.state) patch.state = state
      if (!sameValue(row.from_value, d.from)) patch.from_value = d.from
      if (row.reason !== d.reason) patch.reason = d.reason
      if (row.title !== d.title) patch.title = d.title
      if (Object.keys(patch).length > 0) updates.push({ id: row.id, patch })
      continue
    }
    updates.push({
      id: row.id,
      patch: {
        action: d.action,
        reason: d.reason,
        from_value: d.from,
        to_value: d.to,
        state: initialState(d, row),
        attempts: 0,
        last_error: null,
        note: null,
        planned_at: args.now,
        ...facts,
      },
    })
  }

  for (const row of rows) {
    if (wanted.has(row.olx_id)) continue
    const patch: PlanRowPatch = {}
    if (OPEN.has(row.state) || row.state === "quarantined") {
      patch.state = "idle"
      patch.attempts = 0
      patch.note = "no_longer_needed"
    }
    if (args.resumed?.has(row.olx_id) && row.paused_at) patch.paused_at = null
    if (Object.keys(patch).length > 0) updates.push({ id: row.id, patch })
  }
  for (const d of desired) {
    const row = byOlx.get(d.olxId)
    if (row && args.resumed?.has(row.olx_id) && row.paused_at && !IN_FLIGHT.has(row.state)) {
      const existing = updates.find((u) => u.id === row.id)
      if (existing) existing.patch.paused_at = null
      else updates.push({ id: row.id, patch: { paused_at: null } })
    }
  }
  return { creates, updates }
}

/* ------------------------------------------------------------------ */
/* What a run takes                                                    */
/* ------------------------------------------------------------------ */

const ACTION_ORDER: Record<string, number> = { deactivate: 0, finish: 1, activate: 2, price: 3 }

export function dueItems<T extends { state: string; attempts: number; action: string; olx_id: string; planned_at?: Date | string | null }>(
  rows: readonly T[],
  cap: number,
  opts: { holdEndings?: boolean } = {},
): T[] {
  const due = rows.filter((r) => {
    if (r.state !== "pending" && r.state !== "failed") return false
    if (r.attempts >= QUARANTINE_AFTER) return false
    if (opts.holdEndings && (r.action === "deactivate" || r.action === "finish")) return false
    return true
  })
  const time = (r: T): number => (r.planned_at ? new Date(r.planned_at).getTime() || 0 : 0)
  due.sort((a, b) => (ACTION_ORDER[a.action] ?? 9) - (ACTION_ORDER[b.action] ?? 9) || time(a) - time(b) || a.olx_id.localeCompare(b.olx_id))
  return due.slice(0, Math.max(0, cap))
}

/** State after a rejected attempt: failed, or quarantined after `QUARANTINE_AFTER` in a row. */
export function afterRejection(attempts: number): { state: "failed" | "quarantined"; attempts: number } {
  const next = attempts + 1
  return { state: next >= QUARANTINE_AFTER ? "quarantined" : "failed", attempts: next }
}

export interface PlanCounts {
  pending: number
  held: number
  failed: number
  quarantined: number
  unknown: number
  applying: number
  done: number
}

export function countPlan(rows: ReadonlyArray<{ state: string }>): PlanCounts {
  const out: PlanCounts = { pending: 0, held: 0, failed: 0, quarantined: 0, unknown: 0, applying: 0, done: 0 }
  for (const r of rows) {
    if (r.state in out) out[r.state as keyof PlanCounts] += 1
  }
  return out
}
