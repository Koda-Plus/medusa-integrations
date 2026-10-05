/**
 * ADVERT STATISTICS: views, phone views and observers of one advert, from
 * `GET /adverts/{id}/statistics` (scope `read`). Pure, zero imports.
 *
 * The documentation shows the three numbers at the top level of the answer;
 * most Partner API answers wrap their payload in `data`, so both shapes are
 * read. A number that is missing or broken stays null, never zero.
 *
 * ONE REQUEST PER ADVERT, so a refresh is spread over hours: a run takes the
 * live adverts whose numbers are the oldest (never read first) and stops at
 * `statsPerRun`. The OLX API terms forbid presenting account statistics to
 * others without OLX's permission, so the numbers stay in the admin: no store
 * route ever returns them.
 */

export interface AdvertStats {
  views: number | null
  phoneViews: number | null
  observers: number | null
}

function count(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

export function parseStatistics(raw: unknown): AdvertStats | null {
  if (!raw || typeof raw !== "object") return null
  let o = raw as Record<string, unknown>
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) o = o.data as Record<string, unknown>
  const stats = { views: count(o.advert_views), phoneViews: count(o.phone_views), observers: count(o.users_observing) }
  if (stats.views === null && stats.phoneViews === null && stats.observers === null) return null
  return stats
}

export interface StatsCandidate {
  id: string
  olxId: string
  status: string
  statsAt: Date | string | null
}

/** Live adverts due for a refresh, oldest numbers first, at most `cap`. */
export function pickForStats<T extends StatsCandidate>(adverts: readonly T[], now: Date, minAgeMs: number, cap: number): T[] {
  const due = adverts.filter((a) => {
    if (a.status !== "active") return false
    if (!a.statsAt) return true
    const t = new Date(a.statsAt).getTime()
    return !Number.isFinite(t) || now.getTime() - t >= minAgeMs
  })
  const time = (a: T): number => (a.statsAt ? new Date(a.statsAt).getTime() || 0 : -1)
  due.sort((a, b) => time(a) - time(b) || a.olxId.localeCompare(b.olxId))
  return due.slice(0, Math.max(0, cap))
}

export interface StatsTotals {
  views: number
  phoneViews: number
  observers: number
  /** Live adverts that have numbers. */
  withStats: number
  /** The oldest refresh among them, ISO. */
  oldestAt: string | null
}

export function totalStats(
  adverts: ReadonlyArray<{ status: string; views: number | null; phoneViews: number | null; observers: number | null; statsAt: Date | string | null }>,
): StatsTotals {
  const out: StatsTotals = { views: 0, phoneViews: 0, observers: 0, withStats: 0, oldestAt: null }
  let oldest = Number.POSITIVE_INFINITY
  for (const a of adverts) {
    if (a.status !== "active" || !a.statsAt) continue
    out.withStats += 1
    out.views += a.views ?? 0
    out.phoneViews += a.phoneViews ?? 0
    out.observers += a.observers ?? 0
    const t = new Date(a.statsAt).getTime()
    if (Number.isFinite(t) && t < oldest) oldest = t
  }
  out.oldestAt = Number.isFinite(oldest) ? new Date(oldest).toISOString() : null
  return out
}
