/**
 * A SLIDING WINDOW RATE LIMIT PER KEY, IN MEMORY. Zero imports.
 *
 * For the storefront routes of a logged-in customer: a customer may list the
 * documents of an order 30 times a minute and download 10 PDFs a minute (a
 * PDF costs a request to Fakturownia). Per process: behind several Medusa
 * instances each one counts on its own, which still bounds what one customer
 * can make the store ask of Fakturownia. The map forgets idle keys and never
 * grows beyond `maxKeys`.
 */

export interface RateLimiter {
  /** Counts a hit; `ok: false` with the seconds to wait when the window is full. */
  hit(key: string, now?: number): { ok: boolean; retryAfterSeconds: number; remaining: number }
  size(): number
}

export function createRateLimiter(args: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>()
  const maxKeys = args.maxKeys ?? 10_000
  return {
    hit(key, now = Date.now()) {
      const since = now - args.windowMs
      const list = (hits.get(key) ?? []).filter((t) => t > since)
      if (list.length >= args.limit) {
        hits.set(key, list)
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((list[0] + args.windowMs - now) / 1000)), remaining: 0 }
      }
      list.push(now)
      hits.delete(key)
      hits.set(key, list)
      if (hits.size > maxKeys) {
        /* The oldest keys first (a Map keeps insertion order, and a hit moves its key to the end). */
        for (const k of hits.keys()) {
          if (hits.size <= maxKeys) break
          hits.delete(k)
        }
      }
      return { ok: true, retryAfterSeconds: 0, remaining: args.limit - list.length }
    },
    size() {
      return hits.size
    },
  }
}

const LIMITERS_KEY = Symbol.for("koda.fakturownia.storeLimiters")

/** One limiter per name for the whole process (route modules may load more than once). */
export function sharedLimiter(name: string, limit: number, windowMs = 60_000): RateLimiter {
  const holder = globalThis as typeof globalThis & { [LIMITERS_KEY]?: Map<string, RateLimiter> }
  if (!holder[LIMITERS_KEY]) holder[LIMITERS_KEY] = new Map()
  const map = holder[LIMITERS_KEY] as Map<string, RateLimiter>
  let limiter = map.get(name)
  if (!limiter) {
    limiter = createRateLimiter({ limit, windowMs })
    map.set(name, limiter)
  }
  return limiter
}
