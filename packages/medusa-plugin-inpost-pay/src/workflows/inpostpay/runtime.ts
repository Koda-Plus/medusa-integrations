import { createBasketAppClient, type BasketAppClient } from "../../modules/inpostpay/lib/client"
import { createDemoBasketAppClient } from "../../modules/inpostpay/lib/demo"
import { resolveOptions, type ResolvedInpostPayOptions } from "../../modules/inpostpay/lib/options"
import { InpostPayFlowError } from "../../modules/inpostpay/lib/errors"
import { withKeyLock } from "../../modules/inpostpay/lib/lock"
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
  const key = `${o.mode}|${o.apiUrl}|${o.tokenUrl}|${o.clientId}|${o.merchantSecret ? "refunds" : ""}`
  if (client && client.key === key) return client.value
  const value =
    o.mode === "demo"
      ? createDemoBasketAppClient()
      : createBasketAppClient({ mode: o.mode, apiUrl: o.apiUrl, tokenUrl: o.tokenUrl, clientId: o.clientId, clientSecret: o.clientSecret, timeoutMs: o.timeoutMs, merchantSecret: o.merchantSecret })
  client = { key, value }
  return value
}

/** One flow per basket at a time in this process: a second confirm waits for the first and then sees its order. */
export function withBasketLock<T>(basketId: string, fn: () => Promise<T>): Promise<T> {
  return withKeyLock(basketId, fn)
}
