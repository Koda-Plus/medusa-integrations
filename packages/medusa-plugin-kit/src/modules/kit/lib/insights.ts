import type { KitBroadcast, KitBroadcastStats, KitClient, KitEmailStats, KitGrowth } from "./client"

/**
 * WHAT THE PANEL SHOWS ABOUT THE LIST, read from Kit: the size of the list,
 * its growth, the email stats and the newest broadcasts with their results.
 * Read only.
 *
 * CACHED FOR TEN MINUTES per process. One broadcast list costs one request
 * per broadcast for the stats, and Kit allows 120 requests a minute per key;
 * the numbers change slowly, so every open of the panel need not ask again.
 */

export interface KitOverview {
  subscribers: number
  growth_30: KitGrowth | null
  growth_90: KitGrowth | null
  email_stats: KitEmailStats | null
  fetched_at: string
}

export interface KitBroadcastRow extends KitBroadcast {
  stats: KitBroadcastStats | null
}

const TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

async function cached<T>(key: string, fresh: boolean, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

/** YYYY-MM-DD of a day `daysAgo` before today (UTC). */
export function dayIso(daysAgo: number, now: Date = new Date()): string {
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** A part that fails (a plan without growth stats, a timeout) comes back as null, the rest still shows. */
async function soft<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch {
    return null
  }
}

export function kitOverview(client: KitClient, fresh = false): Promise<KitOverview> {
  return cached("overview", fresh, async () => {
    const today = dayIso(0)
    const [subscribers, growth_30, growth_90, email_stats] = await Promise.all([
      client.subscriberCount(),
      soft(client.growth(dayIso(30), today)),
      soft(client.growth(dayIso(90), today)),
      soft(client.emailStats()),
    ])
    return { subscribers, growth_30, growth_90, email_stats, fetched_at: new Date().toISOString() }
  })
}

export function kitBroadcasts(client: KitClient, take = 10, fresh = false): Promise<KitBroadcastRow[]> {
  return cached(`broadcasts:${take}`, fresh, async () => {
    const list = await client.broadcasts(take)
    const rows: KitBroadcastRow[] = []
    for (const b of list) {
      rows.push({ ...b, stats: await soft(client.broadcastStats(b.id)) })
    }
    return rows
  })
}
