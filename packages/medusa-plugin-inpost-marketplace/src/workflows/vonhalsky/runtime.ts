import { createLiveClient, maskSecrets, type MarketplaceClient } from "../../modules/vonhalsky/lib/client"
import { createDemoClient, type DemoClient } from "../../modules/vonhalsky/lib/demo"
import { VonHalskyFlowError } from "../../modules/vonhalsky/lib/errors"
import { resolveOptions, type ResolvedVonHalskyOptions } from "../../modules/vonhalsky/lib/options"
import { vonHalskySvc, type Scope } from "../../modules/vonhalsky/lib/store"

/**
 * What the flows and routes share: the module service, the options and ONE
 * marketplace client per process. Demo mode gets the in-memory client, which
 * never calls fetch; sandbox and live get the pending client, which refuses
 * politely.
 */

export { VonHalskyFlowError }

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return scope.resolve("query") as QueryLike
}

export function optionsOf(scope: Scope): ResolvedVonHalskyOptions {
  try {
    return vonHalskySvc(scope).getOptions() as ResolvedVonHalskyOptions
  } catch {
    return resolveOptions({})
  }
}

export function loggerOf(scope: Scope): { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void } {
  try {
    return scope.resolve("logger") as any
  } catch {
    return console
  }
}

let client: { key: string; value: MarketplaceClient } | null = null

/** The marketplace client of the mode; null when the plugin is not configured. */
export function clientOf(scope: Scope): MarketplaceClient | null {
  const o = optionsOf(scope)
  if (o.mode === "off") return null
  const key = `${o.mode}|${o.credentials.apiUrl}|${o.credentials.organizationId}`
  if (client && client.key === key) return client.value
  const value: MarketplaceClient =
    o.mode === "demo" ? createDemoClient() : createLiveClient({ mode: o.mode, apiUrl: o.credentials.apiUrl, organizationId: o.credentials.organizationId, accessToken: o.credentials.accessToken })
  client = { key, value }
  return value
}

/** The demo client, when the plugin runs in demo mode. */
export function demoClientOf(scope: Scope): DemoClient | null {
  const c = clientOf(scope)
  return c && c.mode === "demo" ? (c as DemoClient) : null
}

/** The client, or a polite refusal when the plugin is not configured. */
export function requireClient(scope: Scope): MarketplaceClient {
  const c = clientOf(scope)
  if (!c) throw new VonHalskyFlowError(409, "not_configured", "InPost Von Halsky is not configured: set the credentials or demo: true.")
  return c
}

/** One flow per key at a time in this process (one order, one offer batch): a second call waits for the first and then sees its result. */
const locks = new Map<string, Promise<unknown>>()

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((r) => (release = r))
  const chained = previous.then(() => mine)
  locks.set(key, chained)
  try {
    await previous.catch(() => undefined)
    return await fn()
  } finally {
    release()
    if (locks.get(key) === chained) locks.delete(key)
  }
}

/** The message of an error, with the access token and any bearer value masked, for rows and logs. */
export function errorText(err: unknown, scope?: Scope): string {
  const secrets = scope ? [optionsOf(scope).credentials.accessToken] : []
  /* Workflows may throw plain objects ({ message, type }) instead of Error instances. */
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : typeof err === "string"
          ? err
          : (() => {
              try {
                return JSON.stringify(err)
              } catch {
                return String(err)
              }
            })()
  return maskSecrets(message, secrets)
}
