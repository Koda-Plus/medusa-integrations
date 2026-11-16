import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { FeedBuildAnswer, FeedBuildResult } from "../../../../modules/ceneo/lib/contract"
import { ceneoSvc } from "../../../../modules/ceneo/lib/store"
import { errorText } from "../../../../workflows/ceneo/runtime"
import { buildCeneoFeedWorkflow } from "../../../../workflows/ceneo/workflows"

/** Long enough for most catalogs, short of the usual 60 s proxy timeout. */
const WAIT_MS = 20_000

/**
 * POST /admin/ceneo/feed
 *
 * Builds the feed now, without waiting for the job, and answers with the
 * result, always with 200: built (with counters), failed (the previous file
 * stays served), or skipped (options missing, or a build already running in
 * any process). A build longer than 20 s goes on in the background and the
 * answer is `started`: the admin shows the build when the status refreshes.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const run: Promise<FeedBuildResult> = buildCeneoFeedWorkflow(req.scope)
    .run({ input: { trigger: "manual" } })
    .then(({ result }) => result as FeedBuildResult)
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = new Promise<"waited">((resolve) => {
    timer = setTimeout(() => resolve("waited"), WAIT_MS)
  })
  try {
    const first = await Promise.race([run, waited])
    if (first !== "waited") {
      res.json(first satisfies FeedBuildAnswer)
      return
    }
  } finally {
    clearTimeout(timer)
  }
  /* The answer is sent; an error of the background build only reaches the log (the build row records a failure itself). */
  run.catch((err: unknown) => ceneoSvc(req.scope).getLogger().error(`[ceneo] Feed build in the background stopped: ${errorText(err)}`))
  res.json({ status: "started" } satisfies FeedBuildAnswer)
}
