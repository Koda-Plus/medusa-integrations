import type { Logger, MedusaContainer } from "@medusajs/framework/types"
import { CENEO_MODULE, OFFER_STATES, type OfferState } from "./constants"
import type { ApiMode, FeedBuildDto, OfferCounts, StatusResponse } from "./contract"
import { feedGaps, type ResolvedCeneoOptions } from "./options"

/**
 * The generated CRUD of the module, as routes, jobs and workflows use it
 * from outside the service (through the container). Kept structural so the
 * code never imports the concrete service class and the service stays thin.
 */
export interface CeneoServiceLike {
  getOptions(): ResolvedCeneoOptions
  getLogger(): Logger
  isDemo(): boolean

  listCeneoFeeds(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createCeneoFeeds(data: unknown | unknown[]): Promise<Row[]>
  updateCeneoFeeds(data: unknown | unknown[]): Promise<Row[]>
  deleteCeneoFeeds(ids: string | string[]): Promise<void>

  listCeneoOffers(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  listAndCountCeneoOffers(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<[Row[], number]>
  createCeneoOffers(data: unknown | unknown[]): Promise<Row[]>
  updateCeneoOffers(data: unknown | unknown[]): Promise<Row[]>
}

export type Row = Record<string, unknown> & {
  id: string
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export function ceneoSvc(scope: Pick<MedusaContainer, "resolve">): CeneoServiceLike {
  return scope.resolve(CENEO_MODULE) as CeneoServiceLike
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function int(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "string" && v) return new Date(v).toISOString()
  return new Date(0).toISOString()
}

export function toFeedBuild(row: Row): FeedBuildDto {
  return {
    id: row.id,
    /* A row is written only once a build has ended; anything but "built" never reads as a good file. */
    status: row.status === "built" ? "built" : "failed",
    hash: str(row.hash),
    bytes: int(row.bytes),
    offers: int(row.offers),
    warnings: int(row.warnings),
    errors: int(row.errors),
    excluded: int(row.excluded),
    duration_ms: int(row.duration_ms),
    error: str(row.error),
    trigger: str(row.trigger) ?? "schedule",
    built_at: iso(row.built_at),
    demo: row.demo === true,
  }
}

export function apiMode(o: ResolvedCeneoOptions): ApiMode {
  if (o.demo) return "demo"
  return o.apiKey ? "live" : "missing_key"
}

export function feedPath(o: ResolvedCeneoOptions): string | null {
  return o.feed.token ? `/ceneo/feed/${o.feed.token}.xml` : null
}

/** The columns of a build without the XML itself (the status never carries the file). */
export const BUILD_FIELDS = ["id", "status", "hash", "bytes", "offers", "warnings", "errors", "excluded", "duration_ms", "error", "trigger", "built_at", "demo"]

/**
 * The status of the page from the options, the newest successful build,
 * the newest build of any status and the offer counters. Pure, so it is
 * tested without a database.
 */
export function buildStatus(o: ResolvedCeneoOptions, lastBuilt: Row | null, newestAny: Row | null, counts: OfferCounts): StatusResponse {
  const last = lastBuilt ? toFeedBuild(lastBuilt) : null
  const newest = newestAny ? toFeedBuild(newestAny) : null
  return {
    demo: o.demo,
    feed: {
      path: feedPath(o),
      gaps: feedGaps(o),
      productUrl: o.feed.productUrl,
      regionId: o.feed.regionId,
      salesChannelId: o.feed.salesChannelId,
      offerId: o.feed.offerId,
      inStockAvail: o.feed.inStockAvail,
      backorderAvail: o.feed.backorderAvail,
      outOfStock: o.feed.outOfStock,
      intervalMinutes: o.feed.intervalMinutes,
      last,
      failed: newest && newest.status === "failed" ? newest : null,
    },
    reviews: { configured: Boolean(o.reviews.accountGuid), rejected: o.reviews.accountGuidRejected, workDays: o.reviews.workDays },
    api: { mode: apiMode(o), timeoutMs: o.timeoutMs },
    counts,
  }
}

/** The offer counters of the active rows (one per variant), one count per state. */
export async function countOffers(svc: CeneoServiceLike): Promise<OfferCounts> {
  const per = await Promise.all(OFFER_STATES.map(async (state) => [state, (await svc.listAndCountCeneoOffers({ state, retired_at: null }, { take: 1, select: ["id"] }))[1]] as const))
  const counts = Object.fromEntries(per) as Record<OfferState, number>
  return { ...counts, offers: per.reduce((a, [, n]) => a + n, 0) }
}

/**
 * The decision for the build row: refresh the served one (same file) or add
 * a new one. `served`: the newest build that still has its XML.
 */
export function planFeedWrite(served: { id: string; hash?: unknown } | null, hash: string): { kind: "touch"; id: string } | { kind: "insert" } {
  if (served && served.hash === hash) return { kind: "touch", id: served.id }
  return { kind: "insert" }
}

/**
 * THE GUARD AGAINST A MASS DROP. A scheduled build that would take most of
 * the served offers off Ceneo at once (a wrong sales channel, prices that
 * suddenly exclude tax, an empty catalog read) fails instead, and the
 * previous file stays served. A build started from the admin ("Build now")
 * is a person's decision and passes, unless the file would be empty.
 */
export function shrinkGuard(previousOffers: number | null, nextOffers: number, manual: boolean): "empty" | "shrunk" | null {
  if (previousOffers === null || previousOffers <= 0) return null
  if (nextOffers === 0) return "empty"
  if (!manual && previousOffers >= 20 && nextOffers < previousOffers / 2) return "shrunk"
  return null
}
