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
import { toRunDto, type DocumentRow, type PlanRow, type RunRow, type SettingRow } from "../../modules/fakturownia/lib/dto"
import { createSqlPlanStore, type PlanStore } from "../../modules/fakturownia/lib/plan-store"
import type { CompanyLookup, NipSource } from "../../modules/fakturownia/lib/nip"
import { createSqlStore, type DocumentPatch, type DocumentStore, type SqlRunner } from "../../modules/fakturownia/lib/store"
import { readWriterSetting, WRITERS, writerSettingKey, writerState, type WriterKey, type WriterState } from "../../modules/fakturownia/lib/writers"

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

/** Container key a custom (or test) implementation of the plan and setting store may be registered under. */
export const PLAN_STORE_KEY = "fakturowniaPlanStore"

/** The atomic operations of correction plans and settings. */
export function planStoreFor(scope: Scope): PlanStore {
  const registered = resolveOptional<PlanStore>(scope, PLAN_STORE_KEY)
  if (registered) return registered
  const sql = resolve<SqlRunner>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  return createSqlPlanStore({ sql, newId: (prefix) => generateEntityId(undefined, prefix) })
}

/* ------------------------------------------------------------------ */
/* Writers: the option and the toggle a person flips                  */
/* ------------------------------------------------------------------ */

/** The three writers of 0.2.0 in the current mode. */
export async function writerStates(svc: FakturowniaModuleService): Promise<Record<WriterKey, WriterState>> {
  const o = svc.getOptions()
  const keys = WRITERS.map((w) => writerSettingKey(w, o.demo))
  const rows = (await svc.listFakturowniaSettings({ key: keys } as never, { take: keys.length } as never)) as unknown as SettingRow[]
  const out = {} as Record<WriterKey, WriterState>
  for (const w of WRITERS) {
    const row = rows.find((r) => r.key === writerSettingKey(w, o.demo)) ?? null
    out[w] = writerState(w, o, readWriterSetting(row))
  }
  return out
}

export async function isArmed(svc: FakturowniaModuleService, writer: WriterKey): Promise<boolean> {
  return (await writerStates(svc))[writer].armed
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

/** Rows of one order in the current mode (corrections included), oldest first. */
export async function documentsOfOrder(svc: FakturowniaModuleService, orderId: string): Promise<DocumentRow[]> {
  return listDocuments(svc, { order_id: orderId, demo: svc.isDemo() }, { take: 100, order: { created_at: "ASC" } })
}

/* ------------------------------------------------------------------ */
/* One flow per key at a time, waiting (not skipping)                  */
/* ------------------------------------------------------------------ */

const LOCKS_KEY = Symbol.for("koda.fakturownia.locks")
type LockHolder = typeof globalThis & { [LOCKS_KEY]?: Map<string, Promise<unknown>> }

/**
 * Runs `fn` after every earlier `withLock` of the same key in this process.
 * Two events of one order (a return and its refund arriving together) then
 * plan one after the other, instead of both writing the same plan.
 */
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

/** A plain update, for fields nobody else races for (the KSeF status, an e-mail state). */
export async function patchDocument(svc: FakturowniaModuleService, id: string, patch: DocumentPatch): Promise<DocumentRow> {
  return (await svc.updateFakturowniaDocuments({ id, ...patch } as never)) as unknown as DocumentRow
}

/** The order as the document builder reads it, with the companies of the `company` NIP sources attached. */
export async function loadOrder(scope: Scope, orderId: string): Promise<OrderRecord | null> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: [...ORDER_FIELDS], filters: { id: orderId } })
  const order = (data[0] as OrderRecord | undefined) ?? null
  if (order) await attachCompanies(scope, order)
  return order
}

const COMPANY_WARNED_KEY = Symbol.for("koda.fakturownia.companyWarned")

function text(v: unknown): string | null {
  return typeof v === "string" || typeof v === "number" ? String(v).trim() || null : null
}

/**
 * `nipSources` may name a module of the store that keeps companies by
 * customer (B2B): its entity is read with Query, by the order's customer, and
 * the NIP and the name are attached as `company_lookup` for the buyer
 * mapping. A failed read (an entity Query does not know) never stops a
 * document: it is logged once and the next source decides.
 */
export async function attachCompanies(scope: Scope, order: OrderRecord): Promise<void> {
  const svc = fakturowniaService(scope)
  const sources = svc.getOptions().nipSources.filter((s): s is Extract<NipSource, { kind: "company" }> => s.kind === "company")
  if (sources.length === 0 || !order.customer_id) return
  const lookup: Record<string, CompanyLookup | null> = {}
  for (const s of sources) {
    try {
      const fields = [...new Set([s.customerField, s.nipField, ...(s.nameField ? [s.nameField] : [])])]
      const { data } = await queryOf(scope).graph({ entity: s.entity, fields, filters: { [s.customerField]: order.customer_id }, pagination: { take: 1 } })
      const row = data[0] as Record<string, unknown> | undefined
      lookup[s.entity] = row ? { nip: text(row[s.nipField]), name: s.nameField ? text(row[s.nameField]) : null } : null
    } catch (err) {
      lookup[s.entity] = null
      const holder = globalThis as typeof globalThis & { [COMPANY_WARNED_KEY]?: Set<string> }
      if (!holder[COMPANY_WARNED_KEY]) holder[COMPANY_WARNED_KEY] = new Set()
      const warned = holder[COMPANY_WARNED_KEY] as Set<string>
      if (!warned.has(s.entity)) {
        warned.add(s.entity)
        svc.getLogger().warn(`[fakturownia] nipSources: could not read "${s.entity}" by ${s.customerField}: ${svc.mask((err as Error)?.message ?? String(err))}`)
      }
    }
  }
  order.company_lookup = lookup
}

/** Correction plans, through the generated service. */
export async function listPlans(svc: FakturowniaModuleService, filters: Record<string, unknown>, config: Record<string, unknown> = {}): Promise<PlanRow[]> {
  return (await svc.listFakturowniaCorrections(filters as never, config as never)) as unknown as PlanRow[]
}

export async function getPlan(svc: FakturowniaModuleService, id: string): Promise<PlanRow | null> {
  return (await listPlans(svc, { id }, { take: 1 }))[0] ?? null
}

/**
 * Who did something, for the admin: the e-mail of an admin user (the user
 * module of Medusa, read from outside), "system" for the plugin itself.
 * Unknown ids stay ids. Never throws.
 */
export async function actorNames(scope: Scope, ids: ReadonlyArray<string | null | undefined>): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id) && id !== "system"))]
  const out: Record<string, string> = {}
  if (wanted.length === 0) return out
  try {
    const users = resolveOptional<{ listUsers(f: Record<string, unknown>, c?: Record<string, unknown>): Promise<Array<{ id: string; email?: string | null }>> }>(
      scope,
      Modules.USER,
    )
    if (!users) return out
    const rows = await users.listUsers({ id: wanted }, { select: ["id", "email"], take: wanted.length })
    for (const u of rows) if (u?.id && u.email) out[u.id] = u.email
  } catch {
    /* names are a courtesy */
  }
  return out
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

/** A refusal of an admin action, with the HTTP status the route answers. */
export class ActionError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ActionError"
    this.status = status
  }
}

/* ------------------------------------------------------------------ */
/* One run of each kind at a time per process                          */
/* ------------------------------------------------------------------ */

export type JobKind = RunKind | "check" | "backfill" | "demo-extras"

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
