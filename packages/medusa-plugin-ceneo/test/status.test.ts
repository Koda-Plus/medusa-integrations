import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/ceneo/lib/options.ts"
import { apiMode, buildStatus, feedPath, toFeedBuild } from "../src/modules/ceneo/lib/store.ts"

const counts = { ok: 3, warning: 1, error: 2, excluded: 4, offers: 10 }
const built = { id: "cfd_1", status: "built", hash: "abc", bytes: 2048, offers: 4, warnings: 1, errors: 2, excluded: 4, duration_ms: 120, trigger: "schedule", built_at: "2026-11-11T10:00:00.000Z", demo: false }
const failed = { id: "cfd_2", status: "failed", error: "query timeout", built_at: "2026-11-11T10:30:00.000Z" }

test("status: the feed path holds the token only when the token is valid", () => {
  assert.equal(feedPath(resolveOptions({ feed: { token: "a1b2c3d4e5f6a7b8c9d0" } })), "/ceneo/feed/a1b2c3d4e5f6a7b8c9d0.xml")
  assert.equal(feedPath(resolveOptions({ feed: { token: "short" } })), null)
})

test("status: the API mode never says live without a key, demo wins", () => {
  assert.equal(apiMode(resolveOptions({})), "missing_key")
  assert.equal(apiMode(resolveOptions({ apiKey: "k" })), "live")
  assert.equal(apiMode(resolveOptions({ apiKey: "k", demo: true })), "demo")
})

test("status: a failed newest build is reported next to the last good one, never instead of it", () => {
  const s = buildStatus(resolveOptions({}), built, failed, counts)
  assert.equal(s.feed.last?.id, "cfd_1")
  assert.equal(s.feed.failed?.id, "cfd_2")
  assert.equal(s.feed.failed?.error, "query timeout")
  const ok = buildStatus(resolveOptions({}), built, built, counts)
  assert.equal(ok.feed.failed, null)
  const never = buildStatus(resolveOptions({}), null, failed, counts)
  assert.equal(never.feed.last, null)
  assert.equal(never.feed.failed?.id, "cfd_2")
})

test("status: the API key never leaves the server", () => {
  const s = buildStatus(resolveOptions({ apiKey: "secret-key-value" }), null, null, counts)
  assert.equal(JSON.stringify(s).includes("secret-key-value"), false)
})

test("status: build rows with missing or odd values read safely", () => {
  const b = toFeedBuild({ id: "cfd_x", status: "weird", bytes: "12", built_at: new Date("2026-11-11T00:00:00Z") })
  assert.equal(b.status, "failed")
  assert.equal(b.bytes, 12)
  assert.equal(b.offers, 0)
  assert.equal(b.built_at, "2026-11-11T00:00:00.000Z")
})
