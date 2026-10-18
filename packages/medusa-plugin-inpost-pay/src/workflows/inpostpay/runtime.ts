import { createBasketAppClient, type BasketAppClient } from "../../modules/inpostpay/lib/client"
import { createDemoBasketAppClient } from "../../modules/inpostpay/lib/demo"
import { resolveOptions, type ResolvedInpostPayOptions } from "../../modules/inpostpay/lib/options"
import { InpostPayFlowError } from "../../modules/inpostpay/lib/errors"
import { inpostPaySvc, type Scope } from "../../modules/inpostpay/lib/store"

/**
 * What the flows and routes share: the module service, the options and ONE
 * Basket App client per process (the OAuth token is reused across
 * requests). Demo mode gets the in-memory client, which never calls fetch.
 */

export { InpostPayFlowError }

export function optionsOf(scope: Scope): ResolvedInpostPayOptions {
  try {
    return inpostPaySvc(scope).getOptions() as ResolvedInpostPayOptions
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

let client: { key: string; value: BasketAppClient } | null = null

/** The Basket App client of the mode; null when the plugin is not configured. */
export function clientOf(scope: Scope): BasketAppClient | null {
  const o = optionsOf(scope)
  if (o.mode === "off") return null
  const key = `${o.mode}|${o.apiUrl}|${o.tokenUrl}|${o.clientId}`
  if (client && client.key === key) return client.value
  const value =
    o.mode === "demo"
      ? createDemoBasketAppClient()
      : createBasketAppClient({ mode: o.mode, apiUrl: o.apiUrl, tokenUrl: o.tokenUrl, clientId: o.clientId, clientSecret: o.clientSecret, timeoutMs: o.timeoutMs })
  client = { key, value }
  return value
}

/** One flow per basket at a time in this process: a second confirm waits for the first and then sees its order. */
const locks = new Map<string, Promise<unknown>>()

export async function withBasketLock<T>(basketId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(basketId) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((r) => (release = r))
  const chained = previous.then(() => mine)
  locks.set(basketId, chained)
  try {
    await previous.catch(() => undefined)
    return await fn()
  } finally {
    release()
    if (locks.get(basketId) === chained) locks.delete(basketId)
  }
}
