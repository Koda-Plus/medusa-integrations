/**
 * HOUSEKEEPING OF THE SEND LOG, every hour:
 *   - rows still `sending` after their lease become `unknown` (the process
 *     stopped mid-send; the message may have gone out, a person decides);
 *   - live rows older than `logRetentionDays` are deleted (0 keeps them);
 *   - the simulated outbox keeps two weeks;
 *   - in demo mode, a stale seed of the outbox is rebuilt with fresh dates,
 *     so the public demo looks alive even when nobody opens the page.
 * Only the plugin's own rows are touched, never Medusa's data.
 */

import { DEMO_KEEP_DAYS } from "../../modules/emails/lib/constants"
import { isMissingTable } from "../../modules/emails/lib/store"
import { ensureDemoOutbox } from "./demo"
import { emailsService, exclusive, storeFor, type Scope } from "./runtime"

const DAY = 24 * 3600 * 1000

export interface HousekeepingRun {
  expired: number
  pruned: number
  prunedDemo: number
  /** Rows of the demo outbox written or refreshed by a rebuild of its seed. */
  seeded: number
}

export async function runHousekeeping(scope: Scope, now: Date = new Date()): Promise<HousekeepingRun | null> {
  return exclusive("housekeeping", async () => {
    const svc = emailsService(scope)
    const o = svc.getOptions()
    const store = storeFor(scope)
    const run: HousekeepingRun = { expired: 0, pruned: 0, prunedDemo: 0, seeded: 0 }
    try {
      run.expired = await store.expireLeases(now)
      run.pruned = o.logRetentionDays > 0 ? await store.prune(new Date(now.getTime() - o.logRetentionDays * DAY), false) : 0
      run.prunedDemo = await store.prune(new Date(now.getTime() - DEMO_KEEP_DAYS * DAY), true)
      if (run.expired > 0) svc.getLogger().warn(`[emails] ${run.expired} message(s) stopped mid-send and are marked unknown; see the E-mails page.`)
    } catch (err) {
      if (!isMissingTable(err)) svc.getLogger().warn(`[emails] Housekeeping: ${svc.mask((err as Error)?.message ?? String(err))}`)
      return run
    }
    if (svc.isDemo()) {
      try {
        run.seeded = await ensureDemoOutbox(scope, now)
      } catch (err) {
        if (!isMissingTable(err)) svc.getLogger().warn(`[emails] Demo outbox: ${svc.mask((err as Error)?.message ?? String(err))}`)
      }
    }
    return run
  })
}
