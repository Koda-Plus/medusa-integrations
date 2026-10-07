/**
 * Shared plumbing of the Tasks flows: the module's options, the stores (SQL
 * on Medusa's own connection, or a registered test double), Query, events,
 * ids, refusals and locks. Everything here talks to the database through
 * `lib/store.ts`; the module service only lends its options.
 */

import type { IEventBusModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateEntityId } from "@medusajs/framework/utils"
import type TasksModuleService from "../../modules/tasks/service"
import { TASKS_MODULE, type Board } from "../../modules/tasks/lib/constants"
import type { ResolvedTasksOptions } from "../../modules/tasks/lib/options"
import {
  createBoardStore,
  createSandboxStore,
  createSettingStore,
  type BoardStore,
  type SandboxStore,
  type SettingStore,
  type SqlRunner,
} from "../../modules/tasks/lib/store"

export type Scope = MedusaContainer | { resolve<T = unknown>(key: string, options?: { allowUnregistered?: boolean }): T }

export function resolve<T>(scope: Scope, key: string): T {
  return (scope as { resolve<R>(k: string): R }).resolve<T>(key)
}

export function resolveOptional<T>(scope: Scope, key: string): T | null {
  try {
    return ((scope as { resolve<R>(k: string, o?: { allowUnregistered?: boolean }): R }).resolve<T>(key, { allowUnregistered: true }) ?? null) as T | null
  } catch {
    return null
  }
}

export function tasksService(scope: Scope): TasksModuleService {
  return resolve<TasksModuleService>(scope, TASKS_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

/** Query that never throws: an empty answer when the entity or a field is unknown to this Medusa. */
export async function graph<T>(scope: Scope, args: Record<string, unknown>): Promise<T[]> {
  try {
    const { data } = await resolve<QueryLike>(scope, ContainerRegistrationKeys.QUERY).graph(args)
    return Array.isArray(data) ? (data as T[]) : []
  } catch {
    return []
  }
}

export function newId(prefix: string): string {
  return generateEntityId(undefined, prefix)
}

/* ------------------------------------------------------------------ */
/* The stores                                                          */
/* ------------------------------------------------------------------ */

export interface Stores {
  /** The store bound to one board: every statement filters by it. */
  board(board: Board): BoardStore
  settings: SettingStore
  sandbox: SandboxStore
}

/** Container key a custom (or test) implementation of the stores may be registered under. */
export const STORES_KEY = "tasksStores"

export function storesFor(scope: Scope): Stores {
  const registered = resolveOptional<Stores>(scope, STORES_KEY)
  if (registered) return registered
  const sql = resolve<SqlRunner>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  return {
    board: (board) => createBoardStore(sql, board),
    settings: createSettingStore(sql, newId),
    sandbox: createSandboxStore(sql),
  }
}

/* ------------------------------------------------------------------ */
/* One environment per call                                            */
/* ------------------------------------------------------------------ */

export interface Env {
  options: ResolvedTasksOptions
  stores: Stores
  now: Date
}

export function envOf(scope: Scope): Env {
  return { options: tasksService(scope).getOptions(), stores: storesFor(scope), now: new Date() }
}

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

/** A refusal with the HTTP status the route answers and a stable code for scripts. */
export class ActionError extends Error {
  readonly status: number
  readonly code: string
  readonly extra: Record<string, unknown>
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = "ActionError"
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const notFound = (what = "Task") => new ActionError(404, "not_found", `${what} not found.`)

/* ------------------------------------------------------------------ */
/* Logging and events                                                  */
/* ------------------------------------------------------------------ */

export function warn(scope: Scope, message: string): void {
  try {
    tasksService(scope).getLogger().warn(`[tasks] ${message}`)
  } catch {
    /* no logger in this scope */
  }
}

/**
 * Emits a plugin event. A courtesy for subscribers, never a reason to fail a
 * change. Events of the sandbox board (`demo: true`) are written by public
 * visitors, so they are not emitted unless `sandboxEvents: "emit"`: one
 * subscriber that forgets to skip them would post a stranger's text to the
 * team's Slack or Discord.
 */
export async function emitEvent(scope: Scope, name: string, data: object): Promise<void> {
  if ((data as { demo?: unknown }).demo === true) {
    try {
      if (tasksService(scope).getOptions().sandboxEvents !== "emit") return
    } catch {
      return
    }
  }
  try {
    const bus = resolve<IEventBusModuleService>(scope, Modules.EVENT_BUS)
    await bus.emit({ name, data: data as Record<string, unknown> })
  } catch (err) {
    warn(scope, `Could not emit ${name}: ${(err as Error)?.message ?? String(err)}`)
  }
}

/* ------------------------------------------------------------------ */
/* Locks                                                               */
/* ------------------------------------------------------------------ */

const LOCKS_KEY = Symbol.for("koda.tasks.locks")
type LockHolder = typeof globalThis & { [LOCKS_KEY]?: Map<string, Promise<unknown>> }

/** Runs `fn` after every earlier `withLock` of the same key in this process (two first openings of the sandbox). */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const holder = globalThis as LockHolder
  if (!holder[LOCKS_KEY]) holder[LOCKS_KEY] = new Map()
  const locks = holder[LOCKS_KEY] as Map<string, Promise<unknown>>
  const previous = locks.get(key) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  locks.set(key, tail)
  try {
    return await run
  } finally {
    if (locks.get(key) === tail) locks.delete(key)
  }
}

/* ------------------------------------------------------------------ */
/* Rate of changes (the shared sandbox board)                          */
/* ------------------------------------------------------------------ */

const RATE_KEY = Symbol.for("koda.tasks.rate")
type RateHolder = typeof globalThis & { [RATE_KEY]?: Map<string, number[]> }

/**
 * Counts one change of `key` and says whether it stays within `limit` per
 * `windowMs` (a sliding window in this process). Old entries are dropped as
 * they expire; the map forgets everything past a few thousand keys.
 */
export function withinRate(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
  if (limit <= 0) return true
  const holder = globalThis as RateHolder
  if (!holder[RATE_KEY]) holder[RATE_KEY] = new Map()
  const map = holder[RATE_KEY] as Map<string, number[]>
  if (map.size > 5000) map.clear()
  const recent = (map.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= limit) {
    map.set(key, recent)
    return false
  }
  recent.push(now)
  map.set(key, recent)
  return true
}

/**
 * The shared sandbox board takes `sandboxLimits.writesPerMinute` changes per
 * account (or key) a minute; more answer 429 `sandbox_busy`. The team's
 * board has no such limit.
 */
export function sandboxPace(scope: Scope, ctx: { sandbox: boolean; actor: { type: string; id: string | null } }): void {
  if (!ctx.sandbox) return
  const limit = envOf(scope).options.sandboxLimits.writesPerMinute
  if (!withinRate(`sandbox:${ctx.actor.type}:${ctx.actor.id ?? "anonymous"}`, limit, 60_000)) {
    throw new ActionError(429, "sandbox_busy", "Too many changes on the sandbox board in a minute. Wait a moment and try again.")
  }
}

/** Forgets every counted change (tests). */
export function forgetRates(): void {
  ;(globalThis as RateHolder)[RATE_KEY]?.clear()
}
