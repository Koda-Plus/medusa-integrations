/**
 * Demo mode: only on explicit request, it wins over a key, and the client
 * answers from memory without ever calling Kit.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { isActive, missingOptions, resolveOptions } from "../src/modules/kit/lib/options.ts"
import { createKitClient } from "../src/modules/kit/lib/client.ts"
import { kitManifest } from "../src/modules/kit/lib/integration.ts"
import { effectiveSettings } from "../src/modules/kit/lib/store.ts"

const logger = { warn: () => undefined, error: () => undefined }

test("demo is off unless switched on", () => {
  assert.equal(resolveOptions({}).demo, false)
  assert.equal(resolveOptions({ demo: "false" }).demo, false)
  assert.equal(resolveOptions({ demo: "true" }).demo, true)
  assert.equal(isActive(resolveOptions({})), false)
  assert.equal(isActive(resolveOptions({ demo: true })), true)
  assert.deepEqual(missingOptions(resolveOptions({ demo: true })), [])
  assert.deepEqual(missingOptions(resolveOptions({})), ["apiKey"])
})

test("the manifest says demo", () => {
  const o = resolveOptions({ demo: true, apiKey: "k" })
  const m = kitManifest(o, effectiveSettings(o, null))
  assert.equal(m.mode, "demo")
  assert.equal(m.configured, true)
  assert.deepEqual(m.problems, [])
})

test("the demo client never calls Kit, even with a key", async () => {
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    throw new Error("no network in demo")
  }) as typeof fetch
  try {
    const c = createKitClient(resolveOptions({ demo: true, apiKey: "secret-key" }), logger)
    assert.equal(c.apiKey, "")
    const account = await c.account()
    assert.equal(account.id, "demo")
    assert.ok((await c.tags()).length > 0)
    assert.ok((await c.forms()).length > 0)
    const first = await c.createSubscriber({ email: "New@Example.com", state: "inactive" })
    assert.equal(first.created, true)
    const again = await c.createSubscriber({ email: "new@example.com", state: "active" })
    assert.equal(again.created, false)
    assert.equal((await c.subscriberByEmail("NEW@example.com"))?.state, "active")
    const tag = await c.createTag("Bought: Something")
    assert.equal((await c.createTag("Bought: Something")).id, tag.id)
    const b = await c.broadcasts(10)
    assert.ok(b.length > 0)
    assert.ok((await c.broadcastStats(b[0].id)).recipients > 0)
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})
