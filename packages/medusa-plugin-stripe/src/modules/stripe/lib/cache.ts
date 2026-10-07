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
 *     hammer Stripe from every page view, and the last good value stays
 *     next to it (`good`), so an answer can say "stale" instead of nothing;
 *   - keys live in spaces (the text before the first ":"), each with its own
 *     bound: the order widgets add one key per payment and can never push
 *     the snapshot or the checks out. Entries long past their time are swept
 *     on every write.
 */
import type { Clock } from "./rate-limit"

interface Entry<T> {
  value: T
  at: number
  error: boolean
  ttlMs: number
  /** The last value that was not a failure, kept when a reload failed. */
  good: { value: T; at: number } | null
}

export interface CacheHit<T> {
  value: T
  /** When the value was loaded (ms). */
  at: number
  /** Loaded for this call. */
  fresh: boolean
}

/** Spaces with a bound of their own: a handful of whole reads, never pushed out by the per-payment keys. */
export const SPACE_LIMITS: Readonly<Record<string, number>> = { snapshot: 8, checks: 8, disputes: 8 }

/** How long a value is kept past its time, for a stale answer while Stripe does not answer. */
export const KEEP_STALE_MS = 6 * 60 * 60 * 1000

const spaceOf = (key: string): string => {
  const i = key.indexOf(":")
  return i > 0 ? key.slice(0, i) : ""
}

export class TtlCache {
  private readonly spaces = new Map<string, Map<string, Entry<unknown>>>()
  private readonly loading = new Map<string, Promise<CacheHit<unknown>>>()
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly limits: Readonly<Record<string, number>>
  private readonly keepStaleMs: number

  /** `maxEntries` bounds every space without a limit of its own (order widgets add one key per payment): the oldest entry goes first. */
  constructor(clock?: Pick<Clock, "now">, maxEntries = 500, limits: Readonly<Record<string, number>> = SPACE_LIMITS, keepStaleMs = KEEP_STALE_MS) {
    this.now = clock ? () => clock.now() : () => Date.now()
    this.maxEntries = Math.max(1, maxEntries)
    this.limits = limits
    this.keepStaleMs = Math.max(0, keepStaleMs)
  }

  private space(key: string): Map<string, Entry<unknown>> {
    const name = spaceOf(key)
    let s = this.spaces.get(name)
    if (!s) {
      s = new Map()
      this.spaces.set(name, s)
    }
    return s
  }

  private entry<T>(key: string): Entry<T> | undefined {
    return this.spaces.get(spaceOf(key))?.get(key) as Entry<T> | undefined
  }

  /** The value of the last read that did not fail, whatever its age. */
  peek<T>(key: string): { value: T; at: number } | null {
    const e = this.entry<T>(key)
    return e && !e.error ? { value: e.value, at: e.at } : null
  }

  /** The last good value, also when the newest read failed (then it is the one before). */
  good<T>(key: string): { value: T; at: number } | null {
    const e = this.entry<T>(key)
    if (!e) return null
    return e.error ? e.good : { value: e.value, at: e.at }
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
    const entry = this.entry<T>(key)
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
        const error = options.isFailure ? options.isFailure(value) : false
        const space = this.space(key)
        const previous = space.get(key) as Entry<T> | undefined
        const good = error && previous ? (previous.error ? previous.good : { value: previous.value, at: previous.at }) : null
        space.delete(key)
        space.set(key, { value, at, error, ttlMs: options.ttlMs, good })
        this.sweep(spaceOf(key), at)
        return { value, at, fresh: true }
      } finally {
        this.loading.delete(key)
      }
    })()
    this.loading.set(key, run as Promise<CacheHit<unknown>>)
    return run
  }

  /** Drops what is long past its time, then the oldest entries over the space's bound. */
  private sweep(name: string, now: number): void {
    const space = this.spaces.get(name)
    if (!space) return
    for (const [k, e] of space) {
      if (now - e.at > e.ttlMs + this.keepStaleMs) space.delete(k)
    }
    const limit = Math.max(1, this.limits[name] ?? this.maxEntries)
    while (space.size > limit) {
      const oldest = space.keys().next().value
      if (oldest === undefined) break
      space.delete(oldest)
    }
  }

  delete(key: string): void {
    this.spaces.get(spaceOf(key))?.delete(key)
  }

  clear(): void {
    this.spaces.clear()
  }

  get size(): number {
    let n = 0
    for (const s of this.spaces.values()) n += s.size
    return n
  }
}
