/**
 * The shapes the admin API answers with, shared by the routes and the admin
 * bundle. Types only, no runtime imports.
 */
import type { Avail, OfferIdSource, OfferState, OutOfStockMode } from "./constants"
import type { FeedGap } from "./options"

export type FeedBuildStatus = "built" | "failed"

export interface FeedBuildDto {
  id: string
  status: FeedBuildStatus
  hash: string | null
  bytes: number
  offers: number
  warnings: number
  errors: number
  excluded: number
  duration_ms: number
  error: string | null
  trigger: string
  built_at: string
  demo: boolean
}

/** How the Ceneo API answers with these options. */
export type ApiMode = "live" | "demo" | "missing_key"

export type OfferCounts = Record<OfferState, number> & { offers: number }

export interface StatusResponse {
  demo: boolean
  feed: {
    /** `/ceneo/feed/<token>.xml` on the backend, or null without a valid token. */
    path: string | null
    gaps: FeedGap[]
    productUrl: string | null
    regionId: string | null
    salesChannelId: string | null
    offerId: OfferIdSource
    inStockAvail: Avail
    backorderAvail: Avail
    outOfStock: OutOfStockMode
    intervalMinutes: number
    /** The newest successful build: the file Ceneo gets. */
    last: FeedBuildDto | null
    /** The newest build, when it failed after the last successful one. */
    failed: FeedBuildDto | null
  }
  reviews: { configured: boolean; rejected: boolean; workDays: number | null }
  api: { mode: ApiMode; timeoutMs: number }
  counts: OfferCounts
}

/** What started a feed build. */
export type FeedTrigger = "schedule" | "first" | "change" | "manual"

/** The answer of a feed build (`POST /admin/ceneo/feed`, the workflow). */
export type FeedBuildResult =
  | { status: "skipped"; reason: "gaps"; gaps: FeedGap[] }
  | { status: "skipped"; reason: "running" }
  | { status: "built"; id: string; changed: boolean; bytes: number; duration_ms: number; offers: number; warnings: number; errors: number; excluded: number }
  | { status: "failed"; id: string; error: string; code: string | null; duration_ms: number }
