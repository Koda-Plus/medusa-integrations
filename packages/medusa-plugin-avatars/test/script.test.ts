/**
 * Stage 2: the script. Its shape and writing rules, the background run
 * (lease, retries, final failures), editing and approving with the hash,
 * the voice preview, and the small pure parts of the Gemini and Claude
 * clients. Nothing here calls a paid API: the steps are injected.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { checkScript, parseScript, scriptJsonSchema, targetsFor, type Script } from "../src/modules/avatars/lib/script.ts"
import { GeminiError, mimeOf, speechPrompt, wav } from "../src/modules/avatars/lib/gemini.ts"
import { ClaudeError, userMessage, writeScript, type WriteInput } from "../src/modules/avatars/lib/claude.ts"
import { DEMO_SCRIPT } from "../src/workflows/avatars/demo.ts"
import { MAX_ATTEMPTS, approveScript, previewSlide, runPipeline, saveScript, scriptHash, startScript, type Steps } from "../src/workflows/avatars/script.ts"
import { fakeScope } from "./helpers.ts"

const KEYS = { anthropicApiKey: "sk-ant-test-key", geminiApiKey: "gm-test-key" }
const LONG = "The lecturer explains how a calm routine at the start of a shift keeps people safe. ".repeat(20).trim()

const demo = (): Script => {
  const r = parseScript(structuredClone(DEMO_SCRIPT))
  assert.ok(r.ok, "the demo script parses")
  return r.script
}

function presentation(extra: Record<string, unknown> = {}) {
  return { id: "avp_1", title: "Safety", lang: "en", state: "draft", source_kind: "text", source_text: LONG, source_file_url: null, transcript: null, target_minutes: 4, avatar_id: null, script: null, script_hash: null, approved_hash: null, metadata: null, deleted_at: null, ...extra }
}

test("script: the demo parses, broken shapes are named", () => {
  demo()
  assert.deepEqual(parseScript("x"), { ok: false, issues: [{ code: "not_object", at: "script" }] })
  const bad = structuredClone(DEMO_SCRIPT) as unknown as { slides: Array<Record<string, unknown>>; quiz: Array<Record<string, unknown>> }
  bad.slides[1].layout = "spiral"
  bad.quiz[0].correct = 9
  const r = parseScript(bad)
  assert.equal(r.ok, false)
  const codes = r.ok ? [] : r.issues.map((i) => i.code)
  assert.ok(codes.includes("layout_unknown"))
  assert.ok(codes.includes("correct_invalid"))
})

test("script: writing rules catch dashes, digits, order and repeated layouts", () => {
  const s = demo()
  s.slides[0].layout === "title" && (s.slides[0].heading = `Safety ${String.fromCharCode(0x2014)} basics`)
  s.slides[0].narration = `${s.slides[0].narration} We have 3 rules.`
  s.slides[1].id = "s09"
  const codes = checkScript(s, targetsFor(4, 135)).map((i) => i.code)
  assert.ok(codes.includes("dash"))
  assert.ok(codes.includes("spoken_char"))
  assert.ok(codes.includes("id_order"))

  const t = demo()
  const first = t.slides[0]
  t.slides[0] = { ...t.slides[1], id: first.id }
  assert.ok(checkScript(t, targetsFor(4, 135)).some((i) => i.code === "first_not_title"))
})

test("script: the schema for structured output has no size constraints", () => {
  const json = JSON.stringify(scriptJsonSchema())
  for (const word of ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"]) assert.ok(!json.includes(word), word)
  assert.ok(json.includes('"additionalProperties":false'))
})

test("script: the hash ignores key order and changes with the text", () => {
  const a = demo()
  const reversed = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(reversed) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v
  const b = reversed(a) as Script
  assert.equal(scriptHash(a), scriptHash(b))
  b.title = `${b.title}!`
  assert.notEqual(scriptHash(a), scriptHash(b))
})

test("start: needs a source and the keys, unless demo", async () => {
  const empty = fakeScope({ presentations: [presentation({ source_text: null })], options: KEYS })
  assert.deepEqual((await startScript(empty.scope, "avp_1", null)).ok, false)

  const noKeys = fakeScope({ presentations: [presentation({ source_kind: "recording", source_text: null, source_file_url: "https://files.test/a.mp3" })] })
  const r = await startScript(noKeys.scope, "avp_1", null)
  assert.ok(!r.ok && r.problems.includes("claude_missing") && r.problems.includes("gemini_missing"))

  const ok = fakeScope({ presentations: [presentation({ source_kind: "recording", source_text: null, source_file_url: "https://files.test/a.mp3" })], options: KEYS })
  const s = await startScript(ok.scope, "avp_1", "user_1")
  assert.ok(s.ok)
  assert.equal(ok.rows.presentations[0].state, "transcribing")
  assert.equal((await startScript(ok.scope, "avp_1", null)).ok, false, "a running one does not start twice")
})

test("pipeline: transcribe, then script, then review with a hash", async () => {
  const f = fakeScope({ presentations: [presentation({ source_kind: "recording", source_text: null, source_file_url: "https://files.test/a.mp3" })], options: KEYS })
  await startScript(f.scope, "avp_1", null)
  const calls: string[] = []
  const steps: Steps = {
    transcribe: async () => (calls.push("transcribe"), LONG),
    write: async (_o, input) => (calls.push(`write:${input.previous ? "fix" : "first"}`), { raw: structuredClone(DEMO_SCRIPT), usage: { output_tokens: 10 } }),
  }
  const now = new Date("2026-11-26T10:00:00Z")
  assert.deepEqual(await runPipeline(f.scope, { steps, now }), { ran: 1, done: 1, failed: 0 })
  const row = f.rows.presentations[0]
  assert.equal(row.state, "scripting")
  assert.equal(row.transcript, LONG)
  await runPipeline(f.scope, { steps, now })
  assert.equal(row.state, "review")
  assert.equal(row.script_hash, scriptHash(demo()))
  assert.equal(calls[0], "transcribe")
  assert.equal(calls[1], "write:first")
  const meta = row.metadata as { pipeline: { lease_until: unknown; issues?: unknown[] } }
  assert.equal(meta.pipeline.lease_until, null)
  assert.ok(Array.isArray(meta.pipeline.issues))
})

test("pipeline: a lease holds the row, busy errors retry, then fail", async () => {
  const f = fakeScope({ presentations: [presentation()], options: KEYS })
  await startScript(f.scope, "avp_1", null)
  const row = f.rows.presentations[0]
  let started = 0
  const steps: Steps = {
    transcribe: async () => LONG,
    write: async () => {
      started++
      /* While a step runs, another run must not take the same row. */
      assert.equal((await runPipeline(f.scope, { steps: { ...steps, write: async () => assert.fail("taken twice") }, now: t0 })).ran, 0)
      throw new GeminiError("unavailable", "busy")
    },
  }
  const t0 = new Date("2026-11-26T10:00:00Z")
  await runPipeline(f.scope, { steps, now: t0 })
  assert.equal(row.state, "scripting")
  assert.match(String(row.error), /^unavailable/)
  assert.equal((await runPipeline(f.scope, { steps, now: t0 })).ran, 0, "the backoff waits")
  let t = t0.getTime()
  for (let i = 2; i <= MAX_ATTEMPTS; i++) {
    t += 60 * 60_000
    await runPipeline(f.scope, { steps, now: new Date(t) })
  }
  assert.equal(started, MAX_ATTEMPTS)
  assert.equal(row.state, "failed")
})

test("pipeline: a refusal and a short source fail at once", async () => {
  const f = fakeScope({ presentations: [presentation()], options: KEYS })
  await startScript(f.scope, "avp_1", null)
  await runPipeline(f.scope, { steps: { transcribe: async () => LONG, write: async () => { throw new ClaudeError("refused", "no") } } })
  assert.equal(f.rows.presentations[0].state, "failed")

  const g = fakeScope({ presentations: [presentation({ source_text: "Too short." })], options: KEYS })
  await startScript(g.scope, "avp_1", null)
  await runPipeline(g.scope, { steps: { transcribe: async () => LONG, write: async () => assert.fail("not called") } })
  assert.equal(g.rows.presentations[0].state, "failed")
  assert.match(String(g.rows.presentations[0].error), /^source_too_short/)
})

test("pipeline: demo mode writes the sample script without keys", async () => {
  const f = fakeScope({ presentations: [presentation()], options: { demo: true } })
  assert.ok((await startScript(f.scope, "avp_1", null)).ok)
  await runPipeline(f.scope)
  assert.equal(f.rows.presentations[0].state, "review")
})

test("save and approve: the hash must match, an edit takes the approval back", async () => {
  const s = demo()
  const f = fakeScope({ presentations: [presentation({ state: "review", script: s, script_hash: scriptHash(s) })], options: KEYS })
  const row = f.rows.presentations[0]
  assert.deepEqual((await approveScript(f.scope, "avp_1", { script_hash: "old" }, null)).ok, false)
  const a = await approveScript(f.scope, "avp_1", { script_hash: scriptHash(s) }, "user_1")
  assert.ok(a.ok)
  assert.equal(row.state, "approved")

  const same = await saveScript(f.scope, "avp_1", { script: s })
  assert.ok(same.ok)
  assert.equal(row.state, "approved", "saving the same script keeps the approval")

  const edited = { ...s, title: `${s.title} 2` }
  const r = await saveScript(f.scope, "avp_1", { script: edited })
  assert.ok(r.ok)
  assert.equal(row.state, "review")
  assert.notEqual(row.script_hash, row.approved_hash)

  const broken = await saveScript(f.scope, "avp_1", { script: { title: "x" } })
  assert.ok(!broken.ok && broken.status === 400 && (broken.issues ?? []).length > 0)
})

test("preview: demo gives silence, live uses the avatar's voice once per text", async () => {
  const s = demo()
  const d = fakeScope({ presentations: [presentation({ state: "review", script: s })], options: { demo: true } })
  const silent = await previewSlide(d.scope, "avp_1", { item: "s01" })
  assert.ok(silent.ok && silent.audio.subarray(0, 4).toString() === "RIFF")
  assert.equal((await previewSlide(d.scope, "avp_1", { item: "s99" })).ok, false)

  const f = fakeScope({ avatars: [{ id: "avt_1", voice: "Puck", deleted_at: null }], presentations: [presentation({ state: "review", script: s, avatar_id: "avt_1" })], options: KEYS })
  const voices: string[] = []
  const synth = async (_c: unknown, i: { voice: string }) => (voices.push(i.voice), wav(Buffer.alloc(4), 24000))
  const text = `Preview ${Date.now()}.`
  assert.ok((await previewSlide(f.scope, "avp_1", { item: "s01", text }, synth as never)).ok)
  assert.ok((await previewSlide(f.scope, "avp_1", { item: "s01", text }, synth as never)).ok)
  assert.deepEqual(voices, ["Puck"])
  const failed = await previewSlide(f.scope, "avp_1", { item: "s01", text: `${text} x` }, (async () => { throw new GeminiError("no_audio", "x") }) as never)
  assert.ok(!failed.ok && failed.status === 502 && failed.problems[0] === "no_audio")
})

test("gemini: mime types, the WAV header, director's notes", () => {
  assert.equal(mimeOf("https://x.test/a.m4a?sig=1", null), "audio/m4a")
  assert.equal(mimeOf("https://x.test/a", "video/mp4; codecs=x"), "video/mp4")
  assert.equal(mimeOf("https://x.test/a.bin", "application/octet-stream"), "audio/mpeg")
  const w = wav(Buffer.alloc(100), 24000)
  assert.equal(w.length, 144)
  assert.equal(w.readUInt32LE(24), 24000)
  assert.equal(w.readUInt32LE(40), 100)
  assert.equal(speechPrompt("", "Hello."), "Hello.")
  assert.equal(speechPrompt("Calm.", "Hello."), "Calm.\n#### TRANSCRIPT\nHello.")
})

test("claude: the correction round carries the issues, a refusal is a code", async () => {
  const input: WriteInput = { title: "T", lang: "pl", source: LONG, minutes: 4, wordsPerMinute: 135, targets: targetsFor(4, 135), brief: "", previous: { raw: { a: 1 }, issues: [{ code: "dash", at: "slides[1]" }] } }
  const msg = userMessage(input)
  assert.ok(msg.includes("slides[1]: no long or medium dashes"))
  const client = (stop: string, text = "{}") => ({ beta: { messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: stop, model: "m", content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 2 } }) }) } } }) as never
  await assert.rejects(writeScript("k", "m", input, client("refusal")), (e: unknown) => e instanceof ClaudeError && e.code === "refused")
  await assert.rejects(writeScript("k", "m", input, client("max_tokens")), (e: unknown) => e instanceof ClaudeError && e.code === "truncated")
  await assert.rejects(writeScript("k", "m", input, client("end_turn", "not json")), (e: unknown) => e instanceof ClaudeError && e.code === "not_json")
  const ok = await writeScript("k", "m", input, client("end_turn", '{"title":"x"}'))
  assert.deepEqual(ok.raw, { title: "x" })
})

test("pipeline: a step that died without an answer stops after the attempts", async () => {
  const f = fakeScope({ presentations: [presentation({ state: "scripting", metadata: { pipeline: { attempts: MAX_ATTEMPTS, lease_until: null } } })], options: KEYS })
  const r = await runPipeline(f.scope, { steps: { transcribe: async () => LONG, write: async () => assert.fail("not paid again") } })
  assert.deepEqual(r, { ran: 0, done: 0, failed: 1 })
  assert.equal(f.rows.presentations[0].state, "failed")
})

test("pipeline: a cut answer is final, a failed correction keeps the first script", async () => {
  const f = fakeScope({ presentations: [presentation()], options: KEYS })
  await startScript(f.scope, "avp_1", null)
  await runPipeline(f.scope, { steps: { transcribe: async () => LONG, write: async () => { throw new ClaudeError("truncated", "cut") } } })
  assert.equal(f.rows.presentations[0].state, "failed")

  const g = fakeScope({ presentations: [presentation()], options: KEYS })
  await startScript(g.scope, "avp_1", null)
  let n = 0
  await runPipeline(g.scope, { steps: { transcribe: async () => LONG, write: async () => { if (n++ === 0) return { raw: structuredClone(DEMO_SCRIPT), usage: {} }; throw new GeminiError("unavailable", "busy") } } })
  assert.equal(g.rows.presentations[0].state, "review")
})

test("pipeline: a short transcript is not kept, a retry transcribes again", async () => {
  const f = fakeScope({ presentations: [presentation({ source_kind: "recording", source_text: null, source_file_url: "https://files.test/a.mp3" })], options: KEYS })
  await startScript(f.scope, "avp_1", null)
  await runPipeline(f.scope, { steps: { transcribe: async () => "Too short.", write: async () => assert.fail("not called") } })
  assert.equal(f.rows.presentations[0].state, "failed")
  assert.equal(f.rows.presentations[0].transcript, null)
  await startScript(f.scope, "avp_1", null)
  assert.equal(f.rows.presentations[0].state, "transcribing")
})

test("save: a save over a newer one is refused", async () => {
  const s = demo()
  const f = fakeScope({ presentations: [presentation({ state: "review", script: s, script_hash: scriptHash(s) })], options: KEYS })
  const r = await saveScript(f.scope, "avp_1", { script: { ...s, title: "Mine" }, base_hash: "older" })
  assert.ok(!r.ok && r.status === 409 && r.problems[0] === "stale")
  assert.ok((await saveScript(f.scope, "avp_1", { script: { ...s, title: "Mine" }, base_hash: scriptHash(s) })).ok)
})

test("script: an empty answer is refused, not dropped", () => {
  const bad = structuredClone(DEMO_SCRIPT) as unknown as { quiz: Array<{ answers: string[] }> }
  bad.quiz[0].answers[0] = " "
  const r = parseScript(bad)
  assert.ok(!r.ok && r.issues.some((i) => i.code === "missing" && i.at.startsWith("quiz[0].answers")))
})
