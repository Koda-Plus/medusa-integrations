/**
 * THE EXPIRY PASS: active threads past their expiry close as `expired`.
 *
 * Every hour (the `negotiations-expire` job) and on "Expire stale threads
 * now" in Settings. A thread is due when a counter offer's validity ran out,
 * or, without one, when nobody moved for `expiryDays` (`lib/expiry.ts`).
 * Each pass closes at most 500 threads per batch and ten batches: one
 * conditional update per batch (`for update skip locked`, so two processes
 * never close the same thread), a system message on each, then
 * `negotiation.expired` for each.
 *
 * Live threads only. Demo threads are a fixed story with its own expired
 * thread: in demo mode the pass changes nothing and says so.
 */

import { EXPIRE_BATCH, EXPIRED_TEXT, isStatus } from "../../modules/negotiations/lib/constants"
import type { RunDto, RunTrigger } from "../../modules/negotiations/lib/contract"
import { eventData, NEGOTIATION_EXPIRED } from "../../modules/negotiations/lib/events"
import { activityCutoff } from "../../modules/negotiations/lib/expiry"
import { emitEvent, envOf, exclusive, newId, normalize, recordRun, type Scope } from "./runtime"

const MAX_BATCHES = 10

export async function expireNegotiations(scope: Scope, trigger: RunTrigger): Promise<RunDto | null> {
  const env = await envOf(scope)
  if (env.options.demo) {
    if (trigger === "schedule") return null
    return recordRun(scope, true, {
      kind: "expire",
      trigger,
      status: "skipped",
      startedAt: env.now,
      counts: { expired: 0 },
      message: "Demo mode: demo threads keep their story and never expire on their own.",
    })
  }
  return exclusive("expire", async () => {
    const started = new Date()
    const now = new Date()
    const cutoff = activityCutoff(now, env.options.expiryDays)
    let expired = 0
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const closed = await env.stores.threads.expireDue({
          demo: false,
          now,
          cutoff,
          limit: EXPIRE_BATCH,
          message: (row) => ({
            id: newId("negmsg"),
            negotiation_id: row.id,
            author_type: "system",
            author_id: null,
            kind: "expired",
            body: EXPIRED_TEXT,
            amount: null,
            internal: false,
            metadata: null,
            created_at: now,
          }),
        })
        for (const c of closed) {
          const thread = normalize(env, c.thread)
          await emitEvent(
            scope,
            NEGOTIATION_EXPIRED,
            eventData(thread, {
              previousStatus: isStatus(c.previousStatus) ? c.previousStatus : null,
              actor: "system",
              actorId: null,
              messageId: c.message?.id ?? null,
            }) as unknown as Record<string, unknown>,
          )
        }
        expired += closed.length
        if (closed.length < EXPIRE_BATCH) break
      }
      return recordRun(scope, false, { kind: "expire", trigger, status: "ok", startedAt: started, counts: { expired } })
    } catch (err) {
      return recordRun(scope, false, { kind: "expire", trigger, status: expired > 0 ? "partial" : "error", startedAt: started, counts: { expired }, message: (err as Error)?.message ?? String(err) })
    }
  })
}
