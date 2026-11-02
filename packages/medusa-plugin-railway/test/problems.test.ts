/**
 * The "Problems" tile: what needs a person, worst first, and the board
 * counters built from it.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { problemsOf, serviceTone } from "../src/modules/railway/lib/problems.ts"
import { railwayCounters } from "../src/modules/railway/lib/integration.ts"
import type { DeploymentDto, ServiceDto } from "../src/modules/railway/lib/contract.ts"

const NOW = Date.parse("2026-10-01T12:00:00Z")

function dep(state: DeploymentDto["state"], minutesAgo = 60): DeploymentDto {
  return { id: `d-${state}-${minutesAgo}`, status: state.toUpperCase(), state, tone: "grey", createdAt: new Date(NOW - minutesAgo * 60_000).toISOString(), updatedAt: null, durationMs: null, commit: null, creator: null, url: null, dashboardUrl: null }
}

function svc(name: string, patch: Partial<ServiceDto> = {}): ServiceDto {
  return {
    id: `svc-${name}`,
    name,
    kind: "app",
    repo: null,
    image: null,
    region: null,
    replicas: 1,
    latest: dep("success"),
    active: dep("success"),
    upSince: null,
    instances: { total: 1, running: 1, crashed: 0, restarting: 0 },
    domains: [],
    volumes: [],
    memory: null,
    errorsLastHour: 0,
    errorsCapped: false,
    dashboardUrl: null,
    ...patch,
  }
}

test("a healthy project has no problems", () => {
  assert.deepEqual(problemsOf([svc("backend"), svc("Postgres", { kind: "postgres", errorsLastHour: null })], NOW), [])
})

test("failed and crashed deployments, crashed and restarting instances", () => {
  const p = problemsOf(
    [
      svc("storefront", { latest: dep("failed") }),
      svc("backend", { latest: dep("crashed"), active: null, instances: { total: 1, running: 0, crashed: 1, restarting: 0 } }),
      svc("worker", { instances: { total: 2, running: 1, crashed: 0, restarting: 1 } }),
      svc("cron", { instances: { total: 1, running: 0, crashed: 1, restarting: 0 } }),
    ],
    NOW,
  )
  const keys = p.map((x) => `${x.serviceName}:${x.key}:${x.tone}`)
  assert.ok(keys.includes("storefront:deploy_failed:red"))
  assert.ok(keys.includes("backend:deploy_crashed:red"))
  assert.ok(!keys.includes("backend:instance_crashed:red"), "a crashed deployment is not counted twice")
  assert.ok(keys.includes("cron:instance_crashed:red"))
  assert.ok(keys.includes("worker:instance_restarting:orange"))
  assert.equal(p[p.length - 1].tone, "orange", "worst first")
  assert.equal(p.find((x) => x.key === "deploy_failed")!.params.serving, 1, "the previous deployment still serves")
})

test("memory and volumes near the limit: orange from 85 %, red from 95 %", () => {
  const p = problemsOf(
    [
      svc("a", { memory: { usedGb: 0.86, limitGb: 1, pct: 86 } }),
      svc("b", { memory: { usedGb: 0.97, limitGb: 1, pct: 97 } }),
      svc("c", { memory: { usedGb: 0.5, limitGb: 1, pct: 50 } }),
      svc("pg", { kind: "postgres", volumes: [{ id: "v", name: "pg-data", mountPath: "/data", sizeMB: 5000, usedMB: 4800, pct: 96, state: "READY" }] }),
    ],
    NOW,
  )
  assert.deepEqual(
    p.map((x) => [x.serviceName, x.key, x.tone, x.params.pct]),
    [
      ["b", "memory_high", "red", 97],
      ["pg", "volume_full", "red", 96],
      ["a", "memory_high", "orange", 86],
    ],
  )
  assert.equal(p.find((x) => x.key === "volume_full")!.params.volume, "pg-data")
})

test("many errors in the last hour, an unverified custom domain, a build stuck for long", () => {
  const p = problemsOf(
    [
      svc("api", { errorsLastHour: 120, errorsCapped: true }),
      svc("web", { errorsLastHour: 25, domains: [{ domain: "shop.example.com", kind: "custom", ok: false, note: "not verified" }, { domain: "x.up.railway.app", kind: "railway", ok: false, note: null }] }),
      svc("job", { latest: dep("building", 45), errorsLastHour: 19 }),
      svc("quick", { latest: dep("building", 5) }),
    ],
    NOW,
  )
  const by = (name: string) => p.filter((x) => x.serviceName === name).map((x) => `${x.key}:${x.tone}`)
  assert.deepEqual(by("api"), ["errors_many:red"])
  assert.equal(p.find((x) => x.serviceName === "api")!.params.capped, 1)
  assert.deepEqual(by("web").sort(), ["domain_issue:orange", "errors_many:orange"])
  assert.deepEqual(by("job"), ["building_long:orange"], "19 errors stay under the threshold")
  assert.deepEqual(by("quick"), [])
  assert.equal(serviceTone(p, "svc-api"), "red")
  assert.equal(serviceTone(p, "svc-web"), "orange")
  assert.equal(serviceTone(p, "svc-quick"), null)
})

test("counters: counted in services, tone of the worst, links to the problems filter", () => {
  const p = problemsOf(
    [
      svc("storefront", { latest: dep("failed"), memory: { usedGb: 0.9, limitGb: 1, pct: 90 } }),
      svc("backend", { latest: dep("crashed"), active: null, errorsLastHour: 300 }),
      svc("pg", { kind: "postgres", volumes: [{ id: "v", name: "v", mountPath: "/", sizeMB: 100, usedMB: 99, pct: 99, state: null }] }),
    ],
    NOW,
  )
  const c = railwayCounters(p)
  assert.deepEqual(
    c.map((x) => [x.key, x.count, x.tone]),
    [
      ["deploys_failing", 2, "red"],
      ["resources_high", 2, "red"],
      ["errors_high", 1, "red"],
    ],
  )
  for (const x of c) assert.equal(x.link.href, "/railway?filter=problems")
  assert.deepEqual(railwayCounters([]), [])
})
