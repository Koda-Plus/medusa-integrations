import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/credit/lib/options.ts"

test("options: defaults when nothing is set, nothing ever throws", () => {
  for (const input of [undefined, null, {}, "nonsense", 42]) {
    const o = resolveOptions(input as never)
    assert.equal(o.demo, false)
    assert.equal(o.enforce, false)
  }
})

test("options: demo and enforce are only ever on with true", () => {
  assert.equal(resolveOptions({ demo: true }).demo, true)
  assert.equal(resolveOptions({ demo: "true" }).demo, true)
  assert.equal(resolveOptions({ enforce: true }).enforce, true)
  assert.equal(resolveOptions({ enforce: "true" }).enforce, true)
  assert.equal(resolveOptions({}).enforce, false)
})
