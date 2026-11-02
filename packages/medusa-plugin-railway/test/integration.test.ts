/**
 * Railway in the koda.integration/1 contract. No entities (the hosting has
 * no order, product or customer lines), so the shared conformance suite,
 * which needs one, is replaced by its parts that apply: the texts, the
 * manifest, the counters with their links, 400 for every entity, ETag, and
 * nothing written while answering.
 */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { railwayIntegration } from "../src/workflows/railway/integration.ts"
import { makeContext } from "../src/modules/railway/lib/kit-routes.ts"
import { ENTITY_KINDS, KODA_CONTRACT, safeAdminPath } from "../src/modules/railway/lib/kit-contract.ts"
import { checkTexts, fakeResponse } from "./kit-conformance.ts"
import { standardRailway } from "./fixtures.ts"
import { container } from "./harness.ts"
import middlewares from "../src/api/middlewares.ts"

const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (async () => {
    throw new Error("no network in tests")
  }) as typeof fetch
})
after(() => {
  globalThis.fetch = realFetch
})

const ctx = (scope: unknown, lang: "en" | "pl" = "en") => makeContext({ scope: scope as never, lang, actorId: "user_test", actorType: "user" })
const req = (scope: unknown, query: Record<string, string>, headers: Record<string, string> = {}) => ({ scope, query, headers, auth_context: { actor_id: "user_test", actor_type: "user" } }) as never

test("railway: integration texts match in English and Polish", () => {
  checkTexts(railwayIntegration.definition.texts)
})

test("railway: manifest in both languages, mode follows the setup", async () => {
  const live = container(standardRailway())
  for (const lang of ["en", "pl"] as const) {
    const m = await railwayIntegration.build.manifest(ctx(live, lang))
    assert.equal(m.contract, KODA_CONTRACT)
    assert.equal(m.ns, "railway")
    assert.equal(m.mode, "live")
    assert.deepEqual(m.entities, [])
    assert.deepEqual(m.attention, ["integration"])
    assert.equal(safeAdminPath(m.adminPath), "/railway")
  }
  const off = await railwayIntegration.build.manifest(ctx(container(null, {})))
  assert.equal(off.mode, "off")
  assert.equal(off.problems[0].key, "integration.problem.not_configured")
  const demo = await railwayIntegration.build.manifest(ctx(container(null, { demo: true })))
  assert.equal(demo.mode, "demo")
})

test("railway: counters from the overview, linked to the problems filter, nothing written", async () => {
  const fake = standardRailway()
  const scope = container(fake)
  for (const lang of ["en", "pl"] as const) {
    const a = await railwayIntegration.build.attention(ctx(scope, lang), ["integration"])
    assert.equal(a.contract, KODA_CONTRACT)
    const keys = a.items.map((c) => c.key)
    assert.ok(keys.includes("deploys_failing"))
    assert.ok(keys.includes("resources_high"))
    assert.ok(keys.includes("errors_high"))
    for (const c of a.items) {
      assert.equal(c.scope, "integration")
      assert.equal(c.link.href, "/railway?filter=problems")
      assert.equal(c.label.params?.count, c.count)
      assert.ok(c.label.fallback && c.label.fallback !== c.label.key)
    }
  }
  /* The second language reused the overview read. */
  assert.equal(fake.ops().filter((o) => o === "KodaRailwayOverview").length, 1)
  /* Every request was a query. */
  assert.ok(fake.calls.every((c) => /^query\s/.test(c.query.trim())))
  assert.deepEqual((await railwayIntegration.build.attention(ctx(container(null, {})), ["integration"])).items, [])
})

test("railway: HTTP: every entity is 400, the manifest has an ETag, a bad scope is 400", async () => {
  const scope = container(standardRailway())
  for (const entity of ENTITY_KINDS) {
    const res = fakeResponse()
    await railwayIntegration.summary(req(scope, { entity, id: "x_1" }), res)
    assert.equal(res.statusCode, 400, entity)
  }
  const first = fakeResponse()
  await railwayIntegration.manifest(req(scope, {}), first)
  assert.equal(first.statusCode, 200)
  assert.equal(first.headers["x-koda-contract"], "1")
  const second = fakeResponse()
  await railwayIntegration.manifest(req(scope, {}, { "if-none-match": first.headers["etag"] }), second)
  assert.equal(second.statusCode, 304)
  const bad = fakeResponse()
  await railwayIntegration.attention(req(scope, { scope: "integration,nonsense" }), bad)
  assert.equal(bad.statusCode, 400)
})

test("railway: the write guard stands in front of every admin route", () => {
  const routes = (middlewares as unknown as { routes: Array<{ matcher: string; middlewares: unknown[] }> }).routes
  assert.deepEqual(routes.map((r) => r.matcher), ["/admin/railway*"])
  assert.equal(routes[0].middlewares.length, 1)
})
