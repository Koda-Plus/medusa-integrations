/**
 * Shared plumbing of the DPD flows: the module service, the DPDServices
 * client, the atomic store, the settings and writers of the current mode,
 * the order as the flows read it, history rows, who did it, one pass at a
 * time and work in the background. Everything here calls the generated
 * service methods from the outside; the service itself stays thin.
 *
 * The client is the one door to DPD: a client registered under CLIENT_KEY
 * (tests, custom code), else the simulated client of demo mode, else the
 * REST client of the sandbox or live host. Without credentials there is no
 * client and nothing is sent.
 *
 * The points source is the one door to DPD Pickup points: a source
 * registered under POINTS_KEY (tests, custom code), else the source of the
 * mode (lib/points.ts: MyPudo live, the catalogs of sandbox and demo).
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateEntityId } from "@medusajs/framework/utils"
import type DpdModuleService from "../../modules/dpd/service"
import { DPD_MODULE } from "../../modules/dpd/lib/constants"
import type { FieldErrorDto, ProblemDto } from "../../modules/dpd/lib/contract"
import { createDpdServicesClient, type DpdServicesClient } from "../../modules/dpd/lib/dpdservices"
import { waybillsOf, type EventRow, type SettingRow, type ShipmentRow } from "../../modules/dpd/lib/dto"
import { canCallDpd, dpdServicesHost } from "../../modules/dpd/lib/options"
import { PLAN_ORDER_FIELDS, type PlanOrder } from "../../modules/dpd/lib/plan"
import { createPointsSource, type PointsSource } from "../../modules/dpd/lib/points"
import { effectiveSettings, readStoredSettings, settingsKey, type EffectiveSettings } from "../../modules/dpd/lib/settings"
import { createSqlStore, type DpdStore, type NewEvent, type SqlRunner } from "../../modules/dpd/lib/store"
import { readWriterSetting, WRITER_OPTION, WRITERS, writerSettingKey, writerState, type WriterKey, type WriterState } from "../../modules/dpd/lib/writers"
import { createDemoDpdServicesClient } from "./demo-client"

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

/** The message of anything thrown, masked. */
export function errorText(svc: DpdModuleService, err: unknown): string {
  return svc.mask((err as Error)?.message ?? String(err))
}

/* ------------------------------------------------------------------ */
/* The DPDServices client: one per service instance                    */
/* ------------------------------------------------------------------ */

/** Container key of a custom (or test) DPDServices client. */
export const CLIENT_KEY = "dpdServicesClient"

const clients = new WeakMap<object, DpdServicesClient>()

/** The registered client, else the demo client (demo mode), else a real client for sandbox or live (one per service instance, WeakMap); null when not configured. */
export function clientFor(scope: Scope): DpdServicesClient | null {
  const registered = resolveOptional<DpdServicesClient>(scope, CLIENT_KEY)
  if (registered) return registered
  const svc = dpdService(scope)
  const known = clients.get(svc)
  if (known) return known
  const o = svc.getOptions()
  let client: DpdServicesClient | null = null
  if (o.demo) {
    client = createDemoDpdServicesClient()
  } else {
    const host = dpdServicesHost(o)
    if (!canCallDpd(o) || !host || o.masterFid === null) return null
    const logger = svc.getLogger()
    client = createDpdServicesClient({
      host,
      login: o.login,
      password: o.password,
      masterFid: o.masterFid,
      timeoutMs: o.timeoutMs,
      requestsPerMinute: o.requestsPerMinute,
      logger: { info: (m) => logger.info(svc.mask(m)), warn: (m) => logger.warn(svc.mask(m)), error: (m) => logger.error(svc.mask(m)) },
    })
  }
  clients.set(svc, client)
  return client
}

/* ------------------------------------------------------------------ */
/* The points source: one per service instance                         */
/* ------------------------------------------------------------------ */

/** Tests register a PointsSource under this key (like CLIENT_KEY). */
export const POINTS_KEY = "dpdPointsSource"

const sources = new WeakMap<object, PointsSource>()

/** The registered source, else createPointsSource of the options (one per service instance, WeakMap, like clientFor). */
export function pointsFor(scope: Scope): PointsSource {
  const registered = resolveOptional<PointsSource>(scope, POINTS_KEY)
  if (registered) return registered
  const svc = dpdService(scope)
  const known = sources.get(svc)
  if (known) return known
  const logger = svc.getLogger()
  const source = createPointsSource(svc.getOptions(), {
    logger: { info: (m) => logger.info(svc.mask(m)), warn: (m) => logger.warn(svc.mask(m)), error: (m) => logger.error(svc.mask(m)) },
  })
  sources.set(svc, source)
  return source
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

/** The row of the current mode, or null (a demo row never answers a sandbox request, and the other way round). */
export async function getShipmentOfMode(svc: DpdModuleService, id: string): Promise<ShipmentRow | null> {
  const [row] = await listShipments(svc, { id }, { take: 1 })
  return row && row.mode === svc.mode() ? row : null
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

/**
 * Refuses a write the writers do not allow: 409 writer_off (the option),
 * 409 not_armed (the toggle in Settings), 409 not_configured (sandbox or
 * live without credentials, for the writers that call DPD).
 */
export async function requireArmed(scope: Scope, writer: WriterKey): Promise<void> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  if (!o.writers[writer]) {
    throw new ActionError(409, "writer_off", `This write is turned off in the plugin options (${WRITER_OPTION[writer]} is not true); the admin cannot turn it on.`)
  }
  if (!(await isArmed(svc, writer))) throw new ActionError(409, "not_armed", "Arm the writer in Settings first (DPD, Settings, Writers).")
  if (writer !== "fulfillmentStatus" && !o.demo && !canCallDpd(o)) {
    throw new ActionError(409, "not_configured", `DPD is not configured: ${svc.missingOptions().join(", ")}.`)
  }
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
  location_id?: string | null
  data?: Record<string, unknown> | null
  canceled_at?: string | Date | null
  shipped_at?: string | Date | null
  delivered_at?: string | Date | null
  items?: Array<{ line_item_id: string; quantity: unknown }> | null
}

/**
 * The order as the flows read it: what the recording checks and what a plan
 * needs. The receiver's name, street, phone and e-mail are read for the plan
 * and the request to DPD only; none of them is ever written to a row, a
 * document list or the history.
 */
export type OrderRecord = PlanOrder & {
  created_at?: string | Date | null
  shipping_methods?: ShippingMethodRecord[] | null
  fulfillments?: FulfillmentRecord[] | null
}

const STAGE1_ORDER_FIELDS = [
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
]

/** What the recording and the plan read of an order (Query fields). `summary` is the order module's own field: it becomes order.summary with the totals. */
export const ORDER_FIELDS: readonly string[] = [...new Set([...STAGE1_ORDER_FIELDS, ...PLAN_ORDER_FIELDS, "summary"])]

/** Fields without the totals, for an order Medusa cannot total. */
const FIELDS_WITHOUT_TOTALS: readonly string[] = ORDER_FIELDS.filter((f) => f !== "total" && f !== "summary" && !f.startsWith("summary."))

export async function loadOrder(scope: Scope, orderId: string): Promise<OrderRecord | null> {
  try {
    const { data } = await queryOf(scope).graph({ entity: "order", fields: [...ORDER_FIELDS], filters: { id: orderId } })
    return (data[0] as OrderRecord | undefined) ?? null
  } catch (err) {
    /* Medusa cannot compute the totals of an order whose shipping method has no version (some
       orders imported by other plugins): read it without them. A plan without a total cannot
       send cash on delivery and says so; every other shipment plans as usual. */
    const { data } = await queryOf(scope)
      .graph({ entity: "order", fields: [...FIELDS_WITHOUT_TOTALS], filters: { id: orderId } })
      .catch(() => {
        throw err
      })
    return (data[0] as OrderRecord | undefined) ?? null
  }
}

/* ------------------------------------------------------------------ */
/* The Medusa fulfillment                                              */
/* ------------------------------------------------------------------ */

type FulfillmentModuleLike = {
  retrieveFulfillment(id: string, config?: Record<string, unknown>): Promise<{ id: string; data?: Record<string, unknown> | null }>
  updateFulfillment(id: string, data: Record<string, unknown>): Promise<unknown>
}

/**
 * fulfillment.data gets dpd_shipment_id and dpd_waybills (live and sandbox
 * rows only), merged into what is there (the provider's dpd_option and the
 * rest stay). Custom code and the provider find the shipment there. Never
 * throws; skipped when the fulfillment module is not registered.
 */
export async function annotateFulfillment(scope: Scope, row: ShipmentRow): Promise<void> {
  const waybills = waybillsOf(row.waybills)
  if (!row.fulfillment_id || row.mode === "demo" || waybills.length === 0) return
  const svc = dpdService(scope)
  try {
    const fulfillment = resolveOptional<FulfillmentModuleLike>(scope, Modules.FULFILLMENT)
    if (!fulfillment) return
    const current = await fulfillment.retrieveFulfillment(row.fulfillment_id, { select: ["id", "data"] })
    const data = current?.data && typeof current.data === "object" ? current.data : {}
    const same = data.dpd_shipment_id === row.id && JSON.stringify(data.dpd_waybills ?? null) === JSON.stringify(waybills)
    if (same) return
    await fulfillment.updateFulfillment(row.fulfillment_id, { data: { ...data, dpd_shipment_id: row.id, dpd_waybills: waybills } })
  } catch (err) {
    svc.getLogger().warn(`[dpd] Could not note the shipment on fulfillment ${row.fulfillment_id}: ${errorText(svc, err)}`)
  }
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
  /** The wrong fields of an invalid request (ErrorResponse.fields), when it has them. */
  readonly fields: FieldErrorDto[] | undefined
  /** point_refused: the problems of the chosen point (ErrorResponse.problems). */
  readonly problems: ProblemDto[] | undefined
  /** Seconds for the Retry-After header (a busy point search). */
  readonly retryAfter: number | undefined
  constructor(status: number, code: string, message: string, fields?: FieldErrorDto[], problems?: ProblemDto[], retryAfter?: number) {
    super(message)
    this.name = "ActionError"
    this.status = status
    this.code = code
    this.fields = fields
    this.problems = problems
    this.retryAfter = retryAfter
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
    svc.getLogger().warn(`[dpd] Could not record a history row: ${errorText(svc, err)}`)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* One run of each kind at a time per process, work in the background  */
/* ------------------------------------------------------------------ */

const RUNNING_KEY = Symbol.for("koda.dpd.running")
type Holder = typeof globalThis & { [RUNNING_KEY]?: Set<string> }

function runningSet(): Set<string> {
  const holder = globalThis as Holder
  if (!holder[RUNNING_KEY]) holder[RUNNING_KEY] = new Set<string>()
  return holder[RUNNING_KEY] as Set<string>
}

/** One run per key per process; null when one is running. */
export async function exclusive<T>(key: string, work: () => Promise<T>): Promise<T | null> {
  const set = runningSet()
  if (set.has(key)) return null
  set.add(key)
  try {
    return await work()
  } finally {
    set.delete(key)
  }
}

/** setImmediate, logs masked, never throws. */
export function inBackground(scope: Scope, label: string, work: () => Promise<unknown>): void {
  setImmediate(() => {
    void Promise.resolve()
      .then(work)
      .catch((err: unknown) => {
        try {
          const svc = dpdService(scope)
          svc.getLogger().error(`[dpd] ${label}: ${errorText(svc, err)}`)
        } catch {
          /* no logger: nothing more to do */
        }
      })
  })
}
