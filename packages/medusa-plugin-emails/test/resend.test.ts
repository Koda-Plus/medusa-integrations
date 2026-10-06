/**
 * The Resend client: what each answer means, which ones are tried again (and
 * how long it waits), the breaker that stops retrying during an outage, and
 * the pacing of requests.
 */
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { BREAKER_THRESHOLD } from "../src/modules/emails/lib/constants.ts"
import { classify, createResendClient, paceState, resetPace } from "../src/modules/emails/lib/resend.ts"
import { FakeResend } from "./helpers.ts"

beforeEach(() => resetPace())

const payload = { from: "a@example.com", to: ["b@example.com"], subject: "S", html: "<p>x</p>", text: "x" }

function client(fake: FakeResend, waits: number[] = [], extra: Record<string, unknown> = {}) {
  /* A fake clock that moves only when the client sleeps: with the real clock, two requests in the
     same millisecond made the pacing add a 1 ms wait now and then, and the waits flaked. */
  let clock = Date.now()
  return createResendClient({
    apiKey: "re_test_key_1234567890",
    timeoutMs: 1000,
    maxRetries: 2,
    requestsPerSecond: 1000,
    fetch: fake.fetch,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms)
      clock += ms
    },
    random: () => 0.5,
    ...extra,
  })
}

test("classify: final refusals, temporary errors and idempotency conflicts", () => {
  const h = (v: Record<string, string>) => new Headers(v)
  const v = (status: number, name?: string, headers?: Headers) => classify(status, name ? { name, message: "m" } : null, headers)
  assert.deepEqual([v(400, "validation_error").retryNow, v(400, "validation_error").failure.temporary], [false, false])
  assert.equal(v(401, "missing_api_key").retryNow, false)
  assert.equal(v(403, "validation_error").failure.maybeSent, false)
  assert.equal(v(422, "missing_required_field").retryNow, false)
  assert.equal(v(429, "rate_limit_exceeded", h({ "retry-after": "3" })).waitMs, 3000)
  assert.equal(v(429, "rate_limit_exceeded", h({ "retry-after": "999" })).waitMs, 10_000, "capped at 10 s")
  assert.equal(v(429, "rate_limit_exceeded").retryNow, true)
  assert.equal(v(429, "daily_quota_exceeded").retryNow, false)
  assert.equal(v(429, "monthly_quota_exceeded").failure.temporary, false)
  assert.equal(v(409, "concurrent_idempotent_requests").retryNow, true)
  assert.equal(v(409, "concurrent_idempotent_requests").failure.maybeSent, true)
  assert.equal(v(409, "invalid_idempotent_request").retryNow, false)
  assert.equal(v(409, "invalid_idempotent_request").failure.maybeSent, true)
  assert.equal(v(500, "application_error").retryNow, true)
  assert.equal(v(500, "application_error").failure.maybeSent, true)
  assert.equal(v(503, "service_unavailable").failure.maybeSent, false)
  assert.equal(v(502).failure.code, "HTTP_502")
})

test("success on the first try", async () => {
  const fake = new FakeResend()
  const r = await client(fake).send(payload, "k1")
  assert.deepEqual(r, { ok: true, id: "re_msg_1", attempts: 1 })
  assert.equal(fake.calls[0].headers["idempotency-key"], "k1")
  assert.equal(fake.calls[0].headers["content-type"], "application/json")
})

test("a 500 is tried again with the same key after a backoff, then succeeds", async () => {
  const fake = new FakeResend().answer({ status: 500, body: { name: "application_error", message: "oops" } })
  const waits: number[] = []
  const r = await client(fake, waits).send(payload, "k2")
  assert.equal(r.ok, true)
  assert.equal(r.attempts, 2)
  assert.deepEqual(fake.calls.map((c) => c.headers["idempotency-key"]), ["k2", "k2"])
  assert.deepEqual(waits, [600])
})

test("a 429 waits what retry-after says", async () => {
  const fake = new FakeResend().answer({ status: 429, body: { name: "rate_limit_exceeded", message: "slow down" }, headers: { "retry-after": "4" } })
  const waits: number[] = []
  const r = await client(fake, waits).send(payload, "k3")
  assert.equal(r.ok, true)
  assert.deepEqual(waits, [4000])
})

test("quotas, auth and validation errors are not tried again", async () => {
  for (const [status, name] of [
    [429, "daily_quota_exceeded"],
    [401, "missing_api_key"],
    [403, "validation_error"],
    [422, "invalid_attachment"],
  ] as const) {
    resetPace()
    const fake = new FakeResend().answer({ status, body: { name, message: "no" } })
    const r = await client(fake).send(payload, "k")
    assert.equal(r.ok, false)
    assert.equal(fake.calls.length, 1, `${name}: one request only`)
    if (!r.ok) assert.equal(r.error.code, name)
  }
})

test("at most maxRetries extra tries, and a timeout means the message may have gone out", async () => {
  const fake = new FakeResend().answer("timeout", "network", "timeout", "timeout")
  const r = await client(fake).send(payload, "k4")
  assert.equal(fake.calls.length, 3)
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.error.code, "TIMEOUT")
    assert.equal(r.error.maybeSent, true)
    assert.equal(r.error.temporary, true)
  }
})

test("a 200 without an id is treated as unknown, never as sent", async () => {
  const fake = new FakeResend().answer({ status: 200, body: {} })
  const r = await client(fake).send(payload, "k5")
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error.code, "NO_ID")
})

test("the breaker: after repeated temporary failures the process stops retrying for a while", async () => {
  const fake = new FakeResend().answer(...Array.from({ length: 20 }, () => ({ status: 503, body: { name: "service_unavailable", message: "down" } })))
  const c = client(fake)
  let requests = 0
  for (let i = 0; i < BREAKER_THRESHOLD + 2; i++) {
    const before = fake.calls.length
    await c.send(payload, `k${i}`)
    requests = fake.calls.length - before
  }
  assert.equal(requests, 1, "with the breaker open every send gets one try only")
  assert.ok(paceState().openUntil > Date.now())
})

test("requests are paced: requestsPerSecond per process", async () => {
  const clock = 1_000_000
  const waits: number[] = []
  const fake = new FakeResend()
  const c = createResendClient({
    apiKey: "re_x_123456789",
    timeoutMs: 1000,
    maxRetries: 0,
    requestsPerSecond: 4,
    fetch: fake.fetch,
    now: () => clock,
    sleep: async (ms) => void waits.push(ms),
  })
  /* Three sends at the same moment: the second waits a quarter of a second, the third half a second. */
  await Promise.all([c.send(payload, "a"), c.send(payload, "b"), c.send(payload, "c")])
  assert.deepEqual(waits, [250, 500])
  assert.equal(fake.calls.length, 3)
})
