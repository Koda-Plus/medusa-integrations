/**
 * Shared plumbing of the e-mail flows: the module service, Query, the send
 * log store, the settings, the notification module and the names of admin
 * users. Everything here calls the generated service methods or the shared
 * database connection from the outside; the service itself stays thin.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, generateEntityId } from "@medusajs/framework/utils"
import type EmailsModuleService from "../../modules/emails/service"
import { EMAILS_MODULE } from "../../modules/emails/lib/constants"
import { listTemplates, resolveTemplate } from "../../modules/emails/lib/registry"
import { cachedSettings, templateState, type EffectiveSettings, type TemplateState } from "../../modules/emails/lib/settings"
import { createSqlStore, type MessageStore, type SqlRunner } from "../../modules/emails/lib/store"

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

export function emailsService(scope: Scope): EmailsModuleService {
  return resolve<EmailsModuleService>(scope, EMAILS_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return resolve<QueryLike>(scope, ContainerRegistrationKeys.QUERY)
}

/**
 * One record through Query. `optional` fields (newer Medusa columns such as
 * `locale` and `custom_display_id`) are asked for first; when Query refuses
 * them (an older Medusa), the read is repeated without them.
 */
export async function graphOne<T>(scope: Scope, entity: string, fields: readonly string[], optional: readonly string[], filters: Record<string, unknown>): Promise<T | null> {
  const query = queryOf(scope)
  try {
    const { data } = await query.graph({ entity, fields: [...fields, ...optional], filters })
    return (data[0] as T | undefined) ?? null
  } catch (err) {
    if (optional.length === 0) throw err
    const { data } = await query.graph({ entity, fields: [...fields], filters })
    return (data[0] as T | undefined) ?? null
  }
}

export async function graphList<T>(
  scope: Scope,
  entity: string,
  fields: readonly string[],
  optional: readonly string[],
  filters: Record<string, unknown>,
  pagination: Record<string, unknown>,
): Promise<T[]> {
  const query = queryOf(scope)
  try {
    const { data } = await query.graph({ entity, fields: [...fields, ...optional], filters, pagination })
    return data as T[]
  } catch (err) {
    if (optional.length === 0) throw err
    const { data } = await query.graph({ entity, fields: [...fields], filters, pagination })
    return data as T[]
  }
}

/** Container key a custom (or test) implementation of the store may be registered under. */
export const STORE_KEY = "emailsMessageStore"

/** The send log store: SQL on Medusa's own connection, unless a store is registered. */
export function storeFor(scope: Scope): MessageStore {
  const registered = resolveOptional<MessageStore>(scope, STORE_KEY)
  if (registered) return registered
  const sql = resolve<SqlRunner>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  return createSqlStore({ sql, newId: (prefix) => generateEntityId(undefined, prefix) })
}

/** The admin's settings of the current mode, cached for 10 seconds per process. */
export async function settingsFor(scope: Scope): Promise<EffectiveSettings> {
  const svc = emailsService(scope)
  return cachedSettings(svc.isDemo(), () => storeFor(scope).settings())
}

/** The state of one template: allowed by the options, switched on, sending. Null for an unknown key. */
export async function templateStateOf(scope: Scope, key: string): Promise<(TemplateState & { key: string }) | null> {
  const svc = emailsService(scope)
  const o = svc.getOptions()
  const t = resolveTemplate(key, o)
  if (!t) return null
  const settings = await settingsFor(scope)
  return { key, ...templateState(key, t.def.enabledByDefault !== false, o, settings) }
}

export async function templateStates(scope: Scope): Promise<Record<string, TemplateState>> {
  const svc = emailsService(scope)
  const o = svc.getOptions()
  const settings = await settingsFor(scope)
  const out: Record<string, TemplateState> = {}
  for (const t of listTemplates(o)) out[t.key] = templateState(t.key, t.def.enabledByDefault !== false, o, settings)
  return out
}

export interface NotificationModuleLike {
  createNotifications(data: Record<string, unknown>): Promise<unknown>
}

export function notificationModule(scope: Scope): NotificationModuleLike | null {
  return resolveOptional<NotificationModuleLike>(scope, Modules.NOTIFICATION)
}

/**
 * Who did something, for the admin: the e-mail of an admin user (the user
 * module of Medusa, read from outside). Unknown ids stay ids. Never throws.
 */
export async function actorNames(scope: Scope, ids: ReadonlyArray<string | null | undefined>): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id) && id !== "system"))]
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

/** The config module's admin address (`admin.backendUrl` + `admin.path`), for admin password resets. */
export function adminBaseUrl(scope: Scope): string | null {
  const config = resolveOptional<{ admin?: { backendUrl?: string; path?: string } }>(scope, ContainerRegistrationKeys.CONFIG_MODULE)
  const backend = String(config?.admin?.backendUrl ?? "").trim().replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(backend)) return null
  const path = String(config?.admin?.path ?? "/app").trim() || "/app"
  return `${backend}${path.startsWith("/") ? path : `/${path}`}`.replace(/\/+$/, "")
}

/**
 * The reset page for admin users: `links.adminPasswordReset` (or `adminUrl`)
 * from the options, else the admin of this Medusa, from `admin.backendUrl`.
 */
export function adminResetLink(scope: Scope, links: { adminPasswordReset: string | null }): string | null {
  if (links.adminPasswordReset) return links.adminPasswordReset
  const base = adminBaseUrl(scope)
  return base ? `${base}/reset-password?token={token}&email={email}` : null
}

/** Runs `fn` unless the same job already runs in this process; then returns null. */
const RUNNING_KEY = Symbol.for("koda.emails.running")
export async function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const holder = globalThis as typeof globalThis & { [RUNNING_KEY]?: Set<string> }
  if (!holder[RUNNING_KEY]) holder[RUNNING_KEY] = new Set()
  const running = holder[RUNNING_KEY] as Set<string>
  if (running.has(name)) return null
  running.add(name)
  try {
    return await fn()
  } finally {
    running.delete(name)
  }
}
