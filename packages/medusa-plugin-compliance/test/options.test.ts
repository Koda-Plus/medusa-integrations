import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/compliance/lib/options.ts"

test("options: defaults when nothing is set, nothing ever throws", () => {
  for (const input of [undefined, null, {}, "nonsense", 42]) {
    const o = resolveOptions(input as never)
    assert.equal(o.demo, false)
    assert.deepEqual(o.sections, { gpsr: true, rodo: true, omnibus: true })
    assert.deepEqual(o.cookieInventory, [])
    assert.deepEqual(o.consentPurposes, [])
  }
})

test("options: demo mode is only ever on with demo: true", () => {
  assert.equal(resolveOptions({ demo: true }).demo, true)
  assert.equal(resolveOptions({ demo: "true" }).demo, true)
  assert.equal(resolveOptions({ demo: "yes" }).demo, false)
  assert.equal(resolveOptions({}).demo, false)
})

test("options: sections narrow by name, unknown names keep everything on", () => {
  assert.deepEqual(resolveOptions({ sections: "gpsr,rodo" }).sections, { gpsr: true, rodo: true, omnibus: false })
  assert.deepEqual(resolveOptions({ sections: ["omnibus"] }).sections, { gpsr: false, rodo: false, omnibus: true })
  assert.deepEqual(resolveOptions({ sections: ["nonsense"] }).sections, { gpsr: true, rodo: true, omnibus: true })
})

test("options: the cookie inventory keeps valid entries, trims names and falls back on functional", () => {
  const o = resolveOptions({
    cookieInventory: [
      { name: " kp_cookies ", purpose: "marketing", description: "choice" },
      { name: "", purpose: "analytics", description: "no name" },
      null as never,
      { name: "a", purpose: "ads" as never, description: "unknown purpose" },
    ],
  })
  assert.equal(o.cookieInventory.length, 2)
  assert.equal(o.cookieInventory[0].name, "kp_cookies")
  assert.equal(o.cookieInventory[0].purpose, "marketing")
  assert.equal(o.cookieInventory[1].purpose, "functional")
})

test("options: consent purposes keep only the known list", () => {
  assert.deepEqual(resolveOptions({ consentPurposes: "analytics, marketing, ads" }).consentPurposes, ["analytics", "marketing"])
  assert.deepEqual(resolveOptions({ consentPurposes: "ads" }).consentPurposes, [])
})
