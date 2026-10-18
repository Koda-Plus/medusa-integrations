/**
 * A sliding window per key (a client IP), in the memory of the process, for
 * the public routes. The same shape as the other Koda Plus store routes.
 */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  const prune = (now: number) => {
    for (const [key, stamps] of hits) {
      const alive = stamps.filter((t) => now - t < windowMs)
      if (alive.length) hits.set(key, alive)
      else hits.delete(key)
    }
  }
  return {
    /** True when this hit is over the limit (the hit is not counted then). */
    limited(key: string, now = Date.now()): boolean {
      if (hits.size > 2000) prune(now)
      const stamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
      if (stamps.length >= max) {
        hits.set(key, stamps)
        return true
      }
      stamps.push(now)
      hits.set(key, stamps)
      return false
    },
    reset(): void {
      hits.clear()
    },
  }
}

/** The client of a request: the first X-Forwarded-For address behind a proxy. */
export function clientIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const fwd = req.headers["x-forwarded-for"]
  const raw = Array.isArray(fwd) ? fwd[0] : fwd
  return String(raw ?? "").split(",")[0]?.trim() || req.ip || "unknown"
}
