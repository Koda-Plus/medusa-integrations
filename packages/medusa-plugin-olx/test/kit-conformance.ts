// GENERATED from kit/test/conformance.ts (kit 1.0.1) by scripts/kit.mjs. Do not edit here: change the kit and run `npm run kit:sync`.
/**
 * koda.integration/1 conformance, the same checks for every plugin. A
 * package calls it from its own test with its definition and a fake
 * container that holds sample rows:
 *
 *   import { conformance } from "./kit-conformance.ts"
 *   conformance({ routes: inpostIntegration, scope, entity: "order", knownIds: ["order_1"], writes: () => calls })
 *
 * What it checks: the shape of the manifest, a single summary, a batch and
 * the counters; tone follows state; every link is a safe admin path or an
 * https link on the plugin's list; every message key resolves in English
 * and in Polish with the same placeholders; an unknown id answers state
 * "none"; an entity outside the manifest answers 400; nothing was written
 * while answering; the English and Polish texts have the same keys and no
 * dashes or middle dots.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ATTENTION_SCOPES,
  ENTITY_KINDS,
  FACT_SLOTS,
  KODA_CONTRACT,
  SUMMARY_STATES,
  TONE_OF,
  safeAdminPath,
  safeExternalUrl,
  type EntityKind,
  type EntitySummary,
  type Link,
  type Message,
} from "../src/modules/olx/lib/kit-contract.ts"
import { makeContext, type IntegrationRoutes, type Texts } from "../src/modules/olx/lib/kit-routes.ts"

export interface ConformanceInput {
  routes: IntegrationRoutes
  /** The fake request container (plugin service, Query, store...). */
  scope: any
  /** An entity from the manifest and ids the fake data knows. */
  entity: EntityKind
  knownIds: string[]
  /** Calls that would change data, recorded by the fakes; must stay empty while answering. */
  writes?: () => readonly unknown[]
  /** Actor of the request, for plugins that scope data by user (Tasks sandbox accounts). */
  actorId?: string | null
}

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014, 0xb7)}]`)

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]).sort()
}

function flatten(texts: Texts, prefix = ""): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(texts)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === "string") out.set(key, v)
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv)
  }
  return out
}

const PLURAL = /_(zero|one|two|few|many|other)$/

/** Same keys in both languages (plural forms aside), the same placeholders, no dashes. */
export function checkTexts(texts: { en: Texts; pl: Texts }): void {
  const en = flatten(texts.en)
  const pl = flatten(texts.pl)
  const base = (k: string) => k.replace(PLURAL, "")
  const enBase = new Set([...en.keys()].map(base))
  const plBase = new Set([...pl.keys()].map(base))
  for (const k of enBase) assert.ok(plBase.has(k), `integration.${k} is missing in Polish`)
  for (const k of plBase) assert.ok(enBase.has(k), `integration.${k} is only in Polish`)
  for (const k of enBase) assert.ok([...en.keys()].some((x) => x === k || base(x) === k))
  for (const [k, v] of [...en, ...pl]) assert.ok(!DASHES.test(v), `integration.${k} has a dash or a middle dot: ${v}`)
  for (const [k, v] of en) {
    const b = base(k)
    const forms = [...pl.entries()].filter(([pk]) => base(pk) === b)
    for (const [pk, pv] of forms) {
      const want = placeholders(v).filter((p) => p !== "count")
      const got = placeholders(pv).filter((p) => p !== "count")
      assert.deepEqual(got, want, `integration.${pk} has other placeholders than integration.${k}`)
    }
  }
  for (const s of SUMMARY_STATES) {
    assert.ok(en.has(`state.${s}`), `integration.state.${s} is missing (spread STATE_TEXTS.en)`)
    assert.ok(pl.has(`state.${s}`), `integration.state.${s} is missing in Polish (spread STATE_TEXTS.pl)`)
  }
}

function checkMessage(m: Message | undefined, texts: { en: Texts; pl: Texts }, where: string): void {
  assert.ok(m, `${where}: message missing`)
  assert.ok(m.key.startsWith("integration."), `${where}: key ${m.key} is not under integration.`)
  assert.equal(typeof m.fallback, "string", `${where}: fallback`)
  assert.notEqual(m.fallback, m.key, `${where}: ${m.key} has no text`)
  const path = m.key.replace(/^integration\./, "")
  for (const lang of ["en", "pl"] as const) {
    const flat = flatten(texts[lang])
    const found = flat.has(path) || [...flat.keys()].some((k) => k.replace(PLURAL, "") === path)
    assert.ok(found, `${where}: ${m.key} is missing in ${lang}`)
  }
  for (const [k, v] of Object.entries(m.params ?? {})) {
    assert.ok(typeof v === "string" || (typeof v === "number" && Number.isFinite(v)), `${where}: param ${k}`)
    if (k === "count") assert.equal(typeof v, "number", `${where}: count must be a number`)
  }
  assert.ok(!DASHES.test(m.fallback), `${where}: fallback has a dash: ${m.fallback}`)
}

function checkLink(l: Link, allow: readonly string[], where: string): void {
  if (l.kind === "admin") assert.equal(safeAdminPath(l.href), l.href, `${where}: unsafe admin path ${l.href}`)
  else if (l.kind === "external") assert.ok(safeExternalUrl(l.href, allow), `${where}: external link ${l.href} not https on the list`)
  else assert.fail(`${where}: unknown link kind`)
}

function checkSummary(s: EntitySummary, routes: IntegrationRoutes, entity: EntityKind, id: string): void {
  const def = routes.definition
  const where = `${def.ns} ${entity} ${id}`
  assert.equal(s.contract, KODA_CONTRACT)
  assert.equal(s.ns, def.ns)
  assert.equal(s.entity, entity)
  assert.equal(s.id, id)
  assert.ok(SUMMARY_STATES.includes(s.state), `${where}: state ${s.state}`)
  assert.equal(s.tone, TONE_OF[s.state], `${where}: tone must follow the state`)
  checkMessage(s.title, def.texts, `${where} title`)
  if (s.detail) checkMessage(s.detail, def.texts, `${where} detail`)
  for (const f of s.facts) {
    assert.ok(FACT_SLOTS.includes(f.slot), `${where}: slot ${f.slot}`)
    assert.ok(f.priority >= 0 && f.priority <= 100, `${where}: priority`)
    checkMessage(f.value, def.texts, `${where} fact ${f.slot}`)
    if (f.sub) checkMessage(f.sub, def.texts, `${where} fact ${f.slot} sub`)
    if (f.link) checkLink(f.link, def.externalHosts ?? [], `${where} fact ${f.slot}`)
  }
  for (const l of s.links) checkLink(l, def.externalHosts ?? [], `${where} link`)
  for (const v of Object.values(s.counts)) assert.equal(typeof v, "number")
  if (s.widget !== null) assert.ok(def.widgets.some((w) => w.id === s.widget), `${where}: widget ${s.widget} is not in the manifest`)
  assert.equal(typeof s.stale, "boolean")
}

/** Minimal Express-like response for the HTTP handlers. */
export function fakeResponse() {
  const res: any = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: unknown) => {
    res.body = body
    return res
  }
  res.end = () => res
  res.setHeader = (k: string, v: string) => {
    res.headers[k.toLowerCase()] = v
    return res
  }
  return res
}

export function conformance(input: ConformanceInput): void {
  const { routes, scope, entity, knownIds } = input
  const def = routes.definition
  const ctx = (lang: "en" | "pl" = "en") => makeContext({ scope, lang, actorId: input.actorId ?? "user_test", actorType: "user" })
  const req = (query: Record<string, string>, headers: Record<string, string> = {}) =>
    ({ scope, query, headers, auth_context: { actor_id: input.actorId ?? "user_test", actor_type: "user" } }) as any

  test(`${def.ns}: integration texts match in English and Polish`, () => {
    checkTexts(def.texts)
  })

  test(`${def.ns}: manifest`, async () => {
    for (const lang of ["en", "pl"] as const) {
      const m = await routes.build.manifest(ctx(lang))
      assert.equal(m.contract, KODA_CONTRACT)
      assert.ok(m.contracts.includes(KODA_CONTRACT))
      assert.equal(m.ns, def.ns)
      assert.match(m.package, /^@koda-plus\/medusa-plugin-[a-z-]+$/)
      assert.match(m.version, /^\d+\.\d+\.\d+/)
      assert.match(m.kit, /^\d+\.\d+\.\d+/)
      assert.ok(["live", "sandbox", "demo", "off"].includes(m.mode))
      assert.equal(safeAdminPath(m.adminPath), m.adminPath)
      assert.ok(m.entities.every((e) => ENTITY_KINDS.includes(e)))
      assert.ok(m.attention.every((s) => ATTENTION_SCOPES.includes(s)))
      for (const p of m.problems) checkMessage(p, def.texts, `${def.ns} manifest problem`)
    }
  })

  test(`${def.ns}: summaries of known records, one by one and in a batch, in both languages`, async () => {
    assert.ok(def.entities.includes(entity), `${entity} is not in the manifest`)
    for (const lang of ["en", "pl"] as const) {
      const batch = await routes.build.summaries(ctx(lang), entity, knownIds)
      assert.equal(batch.length, knownIds.length)
      batch.forEach((s, i) => checkSummary(s, routes, entity, knownIds[i]))
    }
    const before = input.writes?.().length ?? 0
    await routes.build.summaries(ctx(), entity, knownIds)
    await routes.build.attention(ctx(), [...def.attention])
    await routes.build.manifest(ctx())
    if (input.writes) assert.equal(input.writes().length, before, `${def.ns}: answering wrote something`)
  })

  test(`${def.ns}: an unknown record answers state none`, async () => {
    const [s] = await routes.build.summaries(ctx(), entity, ["zz_unknown_000"])
    assert.equal(s.state, "none")
    assert.equal(s.tone, "grey")
  })

  test(`${def.ns}: counters`, async () => {
    for (const lang of ["en", "pl"] as const) {
      const a = await routes.build.attention(ctx(lang), [...def.attention])
      assert.equal(a.contract, KODA_CONTRACT)
      for (const c of a.items) {
        assert.ok(def.attention.includes(c.scope), `${def.ns}: counter ${c.key} scope ${c.scope}`)
        assert.ok(Number.isInteger(c.count) && c.count >= 0)
        assert.ok(["red", "orange", "blue"].includes(c.tone))
        checkMessage(c.label, def.texts, `${def.ns} counter ${c.key}`)
        assert.equal(c.label.params?.count, c.count)
        checkLink(c.link, def.externalHosts ?? [], `${def.ns} counter ${c.key}`)
      }
    }
  })

  test(`${def.ns}: HTTP: entity outside the manifest is 400, bad ids are 400, ETag gives 304`, async () => {
    const other = ENTITY_KINDS.find((e) => !def.entities.includes(e))
    if (other) {
      const res = fakeResponse()
      await routes.summary(req({ entity: other, id: "x_1" }), res)
      assert.equal(res.statusCode, 400)
      assert.equal((res.body as any).code, "unsupported_entity")
    }
    const bad = fakeResponse()
    await routes.summary(req({ entity, id: "../etc" }), bad)
    assert.equal(bad.statusCode, 400)
    const tooMany = fakeResponse()
    await routes.summary(req({ entity, ids: Array.from({ length: 51 }, (_, i) => `id_${i}`).join(",") }), tooMany)
    assert.equal(tooMany.statusCode, 400)

    const first = fakeResponse()
    await routes.manifest(req({}), first)
    assert.equal(first.statusCode, 200)
    assert.equal(first.headers["x-koda-contract"], "1")
    const etag = first.headers["etag"]
    assert.ok(etag)
    const second = fakeResponse()
    await routes.manifest(req({}, { "if-none-match": etag }), second)
    assert.equal(second.statusCode, 304)

    const single = fakeResponse()
    await routes.summary(req({ entity, id: knownIds[0] }), single)
    assert.equal(single.statusCode, 200)
    assert.equal((single.body as EntitySummary).id, knownIds[0])
    const many = fakeResponse()
    await routes.summary(req({ entity, ids: knownIds.join(",") }), many)
    assert.equal(many.statusCode, 200)
    assert.equal((many.body as any).items.length, knownIds.length)
    const scope400 = fakeResponse()
    await routes.attention(req({ scope: "orders,nonsense" }), scope400)
    assert.equal(scope400.statusCode, 400)
  })
}
