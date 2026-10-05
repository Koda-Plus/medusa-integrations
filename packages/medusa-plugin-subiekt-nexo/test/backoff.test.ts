import { test } from "node:test"
import assert from "node:assert/strict"
import { planRetry, retryDelaySeconds } from "../src/modules/subiekt/lib/backoff.ts"
import { BACKOFF_SECONDS, MAX_ATTEMPTS } from "../src/modules/subiekt/lib/constants.ts"

const noJitter = () => 0

test("delays follow the table and stay at its end", () => {
  assert.equal(retryDelaySeconds(1, BACKOFF_SECONDS, noJitter), 60)
  assert.equal(retryDelaySeconds(2, BACKOFF_SECONDS, noJitter), 120)
  assert.equal(retryDelaySeconds(10, BACKOFF_SECONDS, noJitter), 43_200)
  assert.equal(retryDelaySeconds(50, BACKOFF_SECONDS, noJitter), 43_200)
  assert.equal(retryDelaySeconds(0, BACKOFF_SECONDS, noJitter), 60)
})

test("jitter adds at most 10 percent", () => {
  assert.equal(retryDelaySeconds(1, BACKOFF_SECONDS, () => 0.999), 66)
})

test("all retries together cover a weekend with the bridge machine off", () => {
  let total = 0
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) total += retryDelaySeconds(attempt, BACKOFF_SECONDS, noJitter)
  assert.ok(total > 2 * 24 * 3600, `only ${Math.round(total / 3600)} h`)
})

test("a retryable failure is scheduled, a final one is not", () => {
  const now = new Date("2026-10-04T10:00:00Z")
  const next = planRetry({ attempts: 1, retryable: true, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now, random: noJitter })
  assert.equal(next.status, "pending")
  assert.equal(next.nextAttemptAt?.toISOString(), "2026-10-04T10:01:00.000Z")

  assert.deepEqual(planRetry({ attempts: 1, retryable: false, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now }), {
    status: "failed",
    nextAttemptAt: null,
  })
  assert.deepEqual(planRetry({ attempts: MAX_ATTEMPTS, retryable: true, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now }), {
    status: "failed",
    nextAttemptAt: null,
  })
})
