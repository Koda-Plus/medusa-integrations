/**
 * THE ATOMIC OPERATIONS OF CORRECTION PLANS AND SETTINGS, in SQL, like the
 * outbox (`store.ts`): the connection is injected, so the unit tests check
 * the statements and drive the flows with an in-memory twin.
 *
 *   insertOpen   one open plan (draft or manual) per document: the partial
 *                unique index refuses a second one, and the insert is ignored
 *   updateOpen   a recomputation touches only a plan that is still open; the
 *                revision grows when the content changed
 *   approve      draft to approved for exactly one caller, and only for the
 *                revision the person saw: a plan recomputed in the meantime
 *                is refused, so what is issued is what was approved
 *   transition   any other move, only from the states it may come from
 *   setSetting   one row per key, written in one statement
 *   claimSetting one row per key, and only the first writer wins it (the
 *                one-time demo seed runs once across processes)
 */

import type { PlanRow, SettingRow } from "./dto"
import type { SqlRunner } from "./store"

export const PLAN_TABLE = "fakturownia_correction"
export const SETTING_TABLE = "fakturownia_setting"

export type PlanStatus = "draft" | "manual" | "approved" | "issued" | "dismissed" | "done" | "obsolete"
export const OPEN_PLAN_STATUSES: readonly PlanStatus[] = ["draft", "manual"]
/** Plans whose positions count as applied when the next plan is computed. */
export const DECIDED_PLAN_STATUSES: readonly PlanStatus[] = ["approved", "issued", "dismissed", "done"]

export interface NewPlan {
  order_id: string
  display_id: number | null
  document_id: string
  document_kind: string
  document_number: string | null
  demo: boolean
  status: "draft" | "manual"
  manual_reason: string | null
  sources: unknown
  reasons: unknown
  reason: string | null
  positions: unknown
  notes: unknown
  currency: string | null
  delta_net: number | null
  delta_vat: number | null
  delta_gross: number | null
  simulated?: boolean
  computed_at: Date
}

export type PlanPatch = Partial<
  Pick<
    PlanRow,
    | "status"
    | "manual_reason"
    | "sources"
    | "reasons"
    | "reason"
    | "positions"
    | "notes"
    | "currency"
    | "delta_net"
    | "delta_vat"
    | "delta_gross"
    | "document_number"
    | "correction_document_id"
    | "closed_by"
    | "closed_at"
    | "close_note"
    | "computed_at"
  >
>

export interface PlanStore {
  insertOpen(plan: NewPlan): Promise<PlanRow | null>
  updateOpen(id: string, patch: PlanPatch, bumpRevision: boolean): Promise<PlanRow | null>
  approve(id: string, args: { revision: number; approvedBy: string | null; reason: string; sourceKey: string; now: Date }): Promise<PlanRow | null>
  transition(id: string, from: readonly string[], patch: PlanPatch): Promise<PlanRow | null>
  setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRow | null>
  /** Inserts a setting only when the key is new: true for exactly one caller (a one-time job). */
  claimSetting(key: string, value: unknown): Promise<boolean>
}

export const PLAN_PATCHABLE: readonly string[] = [
  "status",
  "manual_reason",
  "sources",
  "reasons",
  "reason",
  "positions",
  "notes",
  "currency",
  "delta_net",
  "delta_vat",
  "delta_gross",
  "document_number",
  "correction_document_id",
  "closed_by",
  "closed_at",
  "close_note",
  "computed_at",
]

const PLAN_JSON: ReadonlySet<string> = new Set(["sources", "reasons", "positions", "notes"])

export function planSetClause(patch: PlanPatch): { sql: string; bindings: unknown[] } {
  const parts: string[] = []
  const bindings: unknown[] = []
  const values = patch as Record<string, unknown>
  for (const column of PLAN_PATCHABLE) {
    if (!(column in values) || values[column] === undefined) continue
    const v = values[column]
    if (PLAN_JSON.has(column)) {
      parts.push(`"${column}" = ?::jsonb`)
      bindings.push(v === null ? null : JSON.stringify(v))
    } else {
      parts.push(`"${column}" = ?`)
      bindings.push(v)
    }
  }
  parts.push(`"updated_at" = now()`)
  return { sql: parts.join(", "), bindings }
}

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown } | null)?.rows
  return Array.isArray(rows) ? (rows as T[]) : []
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v))

export function createSqlPlanStore(deps: { sql: SqlRunner; newId: (prefix: string) => string }): PlanStore {
  const { sql, newId } = deps
  return {
    async insertOpen(p) {
      const result = await sql.raw(
        `insert into "${PLAN_TABLE}" ("id", "order_id", "display_id", "document_id", "document_kind", "document_number", "demo", "status", "manual_reason",
                                      "revision", "sources", "reasons", "reason", "positions", "notes", "currency", "delta_net", "delta_vat", "delta_gross",
                                      "simulated", "computed_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?, now(), now())
         on conflict do nothing
         returning *`,
        [
          newId("fkcor"),
          p.order_id,
          p.display_id,
          p.document_id,
          p.document_kind,
          p.document_number,
          p.demo,
          p.status,
          p.manual_reason,
          json(p.sources),
          json(p.reasons),
          p.reason,
          json(p.positions),
          json(p.notes),
          p.currency,
          p.delta_net,
          p.delta_vat,
          p.delta_gross,
          Boolean(p.simulated),
          p.computed_at,
        ],
      )
      return rowsOf<PlanRow>(result)[0] ?? null
    },

    async updateOpen(id, patch, bumpRevision) {
      const set = planSetClause(patch)
      const result = await sql.raw(
        `update "${PLAN_TABLE}" set ${set.sql}, "revision" = "revision" + ?
         where "id" = ? and "status" in ('draft', 'manual') and "deleted_at" is null
         returning *`,
        [...set.bindings, bumpRevision ? 1 : 0, id],
      )
      return rowsOf<PlanRow>(result)[0] ?? null
    },

    async approve(id, args) {
      const result = await sql.raw(
        `update "${PLAN_TABLE}"
         set "status" = 'approved', "approved_by" = ?, "approved_at" = ?, "reason" = ?, "source_key" = ?, "updated_at" = now()
         where "id" = ? and "status" = 'draft' and "revision" = ? and "deleted_at" is null
         returning *`,
        [args.approvedBy, args.now, args.reason, args.sourceKey, id, args.revision],
      )
      return rowsOf<PlanRow>(result)[0] ?? null
    },

    async transition(id, from, patch) {
      if (from.length === 0) return null
      const set = planSetClause(patch)
      const placeholders = from.map(() => "?").join(", ")
      const result = await sql.raw(
        `update "${PLAN_TABLE}" set ${set.sql}
         where "id" = ? and "status" in (${placeholders}) and "deleted_at" is null
         returning *`,
        [...set.bindings, id, ...from],
      )
      return rowsOf<PlanRow>(result)[0] ?? null
    },

    async setSetting(key, value, updatedBy) {
      const result = await sql.raw(
        `insert into "${SETTING_TABLE}" ("id", "key", "value", "updated_by", "created_at", "updated_at")
         values (?, ?, ?::jsonb, ?, now(), now())
         on conflict ("key") do update set "value" = excluded."value", "updated_by" = excluded."updated_by", "updated_at" = now(), "deleted_at" = null
         returning *`,
        [newId("fkset"), key, json(value), updatedBy],
      )
      return rowsOf<SettingRow>(result)[0] ?? null
    },

    async claimSetting(key, value) {
      const result = await sql.raw(
        `insert into "${SETTING_TABLE}" ("id", "key", "value", "updated_by", "created_at", "updated_at")
         values (?, ?, ?::jsonb, ?, now(), now())
         on conflict ("key") do nothing
         returning "id"`,
        [newId("fkset"), key, json(value), "system"],
      )
      return rowsOf<{ id: string }>(result).length > 0
    },
  }
}
