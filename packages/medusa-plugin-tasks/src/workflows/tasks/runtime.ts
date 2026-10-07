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

/** Emits a plugin event. A courtesy for subscribers, never a reason to fail a change. */
export async function emitEvent(scope: Scope, name: string, data: object): Promise<void> {
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
