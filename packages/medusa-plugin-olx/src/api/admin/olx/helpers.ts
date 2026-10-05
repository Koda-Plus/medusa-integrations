import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type OlxModuleService from "../../../modules/olx/service"
import { emptyAlertCounts, type AlertCounts } from "../../../modules/olx/lib/alerts"
import { ipBlockedUntil } from "../../../modules/olx/lib/block"
import { activeConnecting, getConnectionRow, scopeFor } from "../../../modules/olx/lib/connection"
import {
  DEMO_GENERATOR_VERSION,
  MARKET_CURRENCY,
  OLX_MODULE,
  SYNC_SCHEDULE,
  WRITERS,
  olxUrls,
  type WriterKey,
} from "../../../modules/olx/lib/constants"
import type {
  OlxAdvertDto,
  OlxAlertKind,
  OlxPlanCountsDto,
  OlxPlanSummaryDto,
  OlxStatusResponse,
  OlxWriterDto,
} from "../../../modules/olx/lib/contract"
import { iso, toRunDto, toWriterRunDto, type RunRow, type WriterRunRow } from "../../../modules/olx/lib/dto"
import { statusGroup } from "../../../modules/olx/lib/matching"
import { hasWriteScope } from "../../../modules/olx/lib/security"
import { totalStats } from "../../../modules/olx/lib/stats"
import { threadTotals } from "../../../modules/olx/lib/threads"
import { countPlan } from "../../../modules/olx/lib/writers"
import { runOlxCycle } from "../../../workflows/olx/cycle"
import { planStateKey, type StoredPlanSummary } from "../../../workflows/olx/plan"
import { isStatsRunning, runOlxStats, statsStateKey, type StatsRunState } from "../../../workflows/olx/refresh-stats"
import { isWriterRunning, writerSwitch } from "../../../workflows/olx/run-writer"
import { getState, getStates } from "../../../workflows/olx/runtime"
import { isSyncRunning } from "../../../workflows/olx/run-sync"
import { syncOlxAdvertsWorkflow } from "../../../workflows/olx/sync-olx-adverts"
import { isThreadsRunning, runOlxThreads, threadsStateKey, type ThreadsRunState } from "../../../workflows/olx/sync-threads"

/* Only files named `route.ts` register routes; this one is a helper. */

export function olxService(scope: MedusaRequest["scope"] | MedusaContainer): OlxModuleService {
  return scope.resolve<OlxModuleService>(OLX_MODULE)
}

interface CountRow {
  status: string
  variant_id: string | null
  product_id: string | null
  match_key: string | null
  is_primary: boolean
  stats_views: number | null
  stats_phone_views: number | null
  stats_observers: number | null
  stats_at: Date | string | null
}

const EMPTY_PLAN: OlxPlanSummaryDto = {
  plannedAt: null,
  readComplete: false,
  stockComplete: false,
  lifecycleSkipped: null,
  guard: { held: false, endings: 0, liveLinked: 0, limit: 0 },
  price: { noPrice: 0, otherCurrency: 0, skipped: null },
  publish: { mapped: false, candidates: 0, ready: 0, blocked: 0, reason: null },
  message: null,
}

function publicationCounts(rows: Array<{ state: string }>): OlxPlanCountsDto {
  const out: OlxPlanCountsDto = { pending: 0, held: 0, failed: 0, quarantined: 0, unknown: 0, applying: 0, done: 0 }
  for (const r of rows) {
    if (r.state === "planned") out.pending += 1
    else if (r.state === "blocked") out.held += 1
    else if (r.state === "publishing") out.applying += 1
    else if (r.state === "published") out.done += 1
    else if (r.state === "failed" || r.state === "quarantined" || r.state === "unknown") out[r.state] += 1
  }
  return out
}

async function writerDto(svc: OlxModuleService, writer: WriterKey): Promise<OlxWriterDto> {
  const o = svc.getOptions()
  const demo = o.demo
  const sw = await writerSwitch(svc, writer)
  const states =
    writer === "publish"
      ? ((await svc.listOlxPublications({ demo } as never, { take: null, select: ["state"] })) as unknown as Array<{ state: string }>)
      : ((await svc.listOlxPlanItems({ writer, demo } as never, { take: null, select: ["state"] })) as unknown as Array<{ state: string }>)
  const last = async (mode: "apply" | "dry_run") => {
    const rows = (await svc.listOlxWriterRuns({ writer, demo, mode } as never, { take: 1, order: { started_at: "DESC" } })) as unknown as WriterRunRow[]
    return rows[0] ? toWriterRunDto(rows[0]) : null
  }
  return {
    writer,
    allowedByConfig: sw.state.allowedByConfig,
    armed: sw.state.armed,
    active: sw.state.active,
    blockers: sw.state.blockers,
    changedBy: sw.toggle?.changedBy ?? null,
    changedAt: sw.toggle?.changedAt ?? null,
    cap: o.caps[writer],
    counts: writer === "publish" ? publicationCounts(states) : countPlan(states),
    running: isWriterRunning(writer),
    lastRun: await last("apply"),
    lastDryRun: await last("dry_run"),
  }
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to OLX
 * while rendering. Going to the network sits behind POST routes and clicks.
 */
export async function buildStatus(svc: OlxModuleService): Promise<OlxStatusResponse> {
  const o = svc.getOptions()
  const demo = o.demo
  const urls = olxUrls(o.market)
  const row = demo ? null : await getConnectionRow(svc)

  const rows = (await svc.listOlxAdverts({ demo } as never, {
    take: null,
    select: ["status", "variant_id", "product_id", "match_key", "is_primary", "stats_views", "stats_phone_views", "stats_observers", "stats_at"],
  })) as unknown as CountRow[]

  const counts = { adverts: rows.length, live: 0, limited: 0, ended: 0, linked: 0, linkedLive: 0, unmatchedLive: 0, noKey: 0, products: 0 }
  const products = new Set<string>()
  for (const r of rows) {
    const g = statusGroup(r.status)
    counts[g === "live" ? "live" : g === "limited" ? "limited" : "ended"] += 1
    if (!r.match_key) counts.noKey += 1
    if (r.variant_id) {
      counts.linked += 1
      if (r.product_id) products.add(r.product_id)
      if (r.is_primary && g === "live") counts.linkedLive += 1
    } else if (r.match_key && g === "live") {
      counts.unmatchedLive += 1
    }
  }
  counts.products = products.size
  const totals = totalStats(
    rows.map((r) => ({ status: r.status, views: r.stats_views, phoneViews: r.stats_phone_views, observers: r.stats_observers, statsAt: r.stats_at })),
  )

  const runs = (await svc.listOlxSyncRuns({}, { take: 1, order: { started_at: "DESC" } })) as unknown as RunRow[]
  const complete = demo
    ? []
    : ((await svc.listOlxSyncRuns({ source: "api", complete: true } as never, { take: 1, order: { started_at: "DESC" } })) as unknown as RunRow[])

  const mode = demo ? "demo" : "live"
  const states = await getStates(svc, [planStateKey(demo), statsStateKey(demo), `threads:${mode}`])
  const plan = (states.get(planStateKey(demo)) as StoredPlanSummary | null | undefined) ?? null
  const statsState = (states.get(statsStateKey(demo)) as StatsRunState | null | undefined) ?? null
  const threadsState = (states.get(threadsStateKey(demo)) as ThreadsRunState | null | undefined) ?? null

  let alerts: AlertCounts = emptyAlertCounts()
  if (plan?.alerts) alerts = { ...alerts, ...plan.alerts }
  else {
    const kept = (await svc.listOlxAlerts({ demo } as never, { take: null, select: ["kind"] })) as unknown as Array<{ kind: keyof AlertCounts }>
    for (const k of kept) if (k.kind in alerts) alerts[k.kind] += 1
  }

  const threads = (await svc.listOlxThreads({ demo } as never, { take: null, select: ["unread_count"] })) as unknown as Array<{ unread_count: number }>
  const tt = threadTotals(threads.map((t) => ({ unread: t.unread_count ?? 0 })))

  const writers: OlxWriterDto[] = []
  for (const w of WRITERS) writers.push(await writerDto(svc, w))
  const blocked = ipBlockedUntil(Date.now())
  const { alerts: _a, simulation, ...planDto } = plan ?? { ...EMPTY_PLAN, alerts: emptyAlertCounts(), simulation: null }

  return {
    mode: demo ? "demo" : "live",
    configured: demo ? true : svc.isConfigured(),
    missing: demo ? [] : svc.missingOptions(),
    market: o.market,
    marketHost: urls.host,
    redirectUri: o.redirectUri || null,
    clientIdPrefix: o.clientId ? `${o.clientId.slice(0, 6)}...` : null,
    readOnly: !writers.some((w) => w.active),
    schedule: SYNC_SCHEDULE,
    syncEnabled: o.syncEnabled,
    connection: {
      connected: Boolean(row?.refresh_token_enc) && !demo && svc.isConfigured(),
      connectedAt: iso(row?.connected_at),
      disconnectedAt: iso(row?.disconnected_at),
      refreshedAt: iso(row?.refreshed_at),
      accessExpiresAt: iso(row?.access_expires_at),
      scope: row?.scope ?? null,
      lastError: row?.last_error ?? null,
      lastErrorAt: iso(row?.last_error_at),
    },
    scope: { requested: scopeFor(svc), writeGranted: demo ? true : hasWriteScope(row?.scope) },
    connecting: activeConnecting(svc, row),
    counts,
    lastRun: runs[0] ? toRunDto(runs[0]) : null,
    lastCompleteSyncAt: complete[0] ? iso(complete[0].finished_at ?? complete[0].started_at) : null,
    running: isSyncRunning(),
    references: o.references,
    alerts,
    stats: {
      enabled: o.statsEnabled,
      views: totals.views,
      phoneViews: totals.phoneViews,
      observers: totals.observers,
      withStats: totals.withStats,
      oldestAt: totals.oldestAt,
      lastRunAt: statsState?.at ?? null,
      lastRunMessage: statsState?.message ?? null,
      running: isStatsRunning(),
    },
    messages: {
      enabled: o.messagesEnabled,
      threads: tt.threads,
      unreadThreads: tt.unreadThreads,
      unreadMessages: tt.unreadMessages,
      lastReadAt: threadsState?.at ?? null,
      complete: threadsState ? threadsState.complete : null,
      lastReadMessage: threadsState?.message ?? null,
      running: isThreadsRunning(),
      chatUrl: urls.chat,
    },
    writers,
    plan: planDto,
    ipBlockedUntil: blocked && !demo ? new Date(blocked).toISOString() : null,
    settings: {
      currency: MARKET_CURRENCY[o.market].toUpperCase(),
      maxPriceChangePercent: o.maxPriceChangePercent,
      salesChannelId: o.salesChannelId,
      statsPerRun: o.statsPerRun,
      writersAllowed: { ...o.writers },
    },
    simulation: demo ? simulation ?? null : null,
  }
}

/**
 * Demo mode, first visit (and after an upgrade of the demo generator): build
 * the simulated account right away, so the page opens with data. Only when
 * nothing is there yet, otherwise every page view would add runs.
 */
export async function ensureDemoSnapshot(scope: MedusaContainer, svc: OlxModuleService): Promise<void> {
  if (!svc.isDemo() || isSyncRunning()) return
  const generator = await getState<{ version?: string }>(svc, "demo:generator")
  const runs = (await svc.listOlxSyncRuns({}, { take: 1, select: ["id"] })) as unknown as Array<{ id: string }>
  if (runs.length === 0 || generator?.version !== DEMO_GENERATOR_VERSION) {
    await syncOlxAdvertsWorkflow(scope).run({ input: { trigger: "auto" } })
    await runOlxCycle(scope, { trigger: "auto" })
  } else if (!(await getState(svc, planStateKey(true)))) {
    await runOlxCycle(scope, { trigger: "auto" })
  }
  if (!(await getState(svc, statsStateKey(true)))) await runOlxStats(scope, { trigger: "auto" })
  if (!(await getState(svc, threadsStateKey(true)))) await runOlxThreads(scope, { trigger: "auto" })
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function strParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

export function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** The admin user behind a request, as an e-mail when the user module knows it. */
export async function actorOf(req: MedusaRequest): Promise<string | null> {
  const id = (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context?.actor_id
  if (!id) return null
  try {
    const users = req.scope.resolve(Modules.USER) as { retrieveUser(id: string): Promise<{ email?: string | null }> }
    const user = await users.retrieveUser(id)
    return user?.email || id
  } catch {
    return id
  }
}

/** Alert kind and unread messages of the adverts on one page. */
export async function decorateAdverts(svc: OlxModuleService, adverts: OlxAdvertDto[], demo: boolean): Promise<OlxAdvertDto[]> {
  const ids = adverts.map((a) => a.olxId)
  if (ids.length === 0) return adverts
  const alerts = (await svc.listOlxAlerts({ demo, olx_id: ids } as never, { take: null, select: ["olx_id", "kind"] })) as unknown as Array<{
    olx_id: string
    kind: OlxAlertKind
  }>
  const threads = (await svc.listOlxThreads({ demo, advert_olx_id: ids } as never, {
    take: null,
    select: ["advert_olx_id", "unread_count"],
  })) as unknown as Array<{ advert_olx_id: string; unread_count: number }>
  const alertBy = new Map<string, OlxAlertKind>()
  for (const a of alerts) if (!alertBy.has(a.olx_id)) alertBy.set(a.olx_id, a.kind)
  const unreadBy = new Map<string, number>()
  for (const t of threads) unreadBy.set(t.advert_olx_id, (unreadBy.get(t.advert_olx_id) ?? 0) + (t.unread_count ?? 0))
  return adverts.map((a) => ({ ...a, alert: alertBy.get(a.olxId) ?? null, unread: unreadBy.get(a.olxId) ?? 0 }))
}

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = (req as MedusaRequest & { body?: unknown }).body
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}
