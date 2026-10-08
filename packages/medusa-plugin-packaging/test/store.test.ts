import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/packaging/lib/options.ts"
import { toProduct, toUnit } from "../src/modules/packaging/lib/store.ts"

test("options: defaults when nothing is set, nothing ever throws", () => {
  for (const input of [undefined, null, {}, "nonsense", 42]) {
    const o = resolveOptions(input as never)
    assert.equal(o.demo, false)
    assert.equal(o.gs1Prefix, "590123456789")
  }
})

test("options: the GS1 prefix takes 7 to 10 digits only", () => {
  assert.equal(resolveOptions({ gs1Prefix: "5901234" }).gs1Prefix, "5901234")
  assert.equal(resolveOptions({ gs1Prefix: "123" }).gs1Prefix, "590123456789")
  assert.equal(resolveOptions({ gs1Prefix: "5901234567890" }).gs1Prefix, "590123456789")
  assert.equal(resolveOptions({ gs1Prefix: "59-01-234" }).gs1Prefix, "5901234")
})

test("store: units and products map with defaults", () => {
  const u = toUnit({ id: "pku_1", product_id: "prod_1", name: "karton", pieces: 12, ean: " 5901234123457 ", sscc_prefix: null })
  assert.equal(u.name, "karton")
  assert.equal(u.pieces, 12)
  assert.equal(u.ean, "5901234123457")
  assert.equal(toUnit({ id: "pku_2", name: "cos", pieces: "x" }).name, "szt.")
  assert.equal(toUnit({ id: "pku_3", pieces: "x" }).pieces, 0)

  const p = toProduct({ id: "ppr_1", product_id: "prod_1", sku: "KS-1", title: "Tool", moq: 12, step: 6, demo: true }, [u])
  assert.equal(p.moq, 12)
  assert.equal(p.step, 6)
  assert.equal(p.units.length, 1)
  assert.equal(p.demo, true)
})
