import type { MedusaContainer } from "@medusajs/framework/types"
import { EVENTS_SCHEDULE } from "../modules/subiekt/lib/constants"
import { checkConnection } from "../workflows/subiekt/health"
import { getConnection, subiektService } from "../workflows/subiekt/runtime"
import { pullSubiektEventsWorkflow } from "../workflows/subiekt/pull-subiekt-events"
import { runStockSync } from "../workflows/subiekt/sync-subiekt-stock"

const HEALTH_EVERY_MS = 10 * 60 * 1000

/**
 * DOCUMENTS FROM SUBIEKT, EVERY 2 MINUTES: reads the bridge event feed (a WZ
 * the warehouse issued) and, every 10 minutes, the bridge health, so the
 * admin shows the Subiekt version and connection without anyone clicking.
 * A `stock.changed` event starts a stock sync right away.
 */
export default async function subiektPullEventsJob(container: MedusaContainer): Promise<void> {
  const svc = subiektService(container)
  if (!svc.isDemo() && !svc.isConfigured()) return

  const conn = await getConnection(svc)
  const checkedAt = conn.checked_at ? new Date(conn.checked_at).getTime() : 0
  if (Date.now() - checkedAt > HEALTH_EVERY_MS) await checkConnection(container, "schedule")

  if (!svc.getOptions().eventsEnabled) return
  const { result } = await pullSubiektEventsWorkflow(container).run({ input: { trigger: "schedule" } })
  if (result?.stockChanged) await runStockSync(container, "event")
}

export const config = {
  name: "subiekt-pull-events",
  schedule: EVENTS_SCHEDULE,
}
