/**
 * From Railway's shapes to the panel's: status mapping, deployments with
 * their commit and duration, services with the active deployment and the
 * uptime, domains, volumes, log lines (masked, newest first, error lines
 * told apart) and variables reduced to names.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { commitOf, countErrors, deployState, deploymentOf, domainsOf, isErrorLine, serviceKind, serviceOf, severityOf, shapeLogs, sortServices, toneOfState, variableNames } from "../src/modules/railway/lib/normalize.ts"
import { DashboardLinks } from "../src/modules/railway/lib/dashboard.ts"
import { nodesOf } from "../src/modules/railway/lib/railway-types.ts"
import { DEP_API, DEP_WEB_FAILED, DEP_WEB_OK, ENV, PROJECT, SVC_API, SVC_PG, SVC_WEB, logsAnswer, overviewAnswer, rawDeployment, TOKEN } from "./fixtures.ts"

const links = new DashboardLinks("https://railway.com", PROJECT, ENV)

test("status: every Railway status maps to a state and a tone, unknown words too", () => {
  const cases: Array<[string, string, string]> = [
    ["SUCCESS", "success", "green"],
    ["BUILDING", "building", "blue"],
    ["DEPLOYING", "deploying", "blue"],
    ["INITIALIZING", "deploying", "blue"],
    ["QUEUED", "queued", "blue"],
    ["WAITING", "waiting", "orange"],
    ["NEEDS_APPROVAL", "waiting", "orange"],
    ["FAILED", "failed", "red"],
    ["CRASHED", "crashed", "red"],
    ["SLEEPING", "sleeping", "grey"],
    ["REMOVED", "removed", "grey"],
    ["REMOVING", "removed", "grey"],
    ["SKIPPED", "skipped", "grey"],
    ["SOMETHING_NEW", "unknown", "grey"],
  ]
  for (const [status, state, tone] of cases) {
    assert.equal(deployState(status), state, status)
    assert.equal(toneOfState(deployState(status)), tone, status)
  }
  assert.equal(deployState("success"), "success")
  assert.equal(deployState(null), "unknown")
})

test("deployment: commit, short SHA, author, duration and the dashboard link", () => {
  const d = deploymentOf(rawDeployment(DEP_API, "SUCCESS", "2026-10-01T10:00:00.000Z", { staticUrl: "api.example.com" }), links, SVC_API)!
  assert.equal(d.state, "success")
  assert.equal(d.commit?.short, "0123456")
  assert.equal(d.commit?.message, "fix: cart totals", "only the first line of the message")
  assert.equal(d.commit?.author, "Anna Nowak")
  assert.equal(d.durationMs, 150_000)
  assert.equal(d.url, "https://api.example.com")
  assert.equal(d.dashboardUrl, `https://railway.com/project/${PROJECT}/service/${SVC_API}?environmentId=${ENV}&id=${DEP_API}`)
  /* Still building: no duration yet. */
  assert.equal(deploymentOf(rawDeployment(DEP_API, "BUILDING", "2026-10-01T10:00:00.000Z"), links, SVC_API)!.durationMs, null)
  assert.equal(deploymentOf({ status: "SUCCESS" }, links, SVC_API), null, "no id, no deployment")
})

test("commit: a secret pasted into a commit message is masked; no meta, no commit", () => {
  const c = commitOf({ commitMessage: `chore: rotate ${TOKEN}`, commitHash: "abc" }, [TOKEN])!
  assert.equal(c.message, "chore: rotate ***")
  assert.equal(commitOf(null), null)
  assert.equal(commitOf({ image: "redis:7" }), null)
})

test("services: apps before databases, the active deployment serves while the latest failed, kinds from the image", () => {
  const raw = overviewAnswer(Date.parse("2026-10-01T12:00:00Z"))
  const volumes = nodesOf(raw.environment.volumeInstances)
  const services = sortServices(nodesOf(raw.environment.serviceInstances).map((s) => serviceOf(s, { links, volumes })!))
  assert.deepEqual(services.map((s) => s.name), ["backend", "storefront", "Postgres"])
  const web = services.find((s) => s.id === SVC_WEB)!
  assert.equal(web.latest?.id, DEP_WEB_FAILED)
  assert.equal(web.latest?.state, "failed")
  assert.equal(web.active?.id, DEP_WEB_OK)
  assert.equal(web.upSince, web.active?.updatedAt)
  assert.equal(web.instances.running, 1)
  const pg = services.find((s) => s.id === SVC_PG)!
  assert.equal(pg.kind, "postgres")
  assert.equal(pg.volumes[0].pct, 96)
  assert.equal(pg.volumes[0].name, "pg-data")
  assert.equal(services.find((s) => s.id === SVC_API)!.kind, "app")
  assert.equal(serviceKind("cache", "redis:7", null), "redis")
  assert.equal(serviceKind("Postgres", null, null), "postgres")
  assert.equal(serviceKind("mysql", "mariadb:11", null), "mysql")
})

test("domains: a custom domain not verified is not ok, Railway domains are ok while active", () => {
  const d = domainsOf({
    serviceDomains: [{ domain: "a.up.railway.app", syncStatus: "ACTIVE" }, { domain: "b.up.railway.app", syncStatus: "DELETING" }],
    customDomains: [
      { domain: "shop.example.com", status: { verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALID" } },
      { domain: "new.example.com", status: { verified: false, certificateStatus: "CERTIFICATE_STATUS_TYPE_PENDING" } },
      { domain: "cert.example.com", status: { verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_ERROR", certificateErrorMessage: "CAA record blocks issuance" } },
    ],
  })
  const by = Object.fromEntries(d.map((x) => [x.domain, x]))
  assert.equal(by["shop.example.com"].ok, true)
  assert.equal(by["new.example.com"].ok, false)
  assert.equal(by["cert.example.com"].ok, false)
  assert.equal(by["cert.example.com"].note, "CAA record blocks issuance")
  assert.equal(by["a.up.railway.app"].ok, true)
  assert.equal(by["b.up.railway.app"].ok, false)
})

test("logs: newest first, masked, error lines told apart, filter and search after masking", () => {
  const now = Date.parse("2026-10-01T12:00:00Z")
  const raw = logsAnswer(now).deploymentLogs
  const all = shapeLogs(raw)
  assert.equal(all.lines.length, 5)
  assert.ok(all.lines[0].ts > all.lines[1].ts, "newest first")
  assert.equal(all.masked, 1)
  assert.ok(all.lines.some((l) => l.message === "Connecting to postgres://medusa:***@db.internal:5432/railway"))
  assert.ok(!JSON.stringify(all).includes("hunter"), "the password never reaches the DTO")
  const errors = shapeLogs(raw, { errorsOnly: true })
  assert.deepEqual(errors.lines.map((l) => l.message), ["Unhandled rejection", "http POST /store/carts/c_1/complete 500 2011 ms", "error: Payment provider timed out"])
  assert.equal(shapeLogs(raw, { q: "PAYMENT" }).lines.length, 1)
  /* A search for the secret finds nothing: it runs over the masked text. */
  assert.equal(shapeLogs(raw, { q: "hunter" }).lines.length, 0)
  assert.equal(shapeLogs(raw, { sinceMs: now - 6 * 60_000 }).lines.length, 2)
  assert.equal(countErrors(raw, now - 60 * 60_000), 3)
})

test("error lines: severities, error words, 5xx statuses; ordinary lines are not errors", () => {
  assert.equal(severityOf("ERROR"), "error")
  assert.equal(severityOf("fatal"), "error")
  assert.equal(severityOf("warning"), "warn")
  assert.equal(severityOf("debug"), "debug")
  assert.equal(severityOf(undefined), "info")
  assert.ok(isErrorLine("info", "TypeError: x is undefined"))
  assert.ok(isErrorLine("info", '127.0.0.1 "GET /store/carts HTTP/1.1" 502 12'))
  assert.ok(isErrorLine("info", "request finished status=503"))
  assert.ok(!isErrorLine("info", "GET /store/products 200 12 ms"))
  assert.ok(!isErrorLine("info", "build finished with 0 errors"))
  assert.ok(!isErrorLine("warn", "slow query 1500 ms"))
})

test("variables: names with set, empty or reference; values never come out", () => {
  const items = variableNames({ STRIPE_READ_KEY: "rk_live_abc", KODA_ADMIN_PASSWORD: "", DATABASE_URL: "${{Postgres.DATABASE_URL}}", "bad name": "x", PORT: 9000, NULLED: null })
  assert.deepEqual(items, [
    { name: "DATABASE_URL", state: "reference" },
    { name: "KODA_ADMIN_PASSWORD", state: "empty" },
    { name: "NULLED", state: "empty" },
    { name: "PORT", state: "set" },
    { name: "STRIPE_READ_KEY", state: "set" },
  ])
  assert.ok(!JSON.stringify(items).includes("rk_live"))
  assert.deepEqual(variableNames(null), [])
  assert.deepEqual(variableNames(["x"]), [])
})
