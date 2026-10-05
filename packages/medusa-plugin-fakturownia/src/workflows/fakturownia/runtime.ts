/**
 * Shared plumbing of the Fakturownia flows: the module service, the client,
 * the atomic store, run records, one-run-at-a-time guards, the last
 * connection check and events. Everything here calls the generated service
 * methods from the outside; the service itself stays thin.
 */

import type { IEventBusModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateEntityId } from "@medusajs/framework/utils"
import type FakturowniaModuleService from "../../modules/fakturownia/service"
import { FakturowniaClient } from "../../modules/fakturownia/lib/client"
import { FAKTUROWNIA_MODULE, RUNS_TO_KEEP } from "../../modules/fakturownia/lib/constants"
import type { CheckResult, RunDto, RunKind, RunStatus, RunTrigger } from "../../modules/fakturownia/lib/contract"
import type { OrderRecord } from "../../modules/fakturownia/lib/document"
import { ORDER_FIELDS } from "../../modules/fakturownia/lib/document"
import { toRunDto, type DocumentRow, type RunRow } from "../../modules/fakturownia/lib/dto"
import { createSqlStore, type DocumentPatch, type DocumentStore, type SqlRunner } from "../../modules/fakturownia/lib/store"

export type Scope = MedusaContainer | { resolve<T = unknown>(key: string, options?: { allowUnregistered?: boolean }): T }

function resolve<T>(scope: Scope, key: string): T {
  return (scope as { resolve<R>(k: string): R }).resolve<T>(key)
}

function resolveOptional<T>(scope: Scope, key: string): T | null {
  try {
    return ((scope as { resolve<R>(k: string, o?: { allowUnregistered?: boolean }): R }).resolve<T>(key, { allowUnregistered: true }) ?? null) as T | null
  } catch {
    return null
  }
}

export function fakturowniaService(scope: Scope): FakturowniaModuleService {
  return resolve<FakturowniaModuleService>(scope, FAKTUROWNIA_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return resolve<QueryLike>(scope, ContainerRegistrationKeys.QUERY)
}

/* ------------------------------------------------------------------ */
/* The client: one per service instance                                */
/* ------------------------------------------------------------------ */

const clients = new WeakMap<object, FakturowniaClient>()

/** The Fakturownia client of this store. Live mode only; demo mode never builds one. */
export function clientFor(svc: FakturowniaModuleService): FakturowniaClient {
  let client = clients.get(svc)
  if (!client) {
    const o = svc.getOptions()
    client = new FakturowniaClient({
      token: o.apiToken,
      account: o.account,
      requestsPerMinute: o.requestsPerMinute,
      timeoutMs: o.timeoutMs,
      logger: svc.getLogger(),
    })
    clients.set(svc, client)
  }
  return client
}

/* ------------------------------------------------------------------ */
/* The atomic store                                                    */
/* ------------------------------------------------------------------ */

/** Container key a custom (or test) implementation of the store may be registered under. */
export const STORE_KEY = "fakturowniaDocumentStore"

/** The atomic operations of the outbox: SQL on Medusa's own connection, unless a store is registered. */
export function storeFor(scope: Scope): DocumentStore {
  const registered = resolveOptional<DocumentStore>(scope, STORE_KEY)
  if (registered) return registered
  const sql = resolve<SqlRunner>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  return createSqlStore({ sql, newId: () => generateEntityId(undefined, "fkdoc") })
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export async function listDocuments(svc: FakturowniaModuleService, filters: Record<string, unknown>, config: Record<string, unknown> = {}): Promise<DocumentRow[]> {
  return (await svc.listFakturowniaDocuments(filters as never, config as never)) as unknown as DocumentRow[]
}

export async function getDocument(svc: FakturowniaModuleService, id: string): Promise<DocumentRow | null> {
  const rows = await listDocuments(svc, { id }, { take: 1 })
  return rows[0] ?? null
}

/** Rows of one order in the current mode, oldest first. */
export async function documentsOfOrder(svc: FakturowniaModuleService, orderId: string): Promise<DocumentRow[]> {
  return listDocuments(svc, { order_id: orderId, demo: svc.isDemo() }, { take: 20, order: { created_at: "ASC" } })
}

/** A plain update, for fields nobody else races for (the KSeF status, an e-mail state). */
export async function patchDocument(svc: FakturowniaModuleService, id: string, patch: DocumentPatch): Promise<DocumentRow> {
  return (await svc.updateFakturowniaDocuments({ id, ...patch } as never)) as unknown as DocumentRow
}

/** The order as the document builder reads it. */
export async function loadOrder(scope: Scope, orderId: string): Promise<OrderRecord | null> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: [...ORDER_FIELDS], filters: { id: orderId } })
  return (data[0] as OrderRecord | undefined) ?? null
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export interface RunRecord {
  kind: RunKind
  trigger: RunTrigger
  status: RunStatus
  startedAt: Date
  complete?: boolean
  counts?: Record<string, unknown> | null
  message?: string | null
}

/** Stores one run and keeps the last 50 of its kind. */
export async function recordRun(svc: FakturowniaModuleService, r: RunRecord): Promise<RunDto> {
  const finishedAt = new Date()
  const row = (await svc.createFakturowniaSyncRuns({
    kind: r.kind,
    source: svc.isDemo() ? "demo" : "api",
    trigger: r.trigger,
    status: r.status,
    complete: Boolean(r.complete),
    counts: r.counts ?? null,
    message: r.message ? svc.mask(r.message).slice(0, 2000) : null,
    duration_ms: finishedAt.getTime() - r.startedAt.getTime(),
    started_at: r.startedAt,
    finished_at: finishedAt,
  } as never)) as unknown as RunRow

  const old = (await svc.listFakturowniaSyncRuns({ kind: r.kind } as never, {
    order: { started_at: "DESC" },
    skip: RUNS_TO_KEEP,
    take: 500,
    select: ["id"],
  } as never)) as unknown as Array<{ id: string }>
  if (old.length > 0) await svc.deleteFakturowniaSyncRuns(old.map((o) => o.id))
  return toRunDto(row)
}

/** The latest run of a kind in the current mode. */
export async function lastRun(svc: FakturowniaModuleService, kind: RunKind): Promise<RunDto | null> {
  const rows = (await svc.listFakturowniaSyncRuns({ kind, source: svc.isDemo() ? "demo" : "api" } as never, {
    take: 1,
    order: { started_at: "DESC" },
  } as never)) as unknown as RunRow[]
  return rows[0] ? toRunDto(rows[0]) : null
}

/* ------------------------------------------------------------------ */
/* One run of each kind at a time per process                          */
/* ------------------------------------------------------------------ */

export type JobKind = RunKind | "check" | "backfill"

const RUNNING_KEY = Symbol.for("koda.fakturownia.running")
type Holder = typeof globalThis & { [RUNNING_KEY]?: Set<string> }

function runningSet(): Set<string> {
  const holder = globalThis as Holder
  if (!holder[RUNNING_KEY]) holder[RUNNING_KEY] = new Set<string>()
  return holder[RUNNING_KEY] as Set<string>
}

export function runningKinds(): string[] {
  return [...runningSet()].sort()
}

export function isRunning(kind: JobKind): boolean {
  return runningSet().has(kind)
}

/**
 * Runs `fn` unless the same kind already runs in this process; then returns
 * `null`. A convenience against piling up passes, not the safety of the
 * outbox: that is the atomic claim, which also holds across processes.
 */
export async function exclusive<T>(kind: JobKind, fn: () => Promise<T>): Promise<T | null> {
  const set = runningSet()
  if (set.has(kind)) return null
  set.add(kind)
  try {
    return await fn()
  } finally {
    set.delete(kind)
  }
}

/* ------------------------------------------------------------------ */
/* The last connection check (per process, for the admin)              */
/* ------------------------------------------------------------------ */

const CHECK_KEY = Symbol.for("koda.fakturownia.lastCheck")
type CheckHolder = typeof globalThis & { [CHECK_KEY]?: CheckResult }

export function rememberCheck(result: CheckResult): void {
  ;(globalThis as CheckHolder)[CHECK_KEY] = result
}

export function lastCheck(mode: "demo" | "live"): CheckResult | null {
  const result = (globalThis as CheckHolder)[CHECK_KEY] ?? null
  return result && result.mode === mode ? result : null
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** Emits a plugin event. A courtesy for subscribers, never a reason to fail a run. */
export async function emitEvent(scope: Scope, name: string, data: Record<string, unknown>): Promise<void> {
  try {
    const bus = resolve<IEventBusModuleService>(scope, Modules.EVENT_BUS)
    await bus.emit({ name, data })
  } catch (err) {
    fakturowniaService(scope)
      .getLogger()
      .warn(`[fakturownia] Could not emit ${name}: ${(err as Error)?.message ?? String(err)}`)
  }
}

/** Runs `fn` in the background; a failure is logged (masked), never thrown. */
export function inBackground(scope: Scope, label: string, fn: () => Promise<unknown>): void {
  setImmediate(() => {
    void Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        const svc = fakturowniaService(scope)
        svc.getLogger().error(`[fakturownia] ${label}: ${svc.mask((err as Error)?.message ?? String(err))}`)
      })
  })
}
