/**
 * The reads end to end on a fake Railway: the identity of a project token
 * and the fallback to an account token, the overview (services, memory,
 * errors, problems) in three requests, the cache, ids from the browser
 * checked against the project, logs masked and filtered without a new
 * request, variables reduced to names, the options, and the demo mode
 * through the same code path.
 */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { loadRailwayDeployments, loadRailwayLogs, loadRailwayMetrics, loadRailwayOverview, loadRailwayVariables, resolveIdentity } from "../src/workflows/railway/reads.ts"
import { resolveOptions, missingOptions } from "../src/modules/railway/lib/options.ts"
import { RailwayApiError } from "../src/modules/railway/lib/errors.ts"
import { buildStatus } from "../src/api/admin/railway/helpers.ts"
import { DEP_API, DEP_WEB_FAILED, ENV, OTHER_PROJECT, PROJECT, SVC_API, SVC_PG, SVC_WEB, TOKEN, logsAnswer, overviewAnswer, standardRailway } from "./fixtures.ts"
import { TtlCache } from "../src/modules/railway/lib/cache.ts"
import { setCacheForTests } from "../src/workflows/railway/runtime.ts"
import { container } from "./harness.ts"

const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async () => {
    throw new Error("no network in tests")
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = realFetch
})

test("identity: a project token names its project and environment", async () => {
  const fake = standardRailway()
  const c = container(fake)
  assert.deepEqual(await resolveIdentity(c), { kind: "project", projectId: PROJECT, environmentId: ENV })
  await resolveIdentity(c)
  assert.deepEqual(fake.ops(), ["KodaRailwayProjectToken"], "the identity is read once")
})

test("identity: an account token falls back to Bearer with projectId and the production environment", async () => {
  const fake = standardRailway(Date.now(), {
    KodaRailwayProjectToken: () => ({ __status: 200, __body: { errors: [{ message: "Not Authorized" }] } }),
    KodaRailwayEnvironments: (_v, h) => (h.Authorization ? { project: { id: PROJECT, name: "shop", environments: { edges: [{ node: { id: "staging-env-1", name: "staging" } }, { node: { id: ENV, name: "production" } }] } } } : { __status: 200, __body: { errors: [{ message: "Not Authorized" }] } }),
  })
  const c = container(fake, { token: TOKEN, projectId: PROJECT })
  assert.deepEqual(await resolveIdentity(c), { kind: "account", projectId: PROJECT, environmentId: ENV })
  assert.deepEqual(fake.ops(), ["KodaRailwayProjectToken", "KodaRailwayEnvironments"])
})

test("identity: an account token without projectId says what to set", async () => {
  const c = container(standardRailway(), { token: TOKEN, tokenKind: "account" })
  assert.deepEqual(c.svc.missingOptions(), ["projectId"])
  const auto = container(
    standardRailway(Date.now(), { KodaRailwayProjectToken: () => ({ __status: 200, __body: { errors: [{ message: "Not Authorized" }] } }) }),
    { token: TOKEN },
  )
  await assert.rejects(() => resolveIdentity(auto), (err: RailwayApiError) => err.kind === "auth" && /projectId/.test(err.message))
})

test("overview: services, active deployment, memory, errors and problems in four requests, then from the cache", async () => {
  const fake = standardRailway()
  const c = container(fake)
  const o = await loadRailwayOverview(c)
  assert.deepEqual(fake.ops(), ["KodaRailwayProjectToken", "KodaRailwayOverview", "KodaRailwayMemory", "KodaRailwayErrorScan"])
  assert.equal(o.project.name, "shop")
  assert.equal(o.environment.name, "production")
  assert.deepEqual(o.services.map((s) => s.name), ["backend", "storefront", "Postgres"])
  const api = o.services.find((s) => s.id === SVC_API)!
  assert.equal(api.memory?.pct, 92)
  assert.equal(api.errorsLastHour, 30)
  /* The database is not scanned for errors. */
  assert.equal(o.services.find((s) => s.id === SVC_PG)!.errorsLastHour, null)
  const scan = fake.calls.find((x) => x.op === "KodaRailwayErrorScan")!
  assert.deepEqual(Object.keys(scan.variables).filter((k) => /^d\d+$/.test(k)).length, 2)
  const keys = o.problems.map((p) => `${p.serviceName}:${p.key}`)
  for (const k of ["storefront:deploy_failed", "Postgres:volume_full", "backend:memory_high", "backend:errors_many", "storefront:domain_issue"]) assert.ok(keys.includes(k), k)
  assert.equal(o.fresh, true)
  assert.equal(o.stale, false)
  assert.deepEqual(o.partial, [])
  assert.equal(o.dashboardUrl, `https://railway.com/project/${PROJECT}?environmentId=${ENV}`)

  const again = await loadRailwayOverview(c)
  assert.equal(again.fresh, false)
  assert.equal(fake.calls.length, 4, "a second view within cacheSeconds costs nothing")
})

test("overview: a failed metrics read leaves memory out and says so; the rest is shown", async () => {
  const fake = standardRailway(Date.now(), { KodaRailwayMemory: () => ({ __status: 200, __body: { errors: [{ message: "Problem processing request" }] } }) })
  const o = await loadRailwayOverview(container(fake))
  assert.deepEqual(o.partial, ["memory"])
  assert.equal(o.services.length, 3)
  assert.equal(o.services[0].memory, null)
})

test("overview: Railway down after a good read serves the last one as stale; a failure is remembered a minute", async () => {
  let down = false
  let t = Date.parse("2026-10-01T12:00:00Z")
  const fake = standardRailway(Date.now(), { KodaRailwayOverview: () => (down ? { __status: 503, __body: {} } : overviewAnswer()) })
  const c = container(fake)
  setCacheForTests(c.svc, new TtlCache({ now: () => t }))
  await loadRailwayOverview(c)
  down = true
  t += 120_000
  const stale = await loadRailwayOverview(c)
  assert.equal(stale.stale, true)
  assert.equal(stale.services.length, 3)
  const calls = fake.calls.length
  t += 20_000
  await loadRailwayOverview(c)
  assert.equal(fake.calls.length, calls, "the failure is remembered: no new request within a minute")
  /* Without any good read the error itself comes out, masked. */
  const fresh = container(standardRailway(Date.now(), { KodaRailwayOverview: () => ({ __status: 503, __body: {} }) }))
  await assert.rejects(() => loadRailwayOverview(fresh), (err: RailwayApiError) => err.kind === "railway")
})

test("ids from the browser: an unknown service is 404, a deployment of another project is 404", async () => {
  const fake = standardRailway(Date.now(), { KodaRailwayDeploymentLogs: () => logsAnswer(Date.now(), OTHER_PROJECT) })
  const c = container(fake)
  await assert.rejects(() => loadRailwayDeployments(c, "a0000000-0000-4000-8000-00000000dead"), (err: RailwayApiError) => err.kind === "not_found")
  await assert.rejects(() => loadRailwayVariables(c, "../../etc"), (err: RailwayApiError) => err.kind === "not_found")
  await assert.rejects(() => loadRailwayLogs(c, DEP_API), (err: RailwayApiError) => err.kind === "not_found")
  await assert.rejects(() => loadRailwayLogs(c, 'x"}'), (err: RailwayApiError) => err.kind === "not_found")
  assert.ok(!fake.ops().includes("KodaRailwayDeployments"), "no read for a service outside the environment")
})

test("deployments: newest first, with links into the dashboard", async () => {
  const d = await loadRailwayDeployments(container(standardRailway()), SVC_API)
  assert.deepEqual(d.items.map((x) => x.state), ["success", "removed"])
  assert.ok(d.items[0].dashboardUrl?.includes(`/service/${SVC_API}?environmentId=${ENV}&id=`))
})

test("logs: masked, newest first; the error filter and the search cost no request", async () => {
  const fake = standardRailway()
  const c = container(fake)
  const all = await loadRailwayLogs(c, DEP_API, { minutes: 60 })
  assert.equal(all.lines.length, 5)
  assert.equal(all.masked, 1)
  assert.ok(!JSON.stringify(all).includes("hunter"))
  assert.equal(all.serviceId, SVC_API)
  const logCall = fake.calls.find((x) => x.op === "KodaRailwayDeploymentLogs")!
  assert.equal(logCall.variables.deploymentId, DEP_API)
  assert.equal(typeof logCall.variables.startDate, "string")
  const before = fake.calls.length
  const errors = await loadRailwayLogs(c, DEP_API, { minutes: 60, errorsOnly: true })
  const search = await loadRailwayLogs(c, DEP_API, { minutes: 60, q: "payment" })
  assert.equal(errors.lines.length, 3)
  assert.equal(search.lines.length, 1)
  assert.equal(fake.calls.length, before, "filters run over the cached read")
  const build = await loadRailwayLogs(c, DEP_WEB_FAILED, { kind: "build" })
  assert.equal(build.kind, "build")
  assert.equal(build.lines[0].message, "Build failed")
  assert.equal(build.serviceId, SVC_WEB)
})

test("variables: names and set / empty / reference only, never a value", async () => {
  const v = await loadRailwayVariables(container(standardRailway()), SVC_API)
  assert.deepEqual(v.items, [
    { name: "DATABASE_URL", state: "reference" },
    { name: "JWT_SECRET", state: "set" },
    { name: "KODA_ADMIN_PASSWORD", state: "empty" },
    { name: "STRIPE_READ_KEY", state: "set" },
  ])
  const text = JSON.stringify(v)
  assert.ok(!text.includes("rk_live") && !text.includes("a-very-long-secret") && !text.includes("Postgres.DATABASE_URL"))
})

test("metrics: one request per service and range", async () => {
  const fake = standardRailway()
  const c = container(fake)
  const m = await loadRailwayMetrics(c, SVC_API, "6h")
  assert.equal(m.range, "6h")
  assert.equal(m.cpu.length, 5)
  assert.equal(m.memoryLimit, 1)
  const call = fake.calls.find((x) => x.op === "KodaRailwayServiceMetrics")!
  assert.equal(call.variables.sampleRateSeconds, 300)
  assert.equal(call.variables.serviceId, SVC_API)
})

test("status: never the token, the request counters, the setup when no token", () => {
  const configured = container(standardRailway())
  const s = buildStatus(configured)
  assert.equal(s.mode, "live")
  assert.ok(!JSON.stringify(s).includes(TOKEN))
  assert.equal(s.tokenEnv, "RAILWAY_READ_TOKEN")
  const none = buildStatus(container(null, {}))
  assert.equal(none.mode, "unconfigured")
  assert.deepEqual(none.missing, ["token"])
})

test("options: the token from the option or the environment variable, broken values fall back", () => {
  const env = { RAILWAY_READ_TOKEN: " from-env-token ", OTHER_TOKEN: "other-token-value" }
  assert.equal(resolveOptions({}, env).token, "from-env-token")
  assert.equal(resolveOptions({ tokenEnv: "OTHER_TOKEN" }, env).token, "other-token-value")
  assert.equal(resolveOptions({ token: "explicit-token" }, env).token, "explicit-token")
  assert.equal(resolveOptions({ tokenEnv: "bad name" }, env).tokenEnv, "RAILWAY_READ_TOKEN")
  const o = resolveOptions({ cacheSeconds: "5", requestsPerHour: "abc", tokenKind: "nonsense", projectId: "x/../y", dashboardUrl: "http://insecure.example.com", demo: "false" }, {})
  assert.equal(o.cacheSeconds, 15)
  assert.equal(o.requestsPerHour, 300)
  assert.equal(o.tokenKind, "auto")
  assert.equal(o.projectId, null)
  assert.equal(o.dashboardUrl, "https://railway.com")
  assert.equal(o.demo, false)
  assert.deepEqual(missingOptions(o), ["token"])
  assert.deepEqual(missingOptions(resolveOptions({ demo: true }, {})), [])
})

test("demo mode: the same code path on a sample project, no network", async () => {
  const c = container(null, { demo: true })
  const o = await loadRailwayOverview(c)
  assert.equal(o.mode, "demo")
  assert.equal(o.services.length, 5)
  assert.ok(o.problems.some((p) => p.key === "deploy_failed"))
  assert.ok(o.problems.some((p) => p.key === "volume_full"))
  const backend = o.services.find((s) => s.name === "backend")!
  const logs = await loadRailwayLogs(c, backend.active!.id)
  assert.ok(logs.masked > 0, "the demo logs show the masking at work")
  assert.ok(!JSON.stringify(logs).includes("demoPassword"))
  const vars = await loadRailwayVariables(c, backend.id)
  assert.ok(vars.items.some((v) => v.name === "ADMIN_PASSWORD" && v.state === "empty"))
  const m = await loadRailwayMetrics(c, backend.id, "1h")
  assert.ok(m.cpu.length > 30)
  assert.equal(buildStatus(c).mode, "demo")
})
