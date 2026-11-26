import type { MedusaContainer } from "@medusajs/framework/types"
import { FEED_JOB_SCHEDULE } from "../modules/ceneo/lib/constants"
import { feedGaps } from "../modules/ceneo/lib/options"
import { catalogChangedAt, feedDue } from "../modules/ceneo/lib/schedule"
import { ceneoSvc } from "../modules/ceneo/lib/store"
import { buildCeneoFeedWorkflow } from "../workflows/ceneo/workflows"

/**
 * THE CENEO FEED, EVERY `feed.intervalMinutes` (default 30) AND AFTER
 * CATALOG CHANGES. The job wakes every 5 minutes and builds only when it is
 * due (`lib/schedule.ts`). Nothing happens until the feed has a token and a
 * product URL.
 */
function timeOf(v: unknown): number | null {
  const t = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : Number.NaN
  return Number.isFinite(t) ? t : null
}

export default async function ceneoBuildFeedJob(container: MedusaContainer): Promise<void> {
  const svc = ceneoSvc(container)
  const o = svc.getOptions()
  if (feedGaps(o).length > 0) return
  const [newest] = await svc.listCeneoFeeds({}, { take: 1, order: { built_at: "DESC" }, select: ["id", "built_at"] })
  const lastAt = timeOf(newest?.built_at)
  const due = feedDue(Date.now(), lastAt, o.feed.intervalMinutes, catalogChangedAt())
  if (!due.due) return
  await buildCeneoFeedWorkflow(container).run({ input: { trigger: due.trigger } })
}

export const config = {
  name: "ceneo-build-feed",
  schedule: FEED_JOB_SCHEDULE,
}
