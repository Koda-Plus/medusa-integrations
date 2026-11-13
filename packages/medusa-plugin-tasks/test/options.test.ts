import { test } from "node:test"
import assert from "node:assert/strict"
import { isAgencyEmail, isSandboxEmail, normalizeEmail, resolveOptions } from "../src/modules/tasks/lib/options.ts"

test("options: defaults when nothing is set, nothing ever throws", () => {
  for (const input of [undefined, null, {}, "nonsense" as unknown as object, 42 as unknown as object]) {
    const o = resolveOptions(input as never)
    assert.deepEqual(o.sandboxAccounts, [])
    assert.deepEqual(o.agencyAccounts, [])
    assert.equal(o.sandboxResetHours, 24)
    assert.equal("references" in o, false)
  }
})

test("options: sandbox accounts are e-mails, lower case, unique; a comma separated string works (environment variables)", () => {
  assert.deepEqual(resolveOptions({ sandboxAccounts: [" Demo@Store.example ", "demo@store.example", "not an e-mail", "", 42 as unknown as string] }).sandboxAccounts, ["demo@store.example"])
  assert.deepEqual(resolveOptions({ sandboxAccounts: "a@one.example.com, b@two.example.com;c@three.example.com" }).sandboxAccounts, ["a@one.example.com", "b@two.example.com", "c@three.example.com"])
  assert.deepEqual(resolveOptions({ sandboxAccounts: "" }).sandboxAccounts, [])
})

test("options: agency accounts take e-mails and domains; a bare domain counts as one", () => {
  const o = resolveOptions({ agencyAccounts: ["@Agency.example", "agency.test", "freelancer@example.com", "@", "not a domain"] })
  assert.deepEqual(o.agencyAccounts, ["@agency.example", "@agency.test", "freelancer@example.com"])
  assert.equal(isAgencyEmail("ola@agency.example", o), true)
  assert.equal(isAgencyEmail("Someone@AGENCY.TEST", o), true)
  assert.equal(isAgencyEmail("freelancer@example.com", o), true)
  assert.equal(isAgencyEmail("other@example.com", o), false)
  assert.equal(isAgencyEmail(null, o), false)
})

test("options: the sandbox reset hours are bounded, 0 turns the automatic reseed off", () => {
  assert.equal(resolveOptions({ sandboxResetHours: 0 }).sandboxResetHours, 0)
  assert.equal(resolveOptions({ sandboxResetHours: "6" }).sandboxResetHours, 6)
  assert.equal(resolveOptions({ sandboxResetHours: -5 }).sandboxResetHours, 0)
  assert.equal(resolveOptions({ sandboxResetHours: "soon" }).sandboxResetHours, 24)
  assert.equal(resolveOptions({ sandboxResetHours: 10 ** 9 }).sandboxResetHours, 24 * 365)
})

test("options: sandbox matching is exact on the e-mail, without case; unknown e-mails are never sandbox accounts", () => {
  const o = resolveOptions({ sandboxAccounts: ["demo@store.example"] })
  assert.equal(isSandboxEmail("DEMO@store.example", o), true)
  assert.equal(isSandboxEmail("demo@store.example.evil.test", o), false)
  assert.equal(isSandboxEmail("other@store.example", o), false)
  assert.equal(isSandboxEmail(null, o), false)
  assert.equal(isSandboxEmail(undefined, o), false)
  assert.equal(normalizeEmail(" X@Example.COM "), "x@example.com")
  assert.equal(normalizeEmail("x@y"), null)
})

test("a references key left over from an older config is ignored, never an error", () => {
  const o = resolveOptions({ references: [{ name: "Store", url: "https://store.example.com" }] } as never)
  assert.equal("references" in o, false)
})

test("options: the sandbox guard, events, limits and seed links, and the agent key prefix; broken values fall back", () => {
  const d = resolveOptions({})
  assert.deepEqual(d.sandboxGuard, { enabled: false, allowWrites: [] })
  assert.equal(d.sandboxEvents, "skip")
  assert.deepEqual(d.sandboxLimits, { tasks: 200, commentsPerTask: 50, writesPerMinute: 60 })
  assert.equal(d.sandboxSeedLinks, "product")
  assert.equal(d.agentKeyPrefix, "tasks:")
  assert.deepEqual(resolveOptions({ sandboxGuard: true }).sandboxGuard, { enabled: true, allowWrites: [] })
  assert.deepEqual(resolveOptions({ sandboxGuard: { allowWrites: ["/admin/Views/", "/store/carts", "/admin//x", "admin/y", "/admin/ok"] } }).sandboxGuard, {
    enabled: true,
    allowWrites: ["/admin/views", "/admin/ok"],
  })
  assert.equal(resolveOptions({ sandboxGuard: "yes" as never }).sandboxGuard.enabled, false)
  assert.equal(resolveOptions({ sandboxEvents: "emit" }).sandboxEvents, "emit")
  assert.equal(resolveOptions({ sandboxEvents: "loud" as never }).sandboxEvents, "skip")
  assert.deepEqual(resolveOptions({ sandboxLimits: false }).sandboxLimits, { tasks: 0, commentsPerTask: 0, writesPerMinute: 0 })
  assert.deepEqual(resolveOptions({ sandboxLimits: { tasks: "20", writesPerMinute: -3 } }).sandboxLimits, { tasks: 20, commentsPerTask: 50, writesPerMinute: 0 })
  assert.equal(resolveOptions({ sandboxSeedLinks: "all" }).sandboxSeedLinks, "all")
  assert.equal(resolveOptions({ sandboxSeedLinks: "everything" as never }).sandboxSeedLinks, "product")
  assert.equal(resolveOptions({ agentKeyPrefix: false }).agentKeyPrefix, "")
  assert.equal(resolveOptions({ agentKeyPrefix: " Agent: " }).agentKeyPrefix, "agent:")
  assert.equal(resolveOptions({ agentKeyPrefix: "x" }).agentKeyPrefix, "tasks:", "one letter would catch every key")
})
