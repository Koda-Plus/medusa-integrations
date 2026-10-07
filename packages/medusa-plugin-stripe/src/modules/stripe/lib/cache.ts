/**
 * A SHORT MEMORY FOR STRIPE READS. No runtime imports.
 *
 * Stripe allows each account about 500 read requests per payment over 30
 * days (at least 10 000 a month), shared with every other tool on the
 * account. A panel that re-read Stripe on every click would eat a small
 * store's allowance, so every read is kept for `cacheSeconds` (5 minutes by
 * default), per process:
 *
 *   - one load at a time per key: ten admins opening the page at once cause
 *     one read (single flight);
 *   - a forced refresh within 30 seconds of the last read is served from
 *     memory;
 *   - a failed read is remembered for a minute, so a wrong key does not
 *     hammer Stripe from every page view.
 */
import type { Clock } from "./rate-limit"

interface Entry<T> {
  value: T
  at: number
  error: boolean
}

export interface CacheHit<T> {
  value: T
  /** When the value was loaded (ms). */
  at: number
  /** Loaded for this call. */
  fresh: boolean
}

export class TtlCache {
  private readonly entries = new Map<string, Entry<unknown>>()
  private readonly loading = new Map<string, Promise<CacheHit<unknown>>>()
  private readonly now: () => number
  private readonly maxEntries: number

  /** `maxEntries` bounds the memory: the oldest entry goes first (order widgets add one key per payment). */
  constructor(clock?: Pick<Clock, "now">, maxEntries = 500) {
    this.now = clock ? () => clock.now() : () => Date.now()
    this.maxEntries = Math.max(1, maxEntries)
  }

  peek<T>(key: string): { value: T; at: number } | null {
    const e = this.entries.get(key)
    return e && !e.error ? { value: e.value as T, at: e.at } : null
  }

  /**
   * The cached value while younger than `ttlMs` (a failure: `errorTtlMs`),
   * otherwise one load shared by every caller. `force` reloads unless the
   * value is younger than `forceMinMs`. A load that throws is cached as a
   * failure only when `isFailure` says the result is one; thrown errors
   * propagate and are not cached.
   */
  async get<T>(
    key: string,
    load: () => Promise<T>,
    options: { ttlMs: number; force?: boolean; forceMinMs?: number; errorTtlMs?: number; isFailure?: (value: T) => boolean },
  ): Promise<CacheHit<T>> {
    const now = this.now()
    const entry = this.entries.get(key) as Entry<T> | undefined
    if (entry) {
      const age = now - entry.at
      const ttl = entry.error ? Math.min(options.ttlMs, options.errorTtlMs ?? options.ttlMs) : options.ttlMs
      const forced = options.force === true && age >= (options.forceMinMs ?? 0)
      if (age < ttl && !forced) return { value: entry.value, at: entry.at, fresh: false }
    }
    const pending = this.loading.get(key) as Promise<CacheHit<T>> | undefined
    if (pending) return pending
    const run = (async (): Promise<CacheHit<T>> => {
      try {
        const value = await load()
        const at = this.now()
        this.entries.delete(key)
        this.entries.set(key, { value, at, error: options.isFailure ? options.isFailure(value) : false })
        while (this.entries.size > this.maxEntries) {
          const oldest = this.entries.keys().next().value
          if (oldest === undefined) break
          this.entries.delete(oldest)
        }
        return { value, at, fresh: true }
      } finally {
        this.loading.delete(key)
      }
    })()
    this.loading.set(key, run as Promise<CacheHit<unknown>>)
    return run
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
