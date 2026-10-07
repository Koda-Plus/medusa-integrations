/**
 * Shared plumbing of the BaseLinker flows: the module service, the client,
 * run records, one-run-at-a-time guards and per-record locks (leases across
 * every process, see ./leases), order metadata and events. Everything here calls the generated service methods from the
 * outside; the service itself stays thin.
 */

import { randomUUID } from "node:crypto"
import type { IEventBusModuleService, IOrderModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { BaseLinkerClient } from "../../modules/baselinker/lib/client"
import { BASELINKER_MODULE, ORDER_LOCK_SECONDS, RUNS_TO_KEEP } from "../../modules/baselinker/lib/constants"
import { RUN_KINDS, type CheckResult, type RunDto, type RunKind, type RunStatus, type RunTrigger } from "../../modules/baselinker/lib/contract"
import { toRunDto, type RunRow } from "../../modules/baselinker/lib/dto"
import { LockUnavailableError, liveLeases, withLease } from "./leases"

export { LockUnavailableError } from "./leases"

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
/* One run of each kind at a time, across every process                */
/* ------------------------------------------------------------------ */

export type JobKind = RunKind | "check" | "imports_statuses" | "journal" | "demo"

/** Every kind a lease can hold, for the "what runs right now" read. */
export const JOB_KINDS: readonly JobKind[] = [...RUN_KINDS, "check", "imports_statuses", "journal", "demo"]

const RUNNING_KEY = Symbol.for("koda.baselinker.running")
type Holder = typeof globalThis & { [RUNNING_KEY]?: Set<string> }

function runningSet(): Set<string> {
  const holder = globalThis as Holder
  if (!holder[RUNNING_KEY]) holder[RUNNING_KEY] = new Set<string>()
  return holder[RUNNING_KEY] as Set<string>
}

/** Kinds running in THIS process. `activeRunKinds` answers for every process of the store. */
export function runningKinds(): string[] {
  return [...runningSet()].sort()
}

const jobKey = (kind: string) => `lease:job:${kind}`

/** Kinds running in any process of the store right now (live job leases), plus this process. Reads only. */
export async function activeRunKinds(scopeOrService: Scope | BaseLinkerModuleService): Promise<string[]> {
  const local = runningKinds()
  const svc = "getOptions" in scopeOrService ? (scopeOrService as BaseLinkerModuleService) : baselinkerService(scopeOrService)
  try {
    const keys = await liveLeases(svc, JOB_KINDS.map(jobKey))
    return [...new Set([...local, ...keys.map((k) => k.slice("lease:job:".length))])].sort()
  } catch {
    return local
  }
}

/** Whether a kind runs in any process right now. */
export async function isJobRunning(scope: Scope, kind: JobKind): Promise<boolean> {
  return runningSet().has(kind) || (await activeRunKinds(scope)).includes(kind)
}

/** A lock store that does not answer is an error in the history and the log, never a quiet "busy". */
async function noteLockFailure(scope: Scope, kind: JobKind, err: LockUnavailableError): Promise<void> {
  const svc = baselinkerService(scope)
  svc.getLogger().error(`[baselinker] ${kind}: ${svc.mask(err.message)}`)
  if (!(RUN_KINDS as readonly string[]).includes(kind)) return
  await recordRun(svc, {
    kind: kind as RunKind,
    trigger: "auto",
    status: "error",
    startedAt: new Date(),
    complete: false,
    counts: { lockUnavailable: true },
    message: err.message,
  }).catch(() => undefined)
}

/**
 * Runs `fn` unless the same kind already runs in this process or holds its
 * lease in another one; then returns `null`. Manual runs from the admin and
 * the scheduled jobs take the same lease, so a click never doubles a job.
 */
export async function exclusive<T>(scope: Scope, kind: JobKind, fn: () => Promise<T>): Promise<T | null> {
  const set = runningSet()
  if (set.has(kind)) return null
  set.add(kind)
  try {
    return await withLease(baselinkerService(scope), jobKey(kind), fn)
  } catch (err) {
    if (err instanceof LockUnavailableError) {
      await noteLockFailure(scope, kind, err)
      return null
    }
    throw err
  } finally {
    set.delete(kind)
  }
}

/* ------------------------------------------------------------------ */
/* The last connection check (stored, so every process shows it)       */
/* ------------------------------------------------------------------ */

const CHECK_KEY = Symbol.for("koda.baselinker.lastCheck")
type CheckHolder = typeof globalThis & { [CHECK_KEY]?: CheckResult }
const CHECK_SETTING = "check:last"

/** Keeps the result for the admin: in the settings table (every process reads it) and in this process. */
export async function rememberCheck(svc: BaseLinkerModuleService, result: CheckResult): Promise<void> {
  ;(globalThis as CheckHolder)[CHECK_KEY] = result
  try {
    const demo = svc.isDemo()
    const rows = (await svc.listBaseLinkerSettings({ key: CHECK_SETTING, demo } as never, { take: 1 } as never)) as unknown as Array<{ id: string }>
    if (rows[0]) await svc.updateBaseLinkerSettings({ id: rows[0].id, value: result } as never)
    else await svc.createBaseLinkerSettings({ key: CHECK_SETTING, demo, value: result } as never)
  } catch (err) {
    svc.getLogger().warn(`[baselinker] The connection check result was not stored: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

/** The last check of the current mode, from any process. Reads only. */
export async function lastCheck(svc: BaseLinkerModuleService): Promise<CheckResult | null> {
  const mode = svc.isDemo() ? "demo" : "live"
  try {
    const rows = (await svc.listBaseLinkerSettings({ key: CHECK_SETTING, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as Array<{
      value: CheckResult | null
    }>
    const stored = rows[0]?.value ?? null
    if (stored && stored.mode === mode) return stored
  } catch {
    /* the copy of this process below */
  }
  const local = (globalThis as CheckHolder)[CHECK_KEY] ?? null
  return local && local.mode === mode ? local : null
}

/* ------------------------------------------------------------------ */
/* One sender per record                                               */
/* ------------------------------------------------------------------ */

const LOCAL_LOCKS = Symbol.for("koda.baselinker.orderLocks")
type LockHolder = typeof globalThis & { [LOCAL_LOCKS]?: Set<string> }

interface LockingLike {
  acquire(keys: string | string[], args?: { ownerId?: string | null; expire?: number }): Promise<void>
  release(keys: string | string[], args?: { ownerId?: string | null }): Promise<boolean>
}

/** Keys other plugins take in the Medusa Locking module too (the Koda Plus Allegro plugin takes the marketplace reference). */
const SHARED_LOCK_PREFIXES = ["marketplace-order-ref:"]

/**
 * A refusal of the Locking module because somebody holds the key (in-memory,
 * Redis and Postgres providers), as opposed to a provider that failed.
 */
export function isLockConflict(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err)
  return /failed to acquire lock|timed[- ]?out (while )?acquiring lock|already locked|lock (is )?(already )?(held|taken|acquired|owned)/i.test(text)
}

const BUSY = Symbol("busy")

async function withLockingModule<T>(scope: Scope, key: string, fn: () => Promise<T>): Promise<T | typeof BUSY> {
  let locking: LockingLike | null = null
  try {
    locking = resolve<LockingLike>(scope, Modules.LOCKING)
  } catch {
    locking = null
  }
  if (!locking) return fn()
  const ownerId = randomUUID()
  try {
    await locking.acquire(key, { ownerId, expire: ORDER_LOCK_SECONDS })
  } catch (err) {
    if (isLockConflict(err)) return BUSY
    throw new LockUnavailableError(key, err)
  }
  try {
    return await fn()
  } finally {
    await locking.release(key, { ownerId }).catch(() => false)
  }
}

/**
 * Runs `fn` while holding the order: an in-process guard plus the lease
 * `lease:lock:baselinker:order:<id>`, so a server and a worker never send
 * the same order at once. Returns `null` when somebody else holds the order:
 * the caller simply moves on, the holder finishes the job.
 */
export async function withOrderLock<T>(scope: Scope, orderId: string, fn: () => Promise<T>): Promise<T | null> {
  return withLock(scope, `baselinker:order:${orderId}`, fn)
}

/**
 * The same for any key: imported marketplace orders lock their BaseLinker id
 * (`baselinker:import:<id>`) and their marketplace reference
 * (`marketplace-order-ref:<ref>`, which also goes through the Medusa Locking
 * module, because other plugins take that key there). Null when somebody
 * holds the key; LockUnavailableError when the lease store or the Locking
 * provider fails.
 */
export async function withLock<T>(scope: Scope, key: string, fn: () => Promise<T>): Promise<T | null> {
  const holder = globalThis as LockHolder
  const local = holder[LOCAL_LOCKS] ?? (holder[LOCAL_LOCKS] = new Set<string>())
  if (local.has(key)) return null
  local.add(key)
  try {
    const shared = SHARED_LOCK_PREFIXES.some((p) => key.startsWith(p))
    const out = await withLease<T | typeof BUSY>(baselinkerService(scope), `lease:lock:${key}`, () => (shared ? withLockingModule(scope, key, fn) : fn()))
    return out === BUSY ? null : (out as T | null)
  } finally {
    local.delete(key)
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
