/**
 * HEALTH: one call to `GET /v1/health`, which on the bridge side logs in to
 * Sfera. The answer is stored on the connection row for the admin, with what
 * the call itself taught us (0.2.0): the round trip, the clock skew between
 * Medusa and the bridge (more than 300 seconds and every signature fails) and
 * the signature verdict. A run is recorded when someone clicked, or when the
 * state flips, not every time.
 */

import type { BridgeHealth, RunTrigger } from "../../modules/subiekt/lib/contract"
import { describeError } from "../../modules/subiekt/lib/bridge-client"
import { clockSkewMs, signatureState } from "../../modules/subiekt/lib/diagnostics"
import { bridgeFor, exclusive, getConnection, markReachable, markUnreachable, recordRun, saveConnection, subiektService, type Scope } from "./runtime"

export interface HealthResult {
  ok: boolean
  health: BridgeHealth | null
  error: string | null
  latencyMs: number | null
  clockSkewMs: number | null
}

/** Merges keys into the diagnostics JSON of the connection row without dropping the others. */
export async function patchDiagnostics(scope: Scope, patch: Record<string, unknown>): Promise<void> {
  const svc = subiektService(scope)
  const conn = await getConnection(svc)
  await saveConnection(svc, { diagnostics: { ...((conn.diagnostics as Record<string, unknown> | null) ?? {}), ...patch } })
}

export async function checkConnection(scope: Scope, trigger: RunTrigger): Promise<HealthResult | null> {
  return exclusive("health", async () => {
    const svc = subiektService(scope)
    if (!svc.isDemo() && !svc.isConfigured()) {
      return { ok: false, health: null, error: `Missing plugin options: ${svc.missingOptions().join(", ")}.`, latencyMs: null, clockSkewMs: null }
    }
    const before = await getConnection(svc)
    const previous = (before.diagnostics as Record<string, unknown> | null) ?? {}
    const startedAt = new Date()
    const started = Date.now()
    try {
      const health = await bridgeFor(scope).health()
      const finished = Date.now()
      const latencyMs = finished - started
      const skew = clockSkewMs(health.time, started, finished)
      const subiektOk = Boolean(health.subiekt?.connected)
      await markReachable(svc, {
        health: health as unknown as Record<string, unknown>,
        checked_at: new Date(),
        latency_ms: latencyMs,
        clock_skew_ms: skew,
        diagnostics: { ...previous, signature: signatureState(null, true), signatureAt: new Date().toISOString() },
        ...(subiektOk ? {} : { last_error: health.subiekt?.error ?? "The bridge answers, but it cannot log in to Subiekt.", last_error_at: new Date() }),
      })
      if (trigger === "manual" || !before.reachable) {
        await recordRun(svc, {
          kind: "health",
          trigger,
          status: subiektOk ? "success" : "partial",
          startedAt,
          stats: {
            bridge: health.bridge?.version ?? null,
            contract: health.bridge?.contract ?? null,
            subiekt: health.subiekt?.version ?? null,
            database: health.subiekt?.database ?? null,
            capabilities: health.capabilities ?? null,
            latencyMs,
            clockSkewMs: skew,
          },
          message: subiektOk ? "Bridge and Subiekt answer." : `Bridge answers, Subiekt does not: ${health.subiekt?.error ?? "unknown error"}`,
        })
      }
      return { ok: subiektOk, health, error: subiektOk ? null : health.subiekt?.error ?? null, latencyMs, clockSkewMs: skew }
    } catch (err) {
      const d = describeError(err)
      await markUnreachable(svc, d.message)
      await saveConnection(svc, {
        checked_at: new Date(),
        latency_ms: null,
        diagnostics: { ...previous, signature: signatureState(d.code, false), signatureAt: new Date().toISOString(), lastCode: d.code },
      })
      if (trigger === "manual" || before.reachable) {
        await recordRun(svc, { kind: "health", trigger, status: "error", startedAt, message: `[${d.code}] ${d.message}` })
      }
      return { ok: false, health: null, error: d.message, latencyMs: null, clockSkewMs: null }
    }
  })
}
