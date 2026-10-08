import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/loyalty/lib/options.ts"

test("options: defaults when nothing is set, nothing ever throws", () => {
  for (const input of [undefined, null, {}, "nonsense", 42]) {
    const o = resolveOptions(input as never)
    assert.equal(o.demo, false)
    assert.equal(o.pointsPerPln, 1)
    assert.equal(o.redeemRate, 0.05)
    assert.deepEqual(o.rewards, [])
  }
})

test("options: the rates take positive numbers only and never explode", () => {
  assert.equal(resolveOptions({ pointsPerPln: "2" }).pointsPerPln, 2)
  assert.equal(resolveOptions({ pointsPerPln: 0 }).pointsPerPln, 1)
  assert.equal(resolveOptions({ pointsPerPln: -5 }).pointsPerPln, 1)
  assert.equal(resolveOptions({ redeemRate: "0.1" }).redeemRate, 0.1)
  assert.equal(resolveOptions({ redeemRate: "soon" }).redeemRate, 0.05)
})

test("options: the reward ladder keeps valid entries and sorts by cost", () => {
  const o = resolveOptions({
    rewards: [
      { at: 3000, name: { en: "Free drill", pl: "Wkrętarka gratis" } },
      { at: 1500, name: { en: "50 off", pl: "Rabat 50", } },
      { at: "broken" as never, name: { en: "x", pl: "x" } },
      { at: 6000, name: { en: "Priority", pl: "Priorytet" }, discount: 100 },
    ],
  })
  assert.equal(o.rewards.length, 3)
  assert.equal(o.rewards[0].at, 1500)
  assert.equal(o.rewards[2].discount, 100)
})
