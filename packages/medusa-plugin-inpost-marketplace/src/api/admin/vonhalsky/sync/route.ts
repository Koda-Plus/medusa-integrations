import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SYNC_PARTS, runSync, type SyncPart } from "../../../../workflows/vonhalsky/sync"
import { clientOf } from "../../../../workflows/vonhalsky/runtime"

/**
 * POST /admin/vonhalsky/sync { parts? }: runs the sync now (what the job
 * does every 5 minutes), all parts or the ones named. Joins a run already
 * in progress. Answers what each part did.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!clientOf(req.scope)) {
    res.status(409).json({ code: "not_configured", message: "The plugin has no credentials and is not in demo mode." })
    return
  }
  const asked = (req.body as { parts?: unknown } | undefined)?.parts
  const parts = Array.isArray(asked) ? SYNC_PARTS.filter((p) => asked.includes(p)) : [...SYNC_PARTS]
  res.json({ report: await runSync(req.scope, parts.length ? (parts as SyncPart[]) : [...SYNC_PARTS]) })
}
