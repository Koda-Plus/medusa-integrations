/**
 * Shared plumbing of the Railway reads: the module service, one client and
 * one cache per service, and the cached read with a stale fallback.
 * Everything here works from the outside of the module; the service stays thin.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import type KodaRailwayModuleService from "../../modules/railway/service"
import { TtlCache } from "../../modules/railway/lib/cache"
import { RailwayReadClient } from "../../modules/railway/lib/client"
import { ERROR_CACHE_MS, FORCE_REFRESH_MIN_MS, MAX_REQUESTS_PER_HOUR, RAILWAY_MODULE } from "../../modules/railway/lib/constants"
import type { RateLimitDto, TokenKind } from "../../modules/railway/lib/contract"
import { demoFetch } from "../../modules/railway/lib/demo"
import { RailwayApiError, type RailwayErrorKind } from "../../modules/railway/lib/errors"

export type Scope = MedusaContainer | { resolve<T = unknown>(key: string, options?: { allowUnregistered?: boolean }): T }

export function resolveOptional<T>(scope: Scope, key: string): T | null {
  try {
    return ((scope as { resolve<R>(k: string, o?: { allowUnregistered?: boolean }): R }).resolve<T>(key, { allowUnregistered: true }) ?? null) as T | null
  } catch {
    return null
  }
}

export function railwayService(scope: Scope): KodaRailwayModuleService {
  return (scope as { resolve<R>(k: string): R }).resolve<KodaRailwayModuleService>(RAILWAY_MODULE)
}

/** Container key a custom (or test) client may be registered under. */
export const CLIENT_KEY = "kodaRailwayClient"

export interface ReadClient {
  query<T>(document: string, variables: Record<string, unknown>, kind: TokenKind): Promise<T>
  rateLimit?: RateLimitDto | null
  budget?: { used: number; limit: number }
}

const clients = new WeakMap<object, RailwayReadClient>()
const caches = new WeakMap<object, TtlCache>()

/** The Railway client of this store: a registered one first (tests), otherwise one per service; demo mode answers in-process. */
export function clientFor(scope: Scope, svc: KodaRailwayModuleService): ReadClient {
  const registered = resolveOptional<ReadClient>(scope, CLIENT_KEY)
  if (registered) return registered
  let client = clients.get(svc)
  if (!client) {
    const o = svc.getOptions()
    client = o.demo
      ? new RailwayReadClient({ token: "demo", fetch: demoFetch(), requestsPerSecond: 50, requestsPerHour: MAX_REQUESTS_PER_HOUR })
      : new RailwayReadClient({ token: o.token, requestsPerSecond: o.requestsPerSecond, requestsPerHour: o.requestsPerHour, timeoutMs: o.timeoutMs })
    clients.set(svc, client)
  }
  return client
}

export function cacheFor(svc: KodaRailwayModuleService): TtlCache {
  let cache = caches.get(svc)
  if (!cache) {
    cache = new TtlCache()
    caches.set(svc, cache)
  }
  return cache
}

/** Tests only: a cache with a clock of its own for this service. */
export function setCacheForTests(svc: KodaRailwayModuleService, cache: TtlCache): void {
  caches.set(svc, cache)
}

type Outcome<T> = { ok: true; value: T } | { ok: false; kind: RailwayErrorKind | "unknown"; message: string; status: number | null }

export interface CachedRead<T> {
  value: T
  at: number
  fresh: boolean
  /** Railway failed: this is the last good value. */
  stale: boolean
}

/**
 * A read through the cache: kept `ttlMs`, one load per key at a time, a
 * forced reload honoured once the value is 15 seconds old, a failure
 * remembered a minute. When the load fails and an older good value exists,
 * that one is served with `stale`; otherwise the error is thrown (masked).
 */
export async function cachedRead<T>(svc: KodaRailwayModuleService, key: string, ttlMs: number, force: boolean, load: () => Promise<T>): Promise<CachedRead<T>> {
  const cache = cacheFor(svc)
  const hit = await cache.get<Outcome<T>>(
    key,
    async () => {
      try {
        return { ok: true, value: await load() }
      } catch (err) {
        const message = svc.mask(err instanceof Error ? err.message : String(err))
        if (err instanceof RailwayApiError) return { ok: false, kind: err.kind, message, status: err.status }
        return { ok: false, kind: "unknown", message, status: null }
      }
    },
    { ttlMs, force, forceMinMs: FORCE_REFRESH_MIN_MS, errorTtlMs: ERROR_CACHE_MS, isFailure: (v) => !v.ok },
  )
  if (hit.value.ok) return { value: hit.value.value, at: hit.at, fresh: hit.fresh, stale: false }
  const good = cache.good<Outcome<T>>(key)
  if (good && good.value.ok) return { value: good.value.value, at: good.at, fresh: false, stale: true }
  const failure = hit.value
  if (failure.kind === "unknown") throw new Error(failure.message)
  throw new RailwayApiError({ kind: failure.kind, message: failure.message, status: failure.status })
}

/** The last good value of a key, with its time, whatever its age. */
export function peekGood<T>(svc: KodaRailwayModuleService, key: string): { value: T; at: number } | null {
  const good = cacheFor(svc).good<Outcome<T>>(key)
  return good && good.value.ok ? { value: good.value.value, at: good.at } : null
}
