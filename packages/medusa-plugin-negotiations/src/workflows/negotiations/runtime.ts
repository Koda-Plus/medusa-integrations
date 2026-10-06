/**
 * Shared plumbing of the Negotiations flows: the module service and its
 * options, the stores (SQL on Medusa's own connection, or a registered test
 * double), Query, the store's defaults, events, names of admin users, run
 * records, locks. Everything here talks to the database through
 * `lib/store.ts`; the module service only lends its options.
 */

import type { IEventBusModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateEntityId } from "@medusajs/framework/utils"
import type NegotiationsModuleService from "../../modules/negotiations/service"
import { NEGOTIATIONS_MODULE, RUNS_TO_KEEP } from "../../modules/negotiations/lib/constants"
import type { RunDto, RunKind, RunStatus, RunTrigger } from "../../modules/negotiations/lib/contract"
import { toRunDto } from "../../modules/negotiations/lib/dto"
import { normalizeCurrency } from "../../modules/negotiations/lib/money"
import type { ResolvedNegotiationsOptions } from "../../modules/negotiations/lib/options"
import type { ThreadRow } from "../../modules/negotiations/lib/rows"
import {
  createDraftOrderStore,
  createSettingStore,
  createThreadStore,
  type DraftOrderStore,
  type SettingStore,
  type SqlRunner,
  type ThreadStore,
} from "../../modules/negotiations/lib/store"
import { normalizeThread, type NormalizeContext, type Thread } from "../../modules/negotiations/lib/thread"

export type Scope = MedusaContainer | { resolve<T = unknown>(key: string, options?: { allowUnregistered?: boolean }): T }

function resolve<T>(scope: Scope, key: string): T {
  return (scope as { resolve<R>(k: string): R }).resolve<T>(key)
}

export function resolveOptional<T>(scope: Scope, key: string): T | null {
  try {
    return ((scope as { resolve<R>(k: string, o?: { allowUnregistered?: boolean }): R }).resolve<T>(key, { allowUnregistered: true }) ?? null) as T | null
  } catch {
    return null
  }
}

export function negotiationsService(scope: Scope): NegotiationsModuleService {
  return resolve<NegotiationsModuleService>(scope, NEGOTIATIONS_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return resolve<QueryLike>(scope, ContainerRegistrationKeys.QUERY)
}

/** Query that never throws: an empty answer when the entity or a field is unknown to this Medusa. */
export async function graph<T>(scope: Scope, args: Record<string, unknown>): Promise<T[]> {
  try {
    const { data } = await queryOf(scope).graph(args)
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
  threads: ThreadStore
  settings: SettingStore
  drafts: DraftOrderStore
}

/** Container key a custom (or test) implementation of the stores may be registered under. */
export const STORES_KEY = "negotiationsStores"

export function storesFor(scope: Scope): Stores {
  const registered = resolveOptional<Stores>(scope, STORES_KEY)
  if (registered) return registered
  const sql = resolve<SqlRunner>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  return { threads: createThreadStore(sql), settings: createSettingStore(sql, newId), drafts: createDraftOrderStore(sql) }
}

/* ------------------------------------------------------------------ */
/* The store's defaults                                                */
/* ------------------------------------------------------------------ */

export interface StoreDefaults {
  /** The store's default currency, lower case. */
  currency: string | null
  /** Every currency the store supports. Empty when the store could not be read. */
  currencies: string[]
  salesChannelId: string | null
}

const DEFAULTS_KEY = Symbol.for("koda.negotiations.storeDefaults")
const DEFAULTS_TTL_MS = 5 * 60 * 1000
type DefaultsHolder = typeof globalThis & { [DEFAULTS_KEY]?: { at: number; value: StoreDefaults } }

/** The store's currencies and default sales channel, read once every five minutes. */
export async function storeDefaults(scope: Scope): Promise<StoreDefaults> {
  const holder = globalThis as DefaultsHolder
  const cached = holder[DEFAULTS_KEY]
  if (cached && Date.now() - cached.at < DEFAULTS_TTL_MS) return cached.value
  const rows = await graph<{
    default_sales_channel_id?: string | null
    supported_currencies?: Array<{ currency_code?: string | null; is_default?: boolean | null } | null> | null
  }>(scope, { entity: "store", fields: ["id", "default_sales_channel_id", "supported_currencies.currency_code", "supported_currencies.is_default"] })
  const store = rows[0]
  const currencies = (store?.supported_currencies ?? [])
    .map((c) => normalizeCurrency(c?.currency_code))
    .filter((c): c is string => Boolean(c))
  const def = (store?.supported_currencies ?? []).find((c) => c?.is_default)
  const value: StoreDefaults = {
    currency: normalizeCurrency(def?.currency_code) ?? currencies[0] ?? null,
    currencies: [...new Set(currencies)],
    salesChannelId: store?.default_sales_channel_id ?? null,
  }
  if (store) holder[DEFAULTS_KEY] = { at: Date.now(), value }
  return value
}

/** Forgets the cached defaults (tests, or after the store's currencies change). */
export function forgetStoreDefaults(): void {
  delete (globalThis as DefaultsHolder)[DEFAULTS_KEY]
}

/* ------------------------------------------------------------------ */
/* One environment per call                                            */
/* ------------------------------------------------------------------ */

export interface Env {
  svc: NegotiationsModuleService
  options: ResolvedNegotiationsOptions
  stores: Stores
  ctx: NormalizeContext
  now: Date
}

export async function envOf(scope: Scope): Promise<Env> {
  const svc = negotiationsService(scope)
  const options = svc.getOptions()
  const defaultCurrency = options.defaultCurrency ?? (await storeDefaults(scope)).currency
  return { svc, options, stores: storesFor(scope), ctx: { defaultCurrency, expiryDays: options.expiryDays }, now: new Date() }
}

export function normalize(env: Env, row: ThreadRow): Thread {
  return normalizeThread(row, env.ctx)
}

/** A thread of the current mode, or null. Admin and store reads go through this. */
export async function threadOfMode(env: Env, id: string): Promise<ThreadRow | null> {
  const row = await env.stores.threads.getThread(id)
  return row && Boolean(row.demo) === env.options.demo ? row : null
}

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

/** A refusal with the HTTP status the route answers and a stable code for storefronts. */
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

/* ------------------------------------------------------------------ */
/* Events, names, runs                                                 */
/* ------------------------------------------------------------------ */

/** Emits a plugin event. A courtesy for subscribers, never a reason to fail a move. */
export async function emitEvent(scope: Scope, name: string, data: Record<string, unknown>): Promise<void> {
  try {
    const bus = resolve<IEventBusModuleService>(scope, Modules.EVENT_BUS)
    await bus.emit({ name, data })
  } catch (err) {
    try {
      negotiationsService(scope)
        .getLogger()
        .warn(`[negotiations] Could not emit ${name}: ${(err as Error)?.message ?? String(err)}`)
    } catch {
      /* no logger either */
    }
  }
}

/** Admin users' names for the admin: first and last name, or the e-mail. Unknown ids are left out. Never throws. */
export async function userNames(scope: Scope, ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.startsWith("user_")))]
  const out = new Map<string, string>()
  if (wanted.length === 0) return out
  try {
    const users = resolveOptional<{
      listUsers(f: Record<string, unknown>, c?: Record<string, unknown>): Promise<Array<{ id: string; email?: string | null; first_name?: string | null; last_name?: string | null }>>
    }>(scope, Modules.USER)
    if (!users) return out
    const rows = await users.listUsers({ id: wanted }, { select: ["id", "email", "first_name", "last_name"], take: wanted.length })
    for (const u of rows) {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim()
      if (u?.id) out.set(u.id, name || u.email || u.id)
    }
  } catch {
    /* names are a courtesy */
  }
  return out
}

export interface RunRecord {
  kind: RunKind
  trigger: RunTrigger
  status: RunStatus
  startedAt: Date
  counts?: Record<string, number>
  message?: string | null
}

/** Stores one run and keeps the last 50 of its kind and mode. Never throws: a run that worked stays a run that worked. */
export async function recordRun(scope: Scope, demo: boolean, r: RunRecord): Promise<RunDto> {
  const finishedAt = new Date()
  const row = {
    id: newId("negrun"),
    kind: r.kind,
    trigger: r.trigger,
    status: r.status,
    demo,
    counts: r.counts ?? {},
    message: r.message ? r.message.slice(0, 2000) : null,
    started_at: r.startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt.getTime() - r.startedAt.getTime(),
  }
  try {
    const stored = await storesFor(scope).settings.recordRun(row, RUNS_TO_KEEP)
    if (stored) return toRunDto(stored)
  } catch (err) {
    try {
      negotiationsService(scope)
        .getLogger()
        .warn(`[negotiations] Could not record the ${r.kind} run: ${(err as Error)?.message ?? String(err)}`)
    } catch {
      /* ignore */
    }
  }
  return toRunDto({ ...row, finished_at: finishedAt })
}

/* ------------------------------------------------------------------ */
/* Locks and background work                                           */
/* ------------------------------------------------------------------ */

const LOCKS_KEY = Symbol.for("koda.negotiations.locks")
type LockHolder = typeof globalThis & { [LOCKS_KEY]?: Map<string, Promise<unknown>> }

/** Runs `fn` after every earlier `withLock` of the same key in this process (two opens of one customer, one after the other). */
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

const RUNNING_KEY = Symbol.for("koda.negotiations.running")
type RunningHolder = typeof globalThis & { [RUNNING_KEY]?: Set<string> }

/** Runs `fn` unless the same job already runs in this process; then returns null. */
export async function exclusive<T>(kind: string, fn: () => Promise<T>): Promise<T | null> {
  const holder = globalThis as RunningHolder
  if (!holder[RUNNING_KEY]) holder[RUNNING_KEY] = new Set()
  const set = holder[RUNNING_KEY] as Set<string>
  if (set.has(kind)) return null
  set.add(kind)
  try {
    return await fn()
  } finally {
    set.delete(kind)
  }
}

/** Runs `fn` in the background; a failure is logged, never thrown. */
export function inBackground(scope: Scope, label: string, fn: () => Promise<unknown>): void {
  setImmediate(() => {
    void Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        try {
          negotiationsService(scope)
            .getLogger()
            .error(`[negotiations] ${label}: ${(err as Error)?.message ?? String(err)}`)
        } catch {
          /* ignore */
        }
      })
  })
}
