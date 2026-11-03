/**
 * WHAT NEEDS A PERSON. No runtime imports beyond the pure helpers.
 *
 * From the overview of the services: a last deployment that failed or
 * crashed, an instance that crashed or keeps restarting, memory or a volume
 * near its limit, many error lines in the last hour, a custom domain that is
 * not verified or has no valid certificate, a build stuck for long. Red is
 * down or about to be; orange is a warning. Worst first.
 */
import { ERRORS_RED, ERRORS_WARN, MEMORY_RED_PCT, MEMORY_WARN_PCT, VOLUME_RED_PCT, VOLUME_WARN_PCT } from "./constants"
import type { ProblemDto, ServiceDto } from "./contract"
import { inProgress } from "./normalize"

export interface ProblemThresholds {
  memoryWarnPct: number
  memoryRedPct: number
  volumeWarnPct: number
  volumeRedPct: number
  errorsWarn: number
  errorsRed: number
  /** A deployment building or deploying longer than this is reported (minutes). */
  buildingLongMinutes: number
}

export const DEFAULT_THRESHOLDS: ProblemThresholds = {
  memoryWarnPct: MEMORY_WARN_PCT,
  memoryRedPct: MEMORY_RED_PCT,
  volumeWarnPct: VOLUME_WARN_PCT,
  volumeRedPct: VOLUME_RED_PCT,
  errorsWarn: ERRORS_WARN,
  errorsRed: ERRORS_RED,
  buildingLongMinutes: 30,
}

export function problemsOf(services: ServiceDto[], now: number = Date.now(), th: ProblemThresholds = DEFAULT_THRESHOLDS): ProblemDto[] {
  const out: ProblemDto[] = []
  const add = (s: ServiceDto, key: ProblemDto["key"], tone: ProblemDto["tone"], params: ProblemDto["params"] = {}) =>
    out.push({ key, tone, serviceId: s.id, serviceName: s.name, params })

  for (const s of services) {
    const latest = s.latest
    if (latest?.state === "failed") add(s, "deploy_failed", "red", { serving: s.active ? 1 : 0 })
    if (latest?.state === "crashed") add(s, "deploy_crashed", "red")
    if (latest && inProgress(latest.state) && latest.createdAt) {
      const minutes = Math.floor((now - Date.parse(latest.createdAt)) / 60_000)
      if (minutes >= th.buildingLongMinutes) add(s, "building_long", "orange", { minutes })
    }
    if (s.instances.crashed > 0 && latest?.state !== "crashed") add(s, "instance_crashed", "red", { count: s.instances.crashed })
    else if (s.instances.restarting > 0) add(s, "instance_restarting", "orange", { count: s.instances.restarting })

    const mem = s.memory?.pct
    if (typeof mem === "number" && mem >= th.memoryWarnPct) add(s, "memory_high", mem >= th.memoryRedPct ? "red" : "orange", { pct: Math.round(mem) })

    for (const v of s.volumes) {
      if (typeof v.pct === "number" && v.pct >= th.volumeWarnPct) add(s, "volume_full", v.pct >= th.volumeRedPct ? "red" : "orange", { pct: Math.round(v.pct), volume: v.name })
    }

    const errors = s.errorsLastHour
    if (typeof errors === "number" && errors >= th.errorsWarn) add(s, "errors_many", errors >= th.errorsRed ? "red" : "orange", { count: errors, capped: s.errorsCapped ? 1 : 0 })

    for (const d of s.domains) if (d.kind === "custom" && d.ok === false) add(s, "domain_issue", "orange", { domain: d.domain })
  }
  const rank = (p: ProblemDto) => (p.tone === "red" ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || a.serviceName.localeCompare(b.serviceName))
}

/** The worst tone of a service's problems, for its card. */
export function serviceTone(problems: ProblemDto[], serviceId: string): "red" | "orange" | null {
  const mine = problems.filter((p) => p.serviceId === serviceId)
  if (mine.some((p) => p.tone === "red")) return "red"
  return mine.length ? "orange" : null
}
