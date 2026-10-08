import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/whitelist/lib/options.ts"

test("options: defaults when nothing is set, nothing ever throws", () => {
  for (const input of [undefined, null, {}, "nonsense", 42]) {
    const o = resolveOptions(input as never)
    assert.equal(o.demo, false)
    assert.equal(o.baseUrl, "https://wl-api.mf.gov.pl")
    assert.equal(o.staleHours, 24)
  }
})

test("options: demo mode is only ever on with demo: true", () => {
  assert.equal(resolveOptions({ demo: true }).demo, true)
  assert.equal(resolveOptions({ demo: "true" }).demo, true)
  assert.equal(resolveOptions({}).demo, false)
})

test("options: the base URL takes only http(s) addresses, trailing slashes go away", () => {
  assert.equal(resolveOptions({ baseUrl: "https://proxy.example.com/" }).baseUrl, "https://proxy.example.com")
  assert.equal(resolveOptions({ baseUrl: "ftp://x.example.com" }).baseUrl, "https://wl-api.mf.gov.pl")
  assert.equal(resolveOptions({ baseUrl: "nonsense" }).baseUrl, "https://wl-api.mf.gov.pl")
})

test("options: the stale hours are bounded and fall back to 24", () => {
  assert.equal(resolveOptions({ staleHours: 0 }).staleHours, 0)
  assert.equal(resolveOptions({ staleHours: "48" }).staleHours, 48)
  assert.equal(resolveOptions({ staleHours: -3 }).staleHours, 0)
  assert.equal(resolveOptions({ staleHours: "soon" }).staleHours, 24)
  assert.equal(resolveOptions({ staleHours: 10 ** 9 }).staleHours, 24 * 365)
})
