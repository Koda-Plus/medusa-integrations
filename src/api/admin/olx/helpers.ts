import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest } from "@medusajs/framework/http"
import type OlxModuleService from "../../../modules/olx/service"
import { OLX_MODULE, SYNC_SCHEDULE, olxUrls } from "../../../modules/olx/lib/constants"
import { activeConnecting, getConnectionRow } from "../../../modules/olx/lib/connection"
import type { OlxStatusResponse } from "../../../modules/olx/lib/contract"
import { iso, toRunDto, type RunRow } from "../../../modules/olx/lib/dto"
import { statusGroup } from "../../../modules/olx/lib/matching"
import { isSyncRunning } from "../../../workflows/olx/run-sync"
import { syncOlxAdvertsWorkflow } from "../../../workflows/olx/sync-olx-adverts"

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
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to OLX
 * while rendering. Going to the network sits behind POST routes and clicks.
 */
export async function buildStatus(svc: OlxModuleService): Promise<OlxStatusResponse> {
  const o = svc.getOptions()
  const urls = olxUrls(o.market)
  const row = o.demo ? null : await getConnectionRow(svc)

  const rows = (await svc.listOlxAdverts({ demo: o.demo } as never, {
    take: null,
    select: ["status", "variant_id", "product_id", "match_key", "is_primary"],
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

  const runs = (await svc.listOlxSyncRuns({}, { take: 1, order: { started_at: "DESC" } })) as unknown as RunRow[]

  return {
    mode: o.demo ? "demo" : "live",
    configured: o.demo ? true : svc.isConfigured(),
    missing: o.demo ? [] : svc.missingOptions(),
    market: o.market,
    marketHost: urls.host,
    redirectUri: o.redirectUri || null,
    clientIdPrefix: o.clientId ? `${o.clientId.slice(0, 6)}...` : null,
    readOnly: true,
    schedule: SYNC_SCHEDULE,
    syncEnabled: o.syncEnabled,
    connection: {
      connected: Boolean(row?.refresh_token_enc) && !o.demo && svc.isConfigured(),
      connectedAt: iso(row?.connected_at),
      disconnectedAt: iso(row?.disconnected_at),
      refreshedAt: iso(row?.refreshed_at),
      accessExpiresAt: iso(row?.access_expires_at),
      scope: row?.scope ?? null,
      lastError: row?.last_error ?? null,
      lastErrorAt: iso(row?.last_error_at),
    },
    connecting: activeConnecting(svc, row),
    counts,
    lastRun: runs[0] ? toRunDto(runs[0]) : null,
    running: isSyncRunning(),
  }
}

/**
 * Demo mode, first visit: build the sample snapshot right away, so the page
 * opens with data instead of an empty table. Only when nothing ever ran,
 * otherwise an empty catalog would add a run on every page view.
 */
export async function ensureDemoSnapshot(scope: MedusaContainer, svc: OlxModuleService): Promise<void> {
  if (!svc.isDemo() || isSyncRunning()) return
  const runs = (await svc.listOlxSyncRuns({}, { take: 1, select: ["id"] })) as unknown as Array<{ id: string }>
  if (runs.length > 0) return
  await syncOlxAdvertsWorkflow(scope).run({ input: { trigger: "auto" } })
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
