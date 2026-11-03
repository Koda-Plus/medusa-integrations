/**
 * The signing key cache: forged key versions use up only the pool of
 * unknown versions, so the version InPost signs with keeps working, a known
 * key is kept when its refresh fails, and a version InPost does not know is
 * not asked for again soon.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createKeyCache } from "../src/modules/inpostpay/lib/key-cache.ts"
import { InpostPayApiError } from "../src/modules/inpostpay/lib/client.ts"

const KEY = { public_key_base64: "AAAA", merchant_external_id: "m-1" }
const HOUR = 60 * 60 * 1000

test("key cache: forged versions cannot lock out the version in use", async () => {
  const cache = createKeyCache()
  let fetches = 0
  const fetchKey = async (v: string) => {
    fetches += 1
    if (v === "1") return KEY
    throw new InpostPayApiError(404, "not_found", "InPost answered 404")
  }
  const t0 = 1_000_000
  assert.deepEqual(await cache.get("1", fetchKey, undefined, t0), KEY)
  for (let i = 0; i < 30; i++) assert.equal(await cache.get(`forged-${i}`, fetchKey, undefined, t0 + 1000), null)
  assert.equal(fetches, 10, "unknown versions share 10 fetches a minute (version 1 was one of them)")
  assert.deepEqual(await cache.get("1", fetchKey, undefined, t0 + 2000), KEY, "the version in use still answers")
  assert.deepEqual(await cache.get("1", fetchKey, undefined, t0 + HOUR + 1), KEY, "the known version is refreshed in its own pool")
  assert.equal(fetches, 11)
  assert.deepEqual(await cache.get("1", fetchKey, undefined, t0 + 2 * HOUR + 2), KEY)
})

test("key cache: a failed refresh keeps the last key; an unknown version waits 10 minutes", async () => {
  const cache = createKeyCache()
  let fail = false
  let fetches = 0
  const fetchKey = async (v: string) => {
    fetches += 1
    if (fail) throw new InpostPayApiError(0, "unavailable", "InPost could not be reached")
    if (v === "1") return KEY
    throw new InpostPayApiError(404, "not_found", "InPost answered 404")
  }
  const errors: unknown[] = []
  assert.deepEqual(await cache.get("1", fetchKey, (e) => errors.push(e), 0), KEY)
  fail = true
  assert.deepEqual(await cache.get("1", fetchKey, (e) => errors.push(e), HOUR + 1), KEY, "the stale key is used while InPost is down")
  assert.equal(errors.length, 1)
  fail = false
  assert.equal(await cache.get("9", fetchKey, undefined, HOUR + 2), null)
  const before = fetches
  assert.equal(await cache.get("9", fetchKey, undefined, HOUR + 5 * 60 * 1000), null)
  assert.equal(fetches, before, "not asked again within 10 minutes")
  assert.equal(await cache.get("9", fetchKey, undefined, HOUR + 11 * 60 * 1000), null)
  assert.equal(fetches, before + 1)
})
