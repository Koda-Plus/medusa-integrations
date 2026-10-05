/**
 * HEALTH: one call to `GET /v1/health`, which on the bridge side logs in to
 * Sfera. The answer is stored on the connection row for the admin. A run is
 * recorded when someone clicked, or when the state flips, not every time.
 */

import type { BridgeHealth, RunTrigger } from "../../modules/subiekt/lib/contract"
import { describeError } from "../../modules/subiekt/lib/bridge-client"
import { bridgeFor, exclusive, getConnection, markReachable, markUnreachable, recordRun, subiektService, type Scope } from "./runtime"

export interface HealthResult {
  ok: boolean
  health: BridgeHealth | null
  error: string | null
}

export async function checkConnection(scope: Scope, trigger: RunTrigger): Promise<HealthResult | null> {
  return exclusive("health", async () => {
    const svc = subiektService(scope)
    if (!svc.isDemo() && !svc.isConfigured()) {
      return { ok: false, health: null, error: `Missing plugin options: ${svc.missingOptions().join(", ")}.` }
    }
    const before = await getConnection(svc)
    const startedAt = new Date()
    try {
      const health = await bridgeFor(scope).health()
      const subiektOk = Boolean(health.subiekt?.connected)
      await markReachable(svc, {
        health: health as unknown as Record<string, unknown>,
        checked_at: new Date(),
        ...(subiektOk ? {} : { last_error: health.subiekt?.error ?? "The bridge answers, but it cannot log in to Subiekt.", last_error_at: new Date() }),
      })
      if (trigger === "manual" || !before.reachable) {
        await recordRun(svc, {
          kind: "health",
          trigger,
          status: subiektOk ? "success" : "partial",
          startedAt,
          stats: { bridge: health.bridge?.version ?? null, subiekt: health.subiekt?.version ?? null, database: health.subiekt?.database ?? null },
          message: subiektOk ? "Bridge and Subiekt answer." : `Bridge answers, Subiekt does not: ${health.subiekt?.error ?? "unknown error"}`,
        })
      }
      return { ok: subiektOk, health, error: subiektOk ? null : health.subiekt?.error ?? null }
    } catch (err) {
      const d = describeError(err)
      await markUnreachable(svc, d.message)
      await svc.updateSubiektConnections({ id: before.id, checked_at: new Date() } as never)
      if (trigger === "manual" || before.reachable) {
        await recordRun(svc, { kind: "health", trigger, status: "error", startedAt, message: `[${d.code}] ${d.message}` })
      }
      return { ok: false, health: null, error: d.message }
    }
  })
}
