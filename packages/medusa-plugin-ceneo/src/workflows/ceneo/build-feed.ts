/**
 * ONE FEED BUILD: read the catalog, decide every offer, check the ids
 * against the offer table, render the file, then write the offers and the
 * build. A build row is written only once the build has ended, successful
 * or not; a failed build keeps the previous file served.
 *
 * SAME FILE, NO NEW ROW. When the file has the same hash as the newest
 * successful build, that row only gets the new time and counters, so the
 * table does not fill with copies of an unchanged catalog.
 *
 * RETENTION. The XML stays in the newest `FEED_XML_KEEP` successful builds;
 * rows beyond the newest `FEED_ROWS_KEEP` are deleted. The served build is
 * never touched by either, even after a long run of failures.
 */

import { FEED_ROWS_KEEP, FEED_XML_KEEP } from "../../modules/ceneo/lib/constants"
import type { FeedBuildResult, FeedTrigger } from "../../modules/ceneo/lib/contract"
import { buildOfferDraft, countDrafts, flagDuplicateIds, renderFeed } from "../../modules/ceneo/lib/feed"
import { GONE_PROBLEMS, RETIRED_PROBLEMS, planOfferSync, type OfferRowLite, type OfferSyncPlan } from "../../modules/ceneo/lib/offer-sync"
import { feedGaps } from "../../modules/ceneo/lib/options"
import { ceneoSvc, planFeedWrite, shrinkGuard, type CeneoServiceLike, type Row } from "../../modules/ceneo/lib/store"
import { feedHash } from "../../modules/ceneo/lib/token"
import { CatalogError, loadFeedCatalog } from "./catalog"
import { loadCategoryMapping } from "./categories"
import { chunks, errorText, isLocked, queryOf, withLock, type Scope } from "./runtime"

export type { FeedBuildResult, FeedTrigger }

const OFFER_SYNC_FIELDS = ["id", "offer_id", "variant_id", "retired_at", "product_id", "sku", "title", "state", "problems", "in_feed", "price", "avail", "stock", "ceneo_category_id"]
const WRITE_CHUNK = 500
export const FEED_LOCK = "feed"
const LOCK = FEED_LOCK

export function isFeedBuilding(): boolean {
  return isLocked(LOCK)
}

async function writeOffers(svc: CeneoServiceLike, plan: OfferSyncPlan, now: Date): Promise<void> {
  /* Order matters: retire first (frees the one-active-row-per-variant slot), then update and revive, then create. */
  for (const part of chunks(plan.retire, WRITE_CHUNK)) {
    await svc.updateCeneoOffers(part.map((id) => ({ id, retired_at: now, state: "excluded", in_feed: false, problems: RETIRED_PROBLEMS, built_at: now })))
  }
  for (const part of chunks(plan.update, WRITE_CHUNK)) {
    await svc.updateCeneoOffers(part.map((u) => ({ id: u.id, ...u.data, built_at: now, ...(u.revive ? { retired_at: null } : {}) })))
  }
  for (const part of chunks(plan.create, WRITE_CHUNK)) {
    await svc.createCeneoOffers(part.map((data) => ({ ...data, built_at: now, demo: false })))
  }
  for (const part of chunks(plan.gone, WRITE_CHUNK)) {
    await svc.updateCeneoOffers(part.map((id) => ({ id, state: "excluded", in_feed: false, problems: GONE_PROBLEMS, built_at: now })))
  }
}

/** The scheduled build would take most offers off Ceneo at once. */
class FeedGuardError extends Error {
  readonly code: "feed_empty" | "feed_shrunk"
  constructor(kind: "empty" | "shrunk", previous: number, next: number) {
    super(
      kind === "empty"
        ? `The new file would have no offers (the served one has ${previous}); check the sales channel, the region prices and the problems of the offers.`
        : `The new file would drop from ${previous} to ${next} offers; check the problems of the offers, or use Build now to publish it anyway.`,
    )
    this.code = kind === "empty" ? "feed_empty" : "feed_shrunk"
  }
}

/** The served build is never cleared or deleted; `null` looks it up here. */
async function pruneFeeds(svc: CeneoServiceLike, servedIdOrNull: string | null): Promise<void> {
  const servedId = servedIdOrNull ?? (await newestServed(svc))?.id ?? null
  const stale = await svc.listCeneoFeeds({ status: "built", xml: { $ne: null } }, { select: ["id"], order: { built_at: "DESC" }, skip: FEED_XML_KEEP, take: null })
  const clear = stale.map((r) => r.id).filter((id) => id !== servedId)
  for (const part of chunks(clear, WRITE_CHUNK)) await svc.updateCeneoFeeds(part.map((id) => ({ id, xml: null })))

  const old = await svc.listCeneoFeeds({}, { select: ["id"], order: { built_at: "DESC" }, skip: FEED_ROWS_KEEP, take: null })
  const drop = old.map((r) => r.id).filter((id) => id !== servedId)
  if (drop.length > 0) await svc.deleteCeneoFeeds(drop)
}

async function newestServed(svc: CeneoServiceLike): Promise<Row | null> {
  const [row] = await svc.listCeneoFeeds({ status: "built", xml: { $ne: null } }, { take: 1, order: { built_at: "DESC" }, select: ["id", "hash", "offers"] })
  return row ?? null
}

export async function runCeneoFeedBuild(scope: Scope, input: { trigger?: FeedTrigger } = {}): Promise<FeedBuildResult> {
  const svc = ceneoSvc(scope)
  const o = svc.getOptions()
  const gaps = feedGaps(o)
  if (gaps.length > 0) return { status: "skipped", reason: "gaps", gaps }
  const trigger = input.trigger ?? "schedule"

  const result = await withLock(LOCK, async (): Promise<FeedBuildResult> => {
    const started = Date.now()
    try {
      const catalog = await loadFeedCatalog(queryOf(scope), o)
      const mapping = await loadCategoryMapping(svc)
      for (const v of catalog.variants) v.ceneoCategory = mapping.forProduct(v.categoryIds, catalog.categoryParents)
      const drafts = catalog.variants.map((v) => buildOfferDraft(v, o.feed))
      const rows = (await svc.listCeneoOffers({}, { take: null, select: OFFER_SYNC_FIELDS })) as unknown as OfferRowLite[]
      const holders = new Map(rows.filter((r) => r.offer_id).map((r) => [r.offer_id as string, r.variant_id]))
      flagDuplicateIds(drafts, (id) => holders.get(id))
      const plan = planOfferSync(drafts, rows)
      const xml = renderFeed(drafts)
      const hash = feedHash(xml)
      const counters = countDrafts(drafts)
      const now = new Date()

      /* Nothing is written when the guard stops the build: the rows keep describing the served file. */
      const served = await newestServed(svc)
      const previous = served ? Number(served.offers ?? 0) : null
      const shrink = shrinkGuard(previous, counters.offers, trigger === "manual")
      if (shrink) throw new FeedGuardError(shrink, previous ?? 0, counters.offers)

      await writeOffers(svc, plan, now)

      const duration_ms = Date.now() - started
      const bytes = Buffer.byteLength(xml, "utf8")
      const stats = { ...counters, bytes, duration_ms, trigger, built_at: now, demo: o.demo }
      const decision = planFeedWrite(served, hash)
      let id: string
      if (decision.kind === "touch") {
        id = decision.id
        await svc.updateCeneoFeeds([{ id, ...stats }])
      } else {
        const [row] = await svc.createCeneoFeeds([{ status: "built", xml, hash, ...stats }])
        id = row.id
      }
      try {
        await pruneFeeds(svc, id)
      } catch (err) {
        /* The file is built and served; old rows wait for the next build. */
        svc.getLogger().warn(`[ceneo] Removing old feed builds failed, retried on the next build: ${errorText(err)}`)
      }
      svc.getLogger().info(`[ceneo] Feed built (${trigger}): ${counters.offers} offers, ${counters.errors} with errors, ${counters.excluded} left out, ${bytes} bytes, ${duration_ms} ms${decision.kind === "touch" ? ", file unchanged" : ""}.`)
      return { status: "built", id, changed: decision.kind === "insert", bytes, duration_ms, ...counters }
    } catch (err) {
      const duration_ms = Date.now() - started
      const error = errorText(err)
      const code = err instanceof CatalogError || err instanceof FeedGuardError ? err.code : null
      svc.getLogger().warn(`[ceneo] Feed build failed (${trigger}), the previous file stays served: ${error}`)
      const [row] = await svc.createCeneoFeeds([{ status: "failed", error: code ? `${code}: ${error}` : error, duration_ms, trigger, built_at: new Date(), demo: o.demo }])
      try {
        await pruneFeeds(svc, null)
      } catch (pruneErr) {
        svc.getLogger().warn(`[ceneo] Removing old feed builds failed: ${errorText(pruneErr)}`)
      }
      return { status: "failed", id: row.id, error, code, duration_ms }
    }
  })
  return result ?? { status: "skipped", reason: "running" }
}
