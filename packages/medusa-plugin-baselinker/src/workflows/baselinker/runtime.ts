/**
 * Shared plumbing of the BaseLinker flows: the module service, the client,
 * run records, one-run-at-a-time guards, per-order locks, order metadata and
 * events. Everything here calls the generated service methods from the
 * outside; the service itself stays thin.
 */

import { randomUUID } from "node:crypto"
import type { IEventBusModuleService, IOrderModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { BaseLinkerClient } from "../../modules/baselinker/lib/client"
import { BASELINKER_MODULE, ORDER_LOCK_SECONDS, RUNS_TO_KEEP } from "../../modules/baselinker/lib/constants"
import type { CheckResult, RunDto, RunKind, RunStatus, RunTrigger } from "../../modules/baselinker/lib/contract"
import { toRunDto, type RunRow } from "../../modules/baselinker/lib/dto"

export type Scope = MedusaContainer | { resolve<T = unknown>(key: string): T }

function resolve<T>(scope: Scope, key: string): T {
  return (scope as { resolve<R>(k: string): R }).resolve<T>(key)
}

export function baselinkerService(scope: Scope): BaseLinkerModuleService {
  return resolve<BaseLinkerModuleService>(scope, BASELINKER_MODULE)
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

const clients = new WeakMap<object, BaseLinkerClient>()

/** The BaseLinker client of this store. Live mode only; demo mode never builds one. */
export function clientFor(svc: BaseLinkerModuleService): BaseLinkerClient {
  let client = clients.get(svc)
  if (!client) {
    const o = svc.getOptions()
    client = new BaseLinkerClient({
      token: o.apiToken,
      exportOrders: o.exportOrders,
      requestsPerMinute: o.requestsPerMinute,
      timeoutMs: o.timeoutMs,
      logger: svc.getLogger(),
    })
    clients.set(svc, client)
  }
  return client
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
export async function recordRun(svc: BaseLinkerModuleService, r: RunRecord): Promise<RunDto> {
  const finishedAt = new Date()
  const row = (await svc.createBaseLinkerSyncRuns({
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

  const old = (await svc.listBaseLinkerSyncRuns({ kind: r.kind } as never, {
    order: { started_at: "DESC" },
    skip: RUNS_TO_KEEP,
    take: 500,
    select: ["id"],
  } as never)) as unknown as Array<{ id: string }>
  if (old.length > 0) await svc.deleteBaseLinkerSyncRuns(old.map((o) => o.id))
  return toRunDto(row)
}

/** The latest run of a kind in the current mode. */
export async function lastRun(svc: BaseLinkerModuleService, kind: RunKind): Promise<RunDto | null> {
  const rows = (await svc.listBaseLinkerSyncRuns({ kind, source: svc.isDemo() ? "demo" : "api" } as never, {
    take: 1,
    order: { started_at: "DESC" },
  } as never)) as unknown as RunRow[]
  return rows[0] ? toRunDto(rows[0]) : null
}

/* ------------------------------------------------------------------ */
/* One run of each kind at a time per process                          */
/* ------------------------------------------------------------------ */

export type JobKind = RunKind | "check"

const RUNNING_KEY = Symbol.for("koda.baselinker.running")
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

/** Runs `fn` unless the same kind already runs in this process; then returns `null`. */
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

const CHECK_KEY = Symbol.for("koda.baselinker.lastCheck")
type CheckHolder = typeof globalThis & { [CHECK_KEY]?: CheckResult }

export function rememberCheck(result: CheckResult): void {
  ;(globalThis as CheckHolder)[CHECK_KEY] = result
}

export function lastCheck(mode: "demo" | "live"): CheckResult | null {
  const result = (globalThis as CheckHolder)[CHECK_KEY] ?? null
  return result && result.mode === mode ? result : null
}

/* ------------------------------------------------------------------ */
/* One sender per order                                                */
/* ------------------------------------------------------------------ */

const LOCAL_LOCKS = Symbol.for("koda.baselinker.orderLocks")
type LockHolder = typeof globalThis & { [LOCAL_LOCKS]?: Set<string> }

interface LockingLike {
  acquire(keys: string | string[], args?: { ownerId?: string | null; expire?: number }): Promise<void>
  release(keys: string | string[], args?: { ownerId?: string | null }): Promise<boolean>
}

/**
 * Runs `fn` while holding the order: an in-process guard plus the Medusa
 * Locking module (a try-lock, released in `finally`, expiring after five
 * minutes if a process dies). With a distributed locking provider (Redis,
 * Postgres) this also keeps a server and a worker process from sending the
 * same order at once. Returns `null` when somebody else holds the order: the
 * caller simply moves on, the holder finishes the job.
 */
export async function withOrderLock<T>(scope: Scope, orderId: string, fn: () => Promise<T>): Promise<T | null> {
  const holder = globalThis as LockHolder
  const local = holder[LOCAL_LOCKS] ?? (holder[LOCAL_LOCKS] = new Set<string>())
  if (local.has(orderId)) return null
  local.add(orderId)
  const key = `baselinker:order:${orderId}`
  const ownerId = randomUUID()
  let locking: LockingLike | null = null
  try {
    locking = resolve<LockingLike>(scope, Modules.LOCKING)
  } catch {
    locking = null
  }
  try {
    if (locking) {
      try {
        await locking.acquire(key, { ownerId, expire: ORDER_LOCK_SECONDS })
      } catch {
        return null
      }
    }
    try {
      return await fn()
    } finally {
      if (locking) await locking.release(key, { ownerId }).catch(() => false)
    }
  } finally {
    local.delete(orderId)
  }
}

/* ------------------------------------------------------------------ */
/* Order metadata and events                                           */
/* ------------------------------------------------------------------ */

/** Adds keys to order metadata without dropping what other code stored there. */
export async function patchOrderMetadata(scope: Scope, orderId: string, patch: Record<string, unknown>): Promise<boolean> {
  const orders = resolve<IOrderModuleService>(scope, Modules.ORDER)
  const current = await orders.retrieveOrder(orderId, { select: ["id", "metadata"] }).catch(() => null)
  if (!current) return false
  const before = (current.metadata ?? {}) as Record<string, unknown>
  const changed = Object.entries(patch).some(([k, v]) => before[k] !== v)
  if (!changed) return true
  await orders.updateOrders(orderId, { metadata: { ...before, ...patch } })
  return true
}

/** Emits a plugin event. A courtesy for subscribers, never a reason to fail a run. */
export async function emitEvent(scope: Scope, name: string, data: Record<string, unknown>): Promise<void> {
  try {
    const bus = resolve<IEventBusModuleService>(scope, Modules.EVENT_BUS)
    await bus.emit({ name, data })
  } catch (err) {
    baselinkerService(scope)
      .getLogger()
      .warn(`[baselinker] Could not emit ${name}: ${(err as Error)?.message ?? String(err)}`)
  }
}
