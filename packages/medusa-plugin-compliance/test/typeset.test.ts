import { test } from "node:test"
import assert from "node:assert/strict"
import { nb, typeset } from "../src/admin/lib/compliance-typeset.ts"

test("typeset: short Polish words stick to the next word, keys stay untouched", () => {
  assert.equal(nb("sklep i magazyn"), `sklep i\u00a0magazyn`)
  assert.equal(nb("na półce"), `na\u00a0półce`)
  assert.equal(nb("w domu i w pracy"), `w\u00a0domu i\u00a0w\u00a0pracy`)
  const dict = typeset({ a: "w domu", b: { c: "i w magazynie" } })
  assert.equal(dict.a, `w\u00a0domu`)
  assert.equal(dict.b.c, `i\u00a0w\u00a0magazynie`)
})

test("typeset: a number sticks to its unit and thousands", () => {
  assert.equal(nb("1 000 zł"), `1\u00a0000\u00a0zł`)
})
