/**
 * The options and the admin flows of this stage: forms are checked field by
 * field, keys never leak, running or used rows are protected from deletion,
 * the demo seeds once and only in demo mode.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { configuredServices, maskSecrets, resolveOptions, secretsOf } from "../src/modules/avatars/lib/options.ts"
import { avatarInput, presentationInput } from "../src/modules/avatars/lib/validation.ts"
import { scriptStats, toPresentation } from "../src/modules/avatars/lib/store.ts"
import { createAvatar, deleteAvatar } from "../src/workflows/avatars/avatars.ts"
import { createPresentation, deletePresentation } from "../src/workflows/avatars/presentations.ts"
import { seedDemo } from "../src/workflows/avatars/demo.ts"
import { fakeScope } from "./helpers.ts"

test("options: defaults, broken values fall back, demo only when asked", () => {
  const o = resolveOptions(undefined)
  assert.equal(o.demo, false)
  assert.equal(o.defaultLang, "pl")
  assert.equal(o.wordsPerMinute, 135)
  assert.equal(o.maxRenderMinutes, 30)
  assert.equal(o.filePrefix, "avatars/")
  assert.deepEqual(configuredServices(o), { tavus: false, claude: false, gemini: false })

  const odd = resolveOptions({ demo: "true", defaultLang: "xx", wordsPerMinute: "9999", maxRenderMinutes: "45", filePrefix: "../etc/" })
  assert.equal(odd.demo, true)
  assert.equal(odd.defaultLang, "pl")
  assert.equal(odd.wordsPerMinute, 135)
  assert.equal(odd.maxRenderMinutes, 45)
  assert.equal(odd.filePrefix, "avatars/")
})

test("options: keys are masked wherever they would appear", () => {
  const o = resolveOptions({ tavusApiKey: "tvs_secret_123456", anthropicApiKey: "sk-ant-abcdefgh", geminiApiKey: "short" })
  assert.deepEqual(configuredServices(o), { tavus: true, claude: true, gemini: true })
  const masked = maskSecrets("401 for key tvs_secret_123456 and sk-ant-abcdefgh", secretsOf(o))
  assert.ok(!masked.includes("tvs_secret_123456"))
  assert.ok(!masked.includes("sk-ant-abcdefgh"))
})

test("validation: avatar and presentation forms name each problem", () => {
  const a = avatarInput({ name: "", face_id: "bad id!" }, "Kore")
  assert.equal(a.ok, false)
  if (!a.ok) assert.deepEqual(a.problems, ["name_missing", "face_invalid"])
  const okAvatar = avatarInput({ name: "Anna", face_id: "r1234abcd" }, "Kore")
  assert.equal(okAvatar.ok && okAvatar.values.voice, "Kore")

  const p = presentationInput({ title: "", source_kind: "text", target_minutes: 40 }, "pl")
  assert.equal(p.ok, false)
  if (!p.ok) assert.deepEqual(p.problems, ["title_missing", "text_missing", "minutes_invalid"])
  const rec = presentationInput({ title: "Module 1", source_kind: "recording" }, "pl")
  if (!rec.ok) assert.deepEqual(rec.problems, ["file_missing"])
  const ok = presentationInput({ title: "Module 1", source_kind: "text", source_text: "Lecture text", lang: "de" }, "pl")
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.values.lang, "de")
    assert.equal(ok.values.target_minutes, 12)
    assert.equal(ok.values.source_file_url, null)
  }
})

test("store: the script is read defensively, approval needs the current hash", () => {
  assert.deepEqual(scriptStats(null), { slides: 0, words: 0 })
  assert.deepEqual(scriptStats({ slides: "nope" }), { slides: 0, words: 0 })
  assert.deepEqual(scriptStats({ slides: [{ narration: "one two three" }, { narration: 5 }, null] }), { slides: 3, words: 3 })
  const base = { id: "avp_1", title: "T", script: { slides: [{ narration: "a b c d" }] }, script_hash: "h2", approved_hash: "h1" }
  assert.equal(toPresentation(base, 135).approved, false)
  assert.equal(toPresentation({ ...base, approved_hash: "h2" }, 135).approved, true)
})

test("flows: create, refuse unknown avatars, protect used and running rows", async () => {
  const { scope, rows } = fakeScope()
  const avatar = await createAvatar(scope, { name: "Anna", face_id: "r1234abcd" })
  assert.equal(avatar.ok, true)
  assert.equal(rows.avatars[0].consent_state, "none")

  const bad = await createPresentation(scope, { title: "M1", source_text: "text", avatar_id: "avt_404" }, "user_1")
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.deepEqual(bad.problems, ["avatar_not_found"])

  const created = await createPresentation(scope, { title: "M1", source_text: "text", avatar_id: rows.avatars[0].id }, "user_1")
  assert.equal(created.ok, true)
  const pres = rows.presentations[0]
  assert.equal(pres.state, "draft")
  assert.equal(pres.created_by, "user_1")

  pres.state = "rendering"
  const inUse = await deleteAvatar(scope, rows.avatars[0].id)
  assert.equal(inUse.ok, false)
  if (!inUse.ok) assert.equal(inUse.status, 409)
  const running = await deletePresentation(scope, pres.id)
  assert.equal(running.ok, false)
  if (!running.ok) assert.deepEqual(running.problems, ["running"])

  pres.state = "approved"
  const approved = await deleteAvatar(scope, rows.avatars[0].id)
  assert.equal(approved.ok, false)

  pres.state = "draft"
  assert.equal((await deleteAvatar(scope, rows.avatars[0].id)).ok, true)
  assert.equal(pres.avatar_id, null)
  assert.equal((await deletePresentation(scope, pres.id)).ok, true)
})

test("demo: seeds once, only in demo mode, everything flagged", async () => {
  const off = fakeScope()
  assert.deepEqual(await seedDemo(off.scope), { created: false })
  assert.equal(off.rows.avatars.length, 0)

  const on = fakeScope({ options: { demo: true } })
  assert.deepEqual(await seedDemo(on.scope), { created: true })
  assert.deepEqual(await seedDemo(on.scope), { created: false })
  assert.equal(on.rows.avatars.length, 1)
  assert.equal(on.rows.presentations.length, 1)
  assert.ok([...on.rows.avatars, ...on.rows.presentations].every((r) => r.demo === true))
})
