import { InpostPayApiError } from "./client"
import { createLimiter } from "./rate-limit"
import type { SigningKey } from "./signature"

/**
 * THE SIGNING KEYS InPost signs its calls with, by version, fresh for an
 * hour. Anyone can send a call with a made-up version, so the fetches are
 * limited, but in two pools: a version InPost already gave a key for is
 * refreshed at most once a minute, and its last key is used while the
 * refresh is limited or fails; unknown versions share 10 fetches a minute,
 * and one InPost does not know is not asked for again for 10 minutes.
 * Forged calls can then only delay a new key version, never lock out the
 * versions in use.
 */

export interface KeyCache {
  get(version: string, fetchKey: (version: string) => Promise<SigningKey>, onError?: (e: unknown) => void, now?: number): Promise<SigningKey | null>
  reset(): void
}

const FRESH_MS = 60 * 60 * 1000
const MISSING_MS = 10 * 60 * 1000

export function createKeyCache(): KeyCache {
  const keys = new Map<string, { key: SigningKey; until: number }>()
  const missing = new Map<string, number>()
  const known = createLimiter(1, 60_000)
  const unknown = createLimiter(10, 60_000)
  return {
    async get(version, fetchKey, onError, now = Date.now()) {
      const cached = keys.get(version)
      if (cached && cached.until > now) return cached.key
      if (!cached && (missing.get(version) ?? 0) > now) return null
      if (cached ? known.limited(version, now) : unknown.limited("unknown", now)) return cached?.key ?? null
      try {
        const key = await fetchKey(version)
        keys.set(version, { key, until: now + FRESH_MS })
        missing.delete(version)
        if (keys.size > 20) keys.delete(keys.keys().next().value as string)
        return key
      } catch (e) {
        onError?.(e)
        if (cached) return cached.key
        if (e instanceof InpostPayApiError && e.kind === "not_found") {
          missing.set(version, now + MISSING_MS)
          if (missing.size > 200) missing.delete(missing.keys().next().value as string)
        }
        return null
      }
    },
    reset() {
      keys.clear()
      missing.clear()
      known.reset()
      unknown.reset()
    },
  }
}
