/**
 * ADVERT STATISTICS: one `GET /adverts/{id}/statistics` per live advert,
 * oldest numbers first, at most `statsPerRun` per run and each advert at most
 * every six hours. On the shared rate limiter like every other request, and
 * stopped at once by a 429 or the IP block. Demo mode: simulated numbers that
 * grow with the age of the advert, through the same parser.
 */

import { ipBlockedUntil } from "../../modules/olx/lib/block"
import { isConnected } from "../../modules/olx/lib/connection"
import { STATS_MIN_AGE_MS } from "../../modules/olx/lib/constants"
import { demoStatisticsRaw } from "../../modules/olx/lib/demo"
import { classifyError } from "../../modules/olx/lib/errors"
import { readAdvertStatistics } from "../../modules/olx/lib/partner-api"
import { parseStatistics, pickForStats } from "../../modules/olx/lib/stats"
import { errorText, isLocked, modeKey, olxServiceOf, setState, withLock, type Scope } from "./runtime"

export interface StatsRunState {
  at: string
  refreshed: number
  failed: number
  due: number
  message: string | null
}

export function statsStateKey(demo: boolean): string {
  return `stats:${modeKey(demo)}`
}

export function isStatsRunning(): boolean {
  return isLocked("stats")
}

export async function runOlxStats(scope: Scope, input: { trigger?: string } = {}): Promise<StatsRunState | null> {
  const svc = olxServiceOf(scope)
  const o = svc.getOptions()
  const demo = o.demo
  if (!o.statsEnabled) return null
  if (!demo) {
    if (!svc.isConfigured() || !(await isConnected(svc))) return null
    if (ipBlockedUntil(Date.now())) return null
  }
  return withLock("stats", async () => {
    const now = new Date()
    const rows = (await svc.listOlxAdverts({ demo, status: "active" } as never, {
      take: null,
      select: ["id", "olx_id", "status", "stats_at", "olx_created_at"],
    })) as unknown as Array<{ id: string; olx_id: string; status: string; stats_at: Date | string | null; olx_created_at: Date | string | null }>
    const candidates = rows.map((r) => ({ id: r.id, olxId: r.olx_id, status: r.status, statsAt: r.stats_at, createdAt: r.olx_created_at }))
    /* The demo refreshes everything every run: a handful of adverts, no network. */
    const picked = pickForStats(candidates, now, demo ? 30 * 60 * 1000 : STATS_MIN_AGE_MS, demo ? 500 : o.statsPerRun)
    let refreshed = 0
    let failed = 0
    let consecutive = 0
    let message: string | null = null
    for (const a of picked) {
      let raw: unknown
      try {
        raw = demo ? demoStatisticsRaw(a.olxId, a.createdAt, now) : await readAdvertStatistics(svc, a.olxId)
        consecutive = 0
      } catch (err) {
        failed += 1
        consecutive += 1
        message = errorText(svc, err)
        const cls = classifyError(err)
        if (cls === "throttled" || cls === "auth" || consecutive >= 5) break
        continue
      }
      const stats = parseStatistics(raw)
      await svc.updateOlxAdverts({
        id: a.id,
        stats_views: stats?.views ?? null,
        stats_phone_views: stats?.phoneViews ?? null,
        stats_observers: stats?.observers ?? null,
        stats_at: now,
      } as never)
      if (stats) refreshed += 1
    }
    const state: StatsRunState = { at: now.toISOString(), refreshed, failed, due: picked.length, message }
    await setState(svc, statsStateKey(demo), state)
    if (input.trigger === "manual") svc.getLogger().info(`[olx] statistics: ${refreshed} refreshed, ${failed} failed`)
    return state
  })
}
