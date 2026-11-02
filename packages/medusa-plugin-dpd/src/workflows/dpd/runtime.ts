/**
 * Shared plumbing of the DPD flows: the module service, the atomic store,
 * the settings and writers of the current mode, the order as the flows read
 * it, history rows, who did it. Everything here calls the generated service
 * methods from the outside; the service itself stays thin.
 *
 * Stage 1 talks to nobody: there is no DPD client here yet. The REST, SOAP
 * and MyPudo clients come with the stages that use them.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateEntityId } from "@medusajs/framework/utils"
import type DpdModuleService from "../../modules/dpd/service"
import { DPD_MODULE } from "../../modules/dpd/lib/constants"
import type { EventRow, SettingRow, ShipmentRow } from "../../modules/dpd/lib/dto"
import { effectiveSettings, readStoredSettings, settingsKey, type EffectiveSettings } from "../../modules/dpd/lib/settings"
import { createSqlStore, type DpdStore, type NewEvent, type SqlRunner } from "../../modules/dpd/lib/store"
import { readWriterSetting, WRITERS, writerSettingKey, writerState, type WriterKey, type WriterState } from "../../modules/dpd/lib/writers"

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

export function dpdService(scope: Scope): DpdModuleService {
  return resolve<DpdModuleService>(scope, DPD_MODULE)
}

export type QueryLike = {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return resolve<QueryLike>(scope, ContainerRegistrationKeys.QUERY)
}

/* ------------------------------------------------------------------ */
/* The atomic store                                                    */
/* ------------------------------------------------------------------ */

/** Container key a custom (or test) implementation of the store may be registered under. */
export const STORE_KEY = "dpdShipmentStore"

export function storeFor(scope: Scope): DpdStore {
  const registered = resolveOptional<DpdStore>(scope, STORE_KEY)
  if (registered) return registered
  const sql = resolve<SqlRunner>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  return createSqlStore({ sql, newId: (prefix) => generateEntityId(undefined, prefix) })
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export async function listShipments(svc: DpdModuleService, filters: Record<string, unknown>, config: Record<string, unknown> = {}): Promise<ShipmentRow[]> {
  return (await svc.listDpdShipments(filters as never, config as never)) as unknown as ShipmentRow[]
}

export async function listEvents(svc: DpdModuleService, filters: Record<string, unknown>, config: Record<string, unknown> = {}): Promise<EventRow[]> {
  return (await svc.listDpdEvents(filters as never, config as never)) as unknown as EventRow[]
}

export async function getSetting(svc: DpdModuleService, key: string): Promise<SettingRow | null> {
  const rows = (await svc.listDpdSettings({ key } as never, { take: 1 } as never)) as unknown as SettingRow[]
  return rows[0] ?? null
}

/** The settings in force for the current mode. */
export async function settingsOf(svc: DpdModuleService): Promise<EffectiveSettings> {
  const row = await getSetting(svc, settingsKey(svc.mode()))
  return effectiveSettings(svc.getOptions(), readStoredSettings(row?.value))
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

export async function writerStates(svc: DpdModuleService): Promise<Record<WriterKey, WriterState>> {
  const o = svc.getOptions()
  const mode = svc.mode()
  const keys = WRITERS.map((w) => writerSettingKey(w, mode))
  const rows = (await svc.listDpdSettings({ key: keys } as never, { take: keys.length } as never)) as unknown as SettingRow[]
  const out = {} as Record<WriterKey, WriterState>
  for (const w of WRITERS) {
    const row = rows.find((r) => r.key === writerSettingKey(w, mode)) ?? null
    out[w] = writerState(w, o.writers, readWriterSetting(row))
  }
  return out
}

export async function isArmed(svc: DpdModuleService, writer: WriterKey): Promise<boolean> {
  return (await writerStates(svc))[writer].armed
}

/* ------------------------------------------------------------------ */
/* The order                                                           */
/* ------------------------------------------------------------------ */

export type ShippingMethodRecord = {
  id: string
  name?: string | null
  data?: Record<string, unknown> | null
  shipping_option_id?: string | null
}

export type FulfillmentRecord = {
  id: string
  provider_id?: string | null
  shipping_option_id?: string | null
  data?: Record<string, unknown> | null
  canceled_at?: string | Date | null
}

/**
 * The order as the recording reads it. The street, the city, the postal
 * code, the phone and the e-mail are read only to run the checks of the
 * checkout again (is there an address, a contact for the Pickup point); no
 * name is read, and none of them is ever written to a row.
 */
export type OrderRecord = {
  id: string
  display_id?: number | null
  currency_code?: string | null
  email?: string | null
  created_at?: string | Date | null
  shipping_address?: {
    address_1?: string | null
    address_2?: string | null
    city?: string | null
    postal_code?: string | null
    country_code?: string | null
    phone?: string | null
  } | null
  shipping_methods?: ShippingMethodRecord[] | null
  fulfillments?: FulfillmentRecord[] | null
}

export const ORDER_FIELDS = [
  "id",
  "display_id",
  "currency_code",
  "email",
  "created_at",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.city",
  "shipping_address.postal_code",
  "shipping_address.country_code",
  "shipping_address.phone",
  "shipping_methods.id",
  "shipping_methods.name",
  "shipping_methods.data",
  "shipping_methods.shipping_option_id",
  "fulfillments.id",
  "fulfillments.provider_id",
  "fulfillments.shipping_option_id",
  "fulfillments.data",
  "fulfillments.canceled_at",
] as const

export async function loadOrder(scope: Scope, orderId: string): Promise<OrderRecord | null> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: [...ORDER_FIELDS], filters: { id: orderId } })
  return (data[0] as OrderRecord | undefined) ?? null
}

/* ------------------------------------------------------------------ */
/* Who did it                                                          */
/* ------------------------------------------------------------------ */

/** E-mails of admin users by id, for the history and the writers ("system" and unknown ids stay as they are). Never throws. */
export async function actorNames(scope: Scope, ids: ReadonlyArray<string | null | undefined>): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string" && /^user_/.test(id)))]
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
/* History                                                             */
/* ------------------------------------------------------------------ */

/** A history row, masked. Never throws: the history is a record, not a condition. */
export async function recordEvent(scope: Scope, event: NewEvent): Promise<EventRow | null> {
  const svc = dpdService(scope)
  try {
    return await storeFor(scope).insertEvent({ ...event, message: event.message ? svc.mask(event.message) : event.message })
  } catch (err) {
    svc.getLogger().warn(`[dpd] Could not record a history row: ${svc.mask((err as Error)?.message ?? String(err))}`)
    return null
  }
}
