/**
 * Shared plumbing of the InPost flows: the module service, the ShipX client,
 * the atomic store, the settings and writers of the current mode, the order
 * as plans read it, events and history rows, one-pass-at-a-time guards.
 * Everything here calls the generated service methods from the outside; the
 * service itself stays thin.
 */

import type { IEventBusModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateEntityId } from "@medusajs/framework/utils"
import type InpostModuleService from "../../modules/inpost/service"
import { createShipxClient, type ShipxClient } from "../../modules/inpost/lib/client"
import { INPOST_MODULE } from "../../modules/inpost/lib/constants"
import type { EventRow, ParcelRow, SettingRow } from "../../modules/inpost/lib/dto"
import { PLAN_ORDER_FIELDS, type PlanOrder } from "../../modules/inpost/lib/plan"
import { effectiveSettings, readStoredSettings, settingsKey, type EffectiveSettings } from "../../modules/inpost/lib/settings"
import { createSqlStore, type NewEvent, type ParcelStore, type SqlRunner } from "../../modules/inpost/lib/store"
import { readWriterSetting, WRITERS, writerSettingKey, writerState, type WriterKey, type WriterState } from "../../modules/inpost/lib/writers"

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

export function inpostService(scope: Scope): InpostModuleService {
  return resolve<InpostModuleService>(scope, INPOST_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return resolve<QueryLike>(scope, ContainerRegistrationKeys.QUERY)
}

/* ------------------------------------------------------------------ */
/* The ShipX client: one per service instance                          */
/* ------------------------------------------------------------------ */

const clients = new WeakMap<object, ShipxClient>()
/** Container key a test (or a custom) ShipX client may be registered under. */
export const CLIENT_KEY = "inpostShipxClient"

export function clientFor(scope: Scope): ShipxClient {
  const registered = resolveOptional<ShipxClient>(scope, CLIENT_KEY)
  if (registered) return registered
  const svc = inpostService(scope)
  let client = clients.get(svc)
  if (!client) {
    const o = svc.getOptions()
    const logger = svc.getLogger()
    client = createShipxClient({
      token: o.apiToken,
      organizationId: o.organizationId,
      sandbox: o.sandbox,
      timeoutMs: o.timeoutMs,
      requestsPerMinute: o.requestsPerMinute,
      logger: { info: (m) => logger.info(svc.mask(m)), warn: (m) => logger.warn(svc.mask(m)), error: (m) => logger.error(svc.mask(m)) },
    })
    clients.set(svc, client)
  }
  return client
}

/* ------------------------------------------------------------------ */
/* The atomic store                                                    */
/* ------------------------------------------------------------------ */

/** Container key a custom (or test) implementation of the store may be registered under. */
export const STORE_KEY = "inpostParcelStore"

export function storeFor(scope: Scope): ParcelStore {
  const registered = resolveOptional<ParcelStore>(scope, STORE_KEY)
  if (registered) return registered
  const sql = resolve<SqlRunner>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  return createSqlStore({ sql, newId: (prefix) => generateEntityId(undefined, prefix) })
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export async function listParcels(svc: InpostModuleService, filters: Record<string, unknown>, config: Record<string, unknown> = {}): Promise<ParcelRow[]> {
  return (await svc.listInpostParcels(filters as never, config as never)) as unknown as ParcelRow[]
}

export async function countParcels(svc: InpostModuleService, filters: Record<string, unknown>): Promise<number> {
  const [, n] = await svc.listAndCountInpostParcels(filters as never, { take: 1, select: ["id"] } as never)
  return n
}

export async function getParcel(svc: InpostModuleService, id: string): Promise<ParcelRow | null> {
  const rows = await listParcels(svc, { id }, { take: 1 })
  return rows[0] ?? null
}

/** A row of the current mode (a demo row never answers a live request, and the other way round). */
export async function getParcelOfMode(svc: InpostModuleService, id: string): Promise<ParcelRow | null> {
  const row = await getParcel(svc, id)
  return row && Boolean(row.demo) === svc.isDemo() ? row : null
}

export async function listEvents(svc: InpostModuleService, filters: Record<string, unknown>, config: Record<string, unknown> = {}): Promise<EventRow[]> {
  return (await svc.listInpostParcelEvents(filters as never, config as never)) as unknown as EventRow[]
}

export async function getSetting(svc: InpostModuleService, key: string): Promise<SettingRow | null> {
  const rows = (await svc.listInpostSettings({ key } as never, { take: 1 } as never)) as unknown as SettingRow[]
  return rows[0] ?? null
}

/** The settings in force for the current mode. */
export async function settingsOf(svc: InpostModuleService): Promise<EffectiveSettings> {
  const row = await getSetting(svc, settingsKey(svc.isDemo()))
  return effectiveSettings(svc.getOptions(), readStoredSettings(row?.value))
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

export async function writerStates(svc: InpostModuleService): Promise<Record<WriterKey, WriterState>> {
  const o = svc.getOptions()
  const keys = WRITERS.map((w) => writerSettingKey(w, o.demo))
  const rows = (await svc.listInpostSettings({ key: keys } as never, { take: keys.length } as never)) as unknown as SettingRow[]
  const out = {} as Record<WriterKey, WriterState>
  for (const w of WRITERS) {
    const row = rows.find((r) => r.key === writerSettingKey(w, o.demo)) ?? null
    out[w] = writerState(w, o.writers, readWriterSetting(row))
  }
  return out
}

export async function isArmed(svc: InpostModuleService, writer: WriterKey): Promise<boolean> {
  return (await writerStates(svc))[writer].armed
}

/* ------------------------------------------------------------------ */
/* The order                                                           */
/* ------------------------------------------------------------------ */

export interface OrderRecord extends PlanOrder {
  created_at?: string | Date | null
  shipping_methods?: Array<{ id: string; name?: string | null; data?: Record<string, unknown> | null; shipping_option_id?: string | null }> | null
  fulfillments?: Array<{
    id: string
    provider_id?: string | null
    data?: Record<string, unknown> | null
    canceled_at?: string | Date | null
    shipped_at?: string | Date | null
    delivered_at?: string | Date | null
    items?: Array<{ line_item_id: string; quantity: unknown }> | null
  }> | null
}

export async function loadOrder(scope: Scope, orderId: string): Promise<OrderRecord | null> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: [...PLAN_ORDER_FIELDS], filters: { id: orderId } })
  return (data[0] as OrderRecord | undefined) ?? null
}

/** Fulfillment providers of this plugin: `inpost_<id>` (the identifier is "inpost"). */
export function isInpostProvider(providerId: string | null | undefined): boolean {
  return typeof providerId === "string" && /^inpost_/.test(providerId)
}

/* ------------------------------------------------------------------ */
/* Who did it                                                          */
/* ------------------------------------------------------------------ */

/** E-mails of admin users by id, for the history and the writers ("system" and unknown ids stay as they are). Never throws. */
export async function actorNames(scope: Scope, ids: ReadonlyArray<string | null | undefined>): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id) && /^user_/.test(id as string)))]
  const out: Record<string, string> = {}
  if (wanted.length === 0) return out
  try {
    const users = resolveOptional<{ listUsers(f: Record<string, unknown>, c?: Record<string, unknown>): Promise<Array<{ id: string; email?: string | null }>> }>(scope, Modules.USER)
    if (!users) return out
    const rows = await users.listUsers({ id: wanted }, { select: ["id", "email"], take: wanted.length })
    for (const u of rows) if (u?.id && u.email) out[u.id] = u.email
  } catch {
    /* names are a courtesy */
  }
  return out
}

/** A refusal of an admin action, with the HTTP status the route answers. */
export class ActionError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "ActionError"
    this.status = status
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Events and history                                                  */
/* ------------------------------------------------------------------ */

/** Emits a plugin event. A courtesy for subscribers, never a reason to fail a flow. */
export async function emitEvent(scope: Scope, name: string, data: Record<string, unknown>): Promise<void> {
  try {
    const bus = resolve<IEventBusModuleService>(scope, Modules.EVENT_BUS)
    await bus.emit({ name, data })
  } catch (err) {
    inpostService(scope).getLogger().warn(`[inpost] Could not emit ${name}: ${(err as Error)?.message ?? String(err)}`)
  }
}

/** A history row, masked. Never throws: the history is a record, not a condition. */
export async function recordEvent(scope: Scope, event: NewEvent): Promise<EventRow | null> {
  const svc = inpostService(scope)
  try {
    return await storeFor(scope).insertEvent({ ...event, message: event.message ? svc.mask(event.message) : event.message })
  } catch (err) {
    svc.getLogger().warn(`[inpost] Could not record a history row: ${svc.mask((err as Error)?.message ?? String(err))}`)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* One pass of each kind at a time per process                         */
/* ------------------------------------------------------------------ */

const RUNNING_KEY = Symbol.for("koda.inpost.running")
type Holder = typeof globalThis & { [RUNNING_KEY]?: Set<string> }

function runningSet(): Set<string> {
  const holder = globalThis as Holder
  if (!holder[RUNNING_KEY]) holder[RUNNING_KEY] = new Set<string>()
  return holder[RUNNING_KEY] as Set<string>
}

export function isRunning(kind: string): boolean {
  return runningSet().has(kind)
}

/** Runs `fn` unless the same kind already runs in this process; then returns null. */
export async function exclusive<T>(kind: string, fn: () => Promise<T>): Promise<T | null> {
  const set = runningSet()
  if (set.has(kind)) return null
  set.add(kind)
  try {
    return await fn()
  } finally {
    set.delete(kind)
  }
}

/** Runs `fn` in the background; a failure is logged (masked), never thrown. */
export function inBackground(scope: Scope, label: string, fn: () => Promise<unknown>): void {
  setImmediate(() => {
    void Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        const svc = inpostService(scope)
        svc.getLogger().error(`[inpost] ${label}: ${svc.mask((err as Error)?.message ?? String(err))}`)
      })
  })
}
