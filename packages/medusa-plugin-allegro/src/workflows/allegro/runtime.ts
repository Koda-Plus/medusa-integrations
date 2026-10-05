/**
 * WHAT EVERY RUN NEEDS FROM THE CONTAINER: the module service (with the
 * database bound for the cross-process refresh lease), Query, the SQL
 * stores, small named state and run records.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, generateEntityId } from "@medusajs/framework/utils"
import type AllegroModuleService from "../../modules/allegro/service"
import { bindDb } from "../../modules/allegro/lib/connection"
import { ALLEGRO_MODULE, RUNS_TO_KEEP } from "../../modules/allegro/lib/constants"
import type { AllegroRunKind } from "../../modules/allegro/lib/contract"
import { toRunDto, type RunRow } from "../../modules/allegro/lib/dto"
import { createImportStore, createOutboxStore, type ImportStore, type OutboxStore, type SqlRunner } from "../../modules/allegro/lib/store"
import type { QueryLike } from "./catalog"

export type Scope = Pick<MedusaContainer, "resolve">

export function sqlOf(scope: Scope): SqlRunner | null {
  try {
    const db = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlRunner
    return db && typeof db.raw === "function" ? db : null
  } catch {
    return null
  }
}

/** The module service, with the database bound for the refresh lease. */
export function allegroOf(scope: Scope): AllegroModuleService {
  const svc = scope.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  bindDb(svc, sqlOf(scope))
  return svc
}

export function queryOf(scope: Scope): QueryLike {
  return scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as QueryLike
}

export function requireSql(scope: Scope): SqlRunner {
  const sql = sqlOf(scope)
  if (!sql) throw new Error("No database connection (__pg_connection__) in the container.")
  return sql
}

export function importStoreOf(scope: Scope): ImportStore {
  return createImportStore({ sql: requireSql(scope), newId: () => generateEntityId(undefined, "algimp") })
}

export function outboxStoreOf(scope: Scope): OutboxStore {
  return createOutboxStore({ sql: requireSql(scope), newId: () => generateEntityId(undefined, "algout") })
}

/* ------------------------------------------------------------------ */
/* Named state                                                         */
/* ------------------------------------------------------------------ */

export async function getState<T>(svc: AllegroModuleService, id: string): Promise<T | null> {
  const rows = (await svc.listAllegroStates({ id } as never, { take: 1 })) as unknown as Array<{ value: T | null }>
  return rows[0]?.value ?? null
}

export async function setState(svc: AllegroModuleService, id: string, value: unknown): Promise<void> {
  const rows = (await svc.listAllegroStates({ id } as never, { take: 1, select: ["id"] })) as unknown as Array<{ id: string }>
  if (rows[0]) await svc.updateAllegroStates({ id, value } as never)
  else await svc.createAllegroStates({ id, value } as never)
}

/* ------------------------------------------------------------------ */
/* One run of each kind at a time inside a process                     */
/* ------------------------------------------------------------------ */

const RUNNING_KEY = Symbol.for("koda.allegro.running")
type Holder = typeof globalThis & { [RUNNING_KEY]?: Set<string> }

function runningSet(): Set<string> {
  const holder = globalThis as Holder
  if (!holder[RUNNING_KEY]) holder[RUNNING_KEY] = new Set()
  return holder[RUNNING_KEY] as Set<string>
}

export function isRunning(kind: AllegroRunKind): boolean {
  return runningSet().has(kind)
}

/** Runs `work` unless a run of this kind is already going in this process. */
export async function exclusive<T>(kind: AllegroRunKind, work: () => Promise<T>): Promise<T | null> {
  const set = runningSet()
  if (set.has(kind)) return null
  set.add(kind)
  try {
    return await work()
  } finally {
    set.delete(kind)
  }
}

/* ------------------------------------------------------------------ */
/* Run records                                                         */
/* ------------------------------------------------------------------ */

export interface RunRecord {
  kind: AllegroRunKind
  source: "api" | "demo"
  trigger: string
  status: "ok" | "partial" | "error" | "skipped"
  complete?: boolean
  dryRun?: boolean
  items?: number
  created?: number
  updated?: number
  removed?: number
  issues?: number
  statuses?: Record<string, number> | null
  message?: string | null
  details?: Record<string, unknown> | null
  startedAt: Date
}

export async function recordRun(svc: AllegroModuleService, r: RunRecord) {
  const finishedAt = new Date()
  const row = (await svc.createAllegroSyncRuns({
    kind: r.kind,
    source: r.source,
    trigger: r.trigger,
    status: r.status,
    complete: r.complete ?? r.status === "ok",
    dry_run: r.dryRun ?? false,
    pages: 0,
    items: r.items ?? 0,
    statuses: r.statuses ?? null,
    issues: r.issues ?? 0,
    created_count: r.created ?? 0,
    updated_count: r.updated ?? 0,
    removed_count: r.removed ?? 0,
    message: r.message ? svc.mask(r.message).slice(0, 2000) : null,
    details: r.details ?? null,
    duration_ms: finishedAt.getTime() - r.startedAt.getTime(),
    started_at: r.startedAt,
    finished_at: finishedAt,
  } as never)) as unknown as RunRow
  await pruneRuns(svc, r.kind)
  return toRunDto(row)
}

export async function pruneRuns(svc: AllegroModuleService, kind: string): Promise<void> {
  const old = (await svc.listAllegroSyncRuns({ kind } as never, {
    order: { started_at: "DESC" },
    skip: RUNS_TO_KEEP,
    take: 500,
    select: ["id"],
  })) as unknown as Array<{ id: string }>
  if (old.length > 0) await svc.deleteAllegroSyncRuns(old.map((r) => r.id))
}

export function errorText(svc: AllegroModuleService, err: unknown): string {
  return svc.mask(err instanceof Error ? err.message : String(err)).slice(0, 1000)
}

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
