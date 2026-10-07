/**
 * THE PLUGIN'S OWN BRAKES. No runtime imports.
 *
 * Stripe's limits are per account and shared with the official provider:
 * checkouts must never wait because the admin is reading reports. So the
 * plugin keeps to a fraction of the limit with a token bucket (requests per
 * second, a burst of the same size) and a small cap on requests in flight
 * (list requests with expansions are the heavy kind Stripe's concurrency
 * limiter sheds first).
 */

export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
}

export class TokenBucket {
  private tokens: number
  private last: number
  private readonly rate: number
  private readonly burst: number
  private readonly clock: Clock
  private chain: Promise<void> = Promise.resolve()

  constructor(perSecond: number, clock: Clock = realClock, burst?: number) {
    this.rate = Math.max(0.1, perSecond)
    this.burst = Math.max(1, Math.floor(burst ?? perSecond))
    this.tokens = this.burst
    this.clock = clock
    this.last = clock.now()
  }

  private refill(): void {
    const now = this.clock.now()
    const elapsed = Math.max(0, now - this.last) / 1000
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate)
    this.last = now
  }

  /** Resolves when a request may go. Callers are served in order. */
  take(): Promise<void> {
    const turn = this.chain.then(async () => {
      this.refill()
      if (this.tokens < 1) {
        const waitMs = Math.ceil(((1 - this.tokens) / this.rate) * 1000)
        await this.clock.sleep(waitMs)
        this.refill()
      }
      this.tokens = Math.max(0, this.tokens - 1)
    })
    this.chain = turn.catch(() => undefined)
    return turn
  }
}

/** At most `size` tasks at once; the others wait in order. */
export class Semaphore {
  private active = 0
  private readonly queue: Array<() => void> = []
  private readonly size: number

  constructor(size: number) {
    this.size = Math.max(1, Math.floor(size))
  }

  get inFlight(): number {
    return this.active
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.queue.push(resolve))
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.queue.shift()?.()
    }
  }
}

/** Exponential backoff with jitter: about 500 ms, 1 s, 2 s, capped. */
export function backoffMs(attempt: number, random: () => number = Math.random, capMs = 8_000): number {
  const base = 500 * 2 ** Math.max(0, attempt)
  return Math.min(capMs, Math.round(base * (0.5 + random() * 0.5)))
}

/** Retry-After in seconds or as an HTTP date, in ms; null when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now: number): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}
