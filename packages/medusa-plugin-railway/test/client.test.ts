/**
 * The client: the right auth header per token kind, ids as variables, GraphQL
 * errors mapped to kinds with the token masked, one retry after a 429 or a
 * 5xx, the hourly budget, Railway's own rate limit counter.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { authHeaders, RailwayReadClient } from "../src/modules/railway/lib/client.ts"
import { Q_DEPLOYMENTS, Q_PROJECT_TOKEN } from "../src/modules/railway/lib/queries.ts"
import { RailwayApiError } from "../src/modules/railway/lib/errors.ts"
import { FakeRailway, PROJECT, TOKEN } from "./fixtures.ts"
import { noSleep } from "./harness.ts"

test("auth: a project token goes as Project-Access-Token, an account token as Bearer", async () => {
  assert.deepEqual(authHeaders("t", "project"), { "Project-Access-Token": "t" })
  assert.deepEqual(authHeaders("t", "account"), { Authorization: "Bearer t" })
  const fake = new FakeRailway({ KodaRailwayProjectToken: () => ({ projectToken: { projectId: PROJECT, environmentId: "e" } }) })
  const client = new RailwayReadClient({ token: TOKEN, fetch: fake.fetch, clock: noSleep })
  await client.query(Q_PROJECT_TOKEN, {}, "project")
  await client.query(Q_PROJECT_TOKEN, {}, "account")
  assert.equal(fake.calls[0].headers["Project-Access-Token"], TOKEN)
  assert.equal(fake.calls[0].headers.Authorization, undefined)
  assert.equal(fake.calls[1].headers.Authorization, `Bearer ${TOKEN}`)
  assert.equal(fake.calls[0].headers["Content-Type"], "application/json")
})

test("ids travel as variables, never inside the document", async () => {
  const fake = new FakeRailway({ KodaRailwayDeployments: () => ({ deployments: { edges: [] } }) })
  const client = new RailwayReadClient({ token: TOKEN, fetch: fake.fetch, clock: noSleep })
  await client.query(Q_DEPLOYMENTS, { projectId: PROJECT, environmentId: "e", serviceId: "s-1", first: 20 }, "project")
  assert.equal(fake.calls[0].query, Q_DEPLOYMENTS)
  assert.deepEqual(fake.calls[0].variables, { projectId: PROJECT, environmentId: "e", serviceId: "s-1", first: 20 })
})

test("GraphQL errors: Not Authorized is auth, not found is not_found, the token is masked in the message", async () => {
  const fake = new FakeRailway({
    KodaRailwayProjectToken: () => ({ __status: 200, __body: { errors: [{ message: `Not Authorized for token ${TOKEN}` }] } }),
    KodaRailwayDeployments: () => ({ __status: 200, __body: { errors: [{ message: "Service not found" }] } }),
  })
  const client = new RailwayReadClient({ token: TOKEN, fetch: fake.fetch, clock: noSleep })
  await assert.rejects(
    () => client.query(Q_PROJECT_TOKEN, {}, "project"),
    (err: RailwayApiError) => err.kind === "auth" && !err.message.includes(TOKEN) && err.message.includes("***"),
  )
  await assert.rejects(() => client.query(Q_DEPLOYMENTS, {}, "project"), (err: RailwayApiError) => err.kind === "not_found")
})

test("a 429 or a 5xx is retried once, honouring Retry-After; then it fails with its kind", async () => {
  let n = 0
  const waits: number[] = []
  const clock = { now: () => Date.now(), sleep: async (ms: number) => void waits.push(ms) }
  const fake = new FakeRailway({
    KodaRailwayProjectToken: () => (++n === 1 ? { __status: 429, __body: {}, __headers: { "retry-after": "2" } } : { projectToken: { projectId: PROJECT, environmentId: "e" } }),
  })
  const client = new RailwayReadClient({ token: TOKEN, fetch: fake.fetch, clock })
  const r = await client.query<{ projectToken: { projectId: string } }>(Q_PROJECT_TOKEN, {}, "project")
  assert.equal(r.projectToken.projectId, PROJECT)
  assert.equal(fake.calls.length, 2)
  assert.equal(waits[0], 2000)

  const down = new FakeRailway({ KodaRailwayProjectToken: () => ({ __status: 503, __body: {} }) })
  const c2 = new RailwayReadClient({ token: TOKEN, fetch: down.fetch, clock: noSleep })
  await assert.rejects(() => c2.query(Q_PROJECT_TOKEN, {}, "project"), (err: RailwayApiError) => err.kind === "railway" && err.status === 503)
  assert.equal(down.calls.length, 2)
})

test("a dropped connection is retried once, then reported as network", async () => {
  let calls = 0
  const client = new RailwayReadClient({
    token: TOKEN,
    clock: noSleep,
    fetch: async () => {
      calls += 1
      throw new Error(`socket hang up (token ${TOKEN})`)
    },
  })
  await assert.rejects(() => client.query(Q_PROJECT_TOKEN, {}, "project"), (err: RailwayApiError) => err.kind === "network" && !err.message.includes(TOKEN))
  assert.equal(calls, 2)
})

test("the hourly budget stops requests before Railway's own limit, and Railway's counter is kept", async () => {
  const fake = new FakeRailway({
    KodaRailwayProjectToken: () => ({ __status: 200, __body: { data: { projectToken: { projectId: PROJECT, environmentId: "e" } } }, __headers: { "x-ratelimit-limit": "1000", "x-ratelimit-remaining": "997", "x-ratelimit-reset": "1893000000" } }),
  })
  const client = new RailwayReadClient({ token: TOKEN, fetch: fake.fetch, clock: noSleep, requestsPerHour: 10 })
  for (let i = 0; i < 10; i++) await client.query(Q_PROJECT_TOKEN, {}, "project")
  await assert.rejects(() => client.query(Q_PROJECT_TOKEN, {}, "project"), (err: RailwayApiError) => err.kind === "rate_limited")
  assert.equal(fake.calls.length, 10)
  assert.equal(client.budget.used, 10)
  assert.deepEqual(client.rateLimit, { limit: 1000, remaining: 997, resetAt: new Date(1893000000 * 1000).toISOString() })
})

test("no token: refused without a request", async () => {
  const fake = new FakeRailway({})
  const client = new RailwayReadClient({ token: "", fetch: fake.fetch, clock: noSleep })
  await assert.rejects(() => client.query(Q_PROJECT_TOKEN, {}, "project"), (err: RailwayApiError) => err.kind === "auth")
  assert.equal(fake.calls.length, 0)
})
