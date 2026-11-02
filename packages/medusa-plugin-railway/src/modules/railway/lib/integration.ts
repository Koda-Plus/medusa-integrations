/**
 * Railway in the koda.integration/1 contract, the pure part: board counters
 * from the problems of the last overview. No runtime imports beyond the
 * pure helpers, testable without a container.
 */
import type { ProblemDto } from "./contract"

export interface CounterLike {
  key: string
  scope: "integration"
  count: number
  tone: "red" | "orange"
  link: { kind: "admin"; href: string }
}

const services = (list: ProblemDto[]) => new Set(list.map((p) => p.serviceId)).size

/** One counter per kind of trouble, counted in services; zero counters are left out. */
export function railwayCounters(problems: ProblemDto[]): CounterLike[] {
  const failing = problems.filter((p) => p.key === "deploy_failed" || p.key === "deploy_crashed" || p.key === "instance_crashed")
  const resources = problems.filter((p) => p.key === "memory_high" || p.key === "volume_full")
  const errors = problems.filter((p) => p.key === "errors_many")
  const out: CounterLike[] = []
  if (failing.length) out.push({ key: "deploys_failing", scope: "integration", count: services(failing), tone: "red", link: { kind: "admin", href: "/railway?filter=problems" } })
  if (resources.length) out.push({ key: "resources_high", scope: "integration", count: services(resources), tone: resources.some((p) => p.tone === "red") ? "red" : "orange", link: { kind: "admin", href: "/railway?filter=problems" } })
  if (errors.length) out.push({ key: "errors_high", scope: "integration", count: services(errors), tone: errors.some((p) => p.tone === "red") ? "red" : "orange", link: { kind: "admin", href: "/railway?filter=problems" } })
  return out
}
