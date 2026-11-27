/**
 * AI Avatars in the koda.integration/1 contract. No entities (presentations
 * have no order, product or customer lines), so the shared conformance
 * suite, which needs one, is replaced by its parts that apply: the texts,
 * the manifest in every mode, the counters with their links, and nothing
 * written while answering.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { avatarsIntegration } from "../src/workflows/avatars/integration.ts"
import { avatarsCounters } from "../src/modules/avatars/lib/integration.ts"
import { makeContext } from "../src/modules/avatars/lib/kit-routes.ts"
import { ATTENTION_SCOPES, KODA_CONTRACT, safeAdminPath } from "../src/modules/avatars/lib/kit-contract.ts"
import { checkTexts } from "./kit-conformance.ts"
import { fakeScope } from "./helpers.ts"

const ctx = (scope: unknown, lang: "en" | "pl" = "en") => makeContext({ scope: scope as never, lang, actorId: "user_test", actorType: "user" })

test("avatars: integration texts match in English and Polish", () => {
  checkTexts(avatarsIntegration.definition.texts)
})

test("avatars: manifest in both languages, the mode follows the keys", async () => {
  const live = fakeScope({ options: { tavusApiKey: "tvs_12345678", anthropicApiKey: "sk-ant-12345678", geminiApiKey: "gem_12345678" } })
  for (const lang of ["en", "pl"] as const) {
    const m = await avatarsIntegration.build.manifest(ctx(live.scope, lang))
    assert.equal(m.contract, KODA_CONTRACT)
    assert.equal(m.ns, "avatars")
    assert.equal(m.mode, "live")
    assert.deepEqual(m.entities, [])
    assert.deepEqual(m.attention, ["integration"])
    assert.ok(m.attention.every((s) => ATTENTION_SCOPES.includes(s)))
    assert.equal(safeAdminPath(m.adminPath), "/avatars")
    assert.equal(m.problems.length, 0)
  }
  const off = await avatarsIntegration.build.manifest(ctx(fakeScope().scope))
  assert.equal(off.mode, "off")
  assert.equal(off.problems[0].key, "integration.problem.not_configured")
  const partial = await avatarsIntegration.build.manifest(ctx(fakeScope({ options: { anthropicApiKey: "sk-ant-12345678" } }).scope))
  assert.deepEqual(
    partial.problems.map((p) => p.key),
    ["integration.problem.gemini_missing", "integration.problem.tavus_missing"],
  )
  const demo = await avatarsIntegration.build.manifest(ctx(fakeScope({ options: { demo: true } }).scope))
  assert.equal(demo.mode, "demo")
})

test("avatars: counters from the rows, linked to the page, nothing written", async () => {
  const { scope, rows } = fakeScope({
    avatars: [
      { id: "avt_1", consent_state: "signed", consent_file_url: "https://x/c.pdf", consent_signed_by: "Jane", consent_signed_at: "2026-11-20" },
      { id: "avt_2", consent_state: "none" },
    ],
    presentations: [
      { id: "avp_1", state: "review" },
      { id: "avp_2", state: "review" },
      { id: "avp_3", state: "failed" },
      { id: "avp_4", state: "published" },
    ],
  })
  const before = JSON.stringify(rows)
  for (const lang of ["en", "pl"] as const) {
    const a = await avatarsIntegration.build.attention(ctx(scope, lang), ["integration"])
    assert.equal(a.contract, KODA_CONTRACT)
    const byKey = Object.fromEntries(a.items.map((c) => [c.key, c.count]))
    assert.deepEqual(byKey, { presentations_failed: 1, presentations_review: 2, avatars_without_consent: 1 })
  }
  assert.equal(JSON.stringify(rows), before)
})

test("avatars: zero counters are left out, failures are red", () => {
  assert.deepEqual(avatarsCounters({ review: 0, failed: 0, withoutConsent: 0 }), [])
  const c = avatarsCounters({ review: 1, failed: 2, withoutConsent: 0 })
  assert.equal(c[0].key, "presentations_failed")
  assert.equal(c[0].tone, "red")
  assert.deepEqual(c[0].link, { kind: "admin", href: "/avatars?filter=failed" })
  assert.equal(c[1].tone, "orange")
})
