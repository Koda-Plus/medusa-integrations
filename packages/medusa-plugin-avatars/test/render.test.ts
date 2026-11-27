/**
 * Stage 3: the render. The quote (speech made and measured, nothing
 * ordered), the confirmation of exactly that quote, the scheduled run
 * (order once, follow, store the clip, fail or stall), publishing and what
 * the store sees. Tavus, Gemini and the File Module are fakes: nothing here
 * calls a paid API.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { silence, wav } from "../src/modules/avatars/lib/gemini.ts"
import { clipSignature, isPublicUrl, quoteHash, quoteMinutes, renderItems, wavDurationMs } from "../src/modules/avatars/lib/render.ts"
import { createVideo, getVideo, progressOf, TavusError } from "../src/modules/avatars/lib/tavus.ts"
import { parseScript } from "../src/modules/avatars/lib/script.ts"
import { toStorePresentation } from "../src/modules/avatars/lib/published.ts"
import { DEMO_SCRIPT } from "../src/workflows/avatars/demo.ts"
import { cancelRender, CLIP_DEADLINE_MS, FETCH_ATTEMPTS, newestPerItem, publishPresentation, quoteRender, runRender, startRender, STALL_MS, unpublishPresentation, type FilesLike, type LockLike } from "../src/workflows/avatars/render.ts"
import { deletePresentation } from "../src/workflows/avatars/presentations.ts"
import { scriptHash, startScript } from "../src/workflows/avatars/script.ts"
import { fakeScope } from "./helpers.ts"
import { POST as quoteRoute } from "../src/api/admin/avatars/presentations/[id]/render/quote/route.ts"

const KEYS = { tavusApiKey: "tvs-test-key-123", geminiApiKey: "gm-test-key-123", anthropicApiKey: "sk-ant-test-key" }

const script = () => {
  const r = parseScript(structuredClone({ ...DEMO_SCRIPT, shorts: [{ id: "k01", title: "Alarm", narration: "When the alarm sounds, stop, leave and meet at the assembly point.", slide: "s02" }] }))
  assert.ok(r.ok)
  return r.script
}

function fakeFiles() {
  const stored = new Map<string, { url: string; bytes: number; mime: string }>()
  let n = 0
  const files: FilesLike & { stored: typeof stored; deleted: string[] } = {
    stored,
    deleted: [],
    async createFiles(data) {
      return data.map((d) => {
        const id = `file_${++n}`
        const url = `https://media.example.com/${d.filename}`
        stored.set(id, { url, bytes: Buffer.from(d.content, "base64").length, mime: d.mimeType })
        return { id, url }
      })
    },
    async deleteFiles(ids) {
      for (const id of ids) {
        files.deleted.push(id)
        stored.delete(id)
      }
    },
  }
  return files
}

/** Four seconds of speech per call, and a count of the calls. */
function fakeSynth() {
  const calls: string[] = []
  const synth = async (_cfg: unknown, input: { text: string }) => {
    calls.push(input.text)
    return wav(Buffer.alloc(24000 * 2 * 4), 24000)
  }
  return { synth: synth as never, calls }
}

function setup(extra: { avatar?: Record<string, unknown>; presentation?: Record<string, unknown>; options?: Record<string, unknown> } = {}) {
  const s = script()
  const hash = scriptHash(s)
  const avatar = { id: "avt_1", name: "Anna", face_id: "r_face_1", voice: "Puck", consent_state: "signed", consent_file_url: "https://media.example.com/consent.pdf", consent_signed_by: "Anna Example", consent_signed_at: new Date("2026-11-01"), deleted_at: null, ...extra.avatar }
  const presentation = { id: "avp_1", title: "Safety", lang: "en", state: "approved", script: s, script_hash: hash, approved_hash: hash, avatar_id: "avt_1", target_minutes: 4, metadata: null, deleted_at: null, ...extra.presentation }
  const f = fakeScope({ avatars: [avatar], presentations: [presentation], options: { ...KEYS, ...extra.options } as never })
  return { ...f, files: fakeFiles(), s, hash }
}

/** A Tavus and a download host in one fetch. */
function fakeTavus(opts: { status?: () => Record<string, unknown>; post?: () => Response | Promise<Response> } = {}) {
  const posts: unknown[] = []
  const gets: string[] = []
  let n = 0
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === "HEAD") return new Response(null, { status: 200 })
    if (u.endsWith("/v2/videos") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)))
      if (opts.post) return opts.post()
      return Response.json({ video_id: `vid_${++n}`, status: "queued" })
    }
    if (u.includes("/v2/videos/")) {
      gets.push(u)
      const id = u.split("/").pop()
      return Response.json({ video_id: id, ...(opts.status ? opts.status() : { status: "generating", generation_progress: "10/100" }) })
    }
    if (u.startsWith("https://cdn.tavus.example/")) return new Response(Buffer.from("fake mp4 bytes"), { status: 200, headers: { "content-length": "14" } })
    return new Response("not found", { status: 404 })
  }) as typeof fetch
  return { impl, posts, gets }
}

/* ------------------------------------------------------------------ */

test("render: pure parts (items, signature, WAV length, minutes, public URLs, progress)", () => {
  const s = script()
  assert.deepEqual(renderItems(s, false).map((i) => i.item_id), ["s01", "s02"])
  assert.deepEqual(renderItems(s, true).map((i) => i.item_id), ["s01", "s02", "k01"])
  const base = { faceId: "f", voice: "Puck", ttsModel: "m", style: "", text: "Hello" }
  assert.equal(clipSignature(base), clipSignature({ ...base }))
  assert.notEqual(clipSignature(base), clipSignature({ ...base, voice: "Kore" }))
  assert.equal(wavDurationMs(silence(3)), 3000)
  assert.equal(wavDurationMs(Buffer.from("not a wav file at all, just text of some length here")), null)
  assert.equal(quoteMinutes([{ item_id: "a", signature: "x", duration_ms: 61_000, reused: false }, { item_id: "b", signature: "y", duration_ms: 600_000, reused: true }]), 1.1)
  const clips = [{ item_id: "s02", signature: "b", duration_ms: 1, reused: false }, { item_id: "s01", signature: "a", duration_ms: 2, reused: true }]
  assert.equal(quoteHash("h", "f", clips), quoteHash("h", "f", [...clips].reverse()), "order of clips does not matter")
  assert.notEqual(quoteHash("h", "f", clips), quoteHash("h", "other face", clips))
  assert.equal(isPublicUrl("https://media.example.com/a.wav"), true)
  for (const bad of ["http://media.example.com/a.wav", "https://localhost:9000/a.wav", "https://127.0.0.1/a.wav", "https://192.168.1.5/a.wav", "https://10.0.0.1/a", "/static/a.wav", "nonsense"]) assert.equal(isPublicUrl(bad), false, bad)
  assert.equal(progressOf("33/100"), 33)
  assert.equal(progressOf("7"), 7)
  assert.equal(progressOf(undefined), 0)
  assert.equal(progressOf("150/100"), 100)
})

test("tavus: an order is never retried, its unknown outcome is named", async () => {
  let calls = 0
  const down = (async () => {
    calls++
    throw new Error("socket hang up")
  }) as typeof fetch
  await assert.rejects(createVideo({ apiKey: "k", fetchImpl: down }, { replicaId: "r", audioUrl: "https://a/b.wav", name: "x" }), (e: unknown) => e instanceof TavusError && e.code === "order_unknown")
  assert.equal(calls, 1)
  const busy = (async () => new Response("oops", { status: 502 })) as typeof fetch
  await assert.rejects(createVideo({ apiKey: "k", fetchImpl: busy }, { replicaId: "r", audioUrl: "https://a/b.wav", name: "x" }), (e: unknown) => e instanceof TavusError && e.code === "order_unknown")
  const limited = (async () => new Response("slow down", { status: 429 })) as typeof fetch
  await assert.rejects(createVideo({ apiKey: "k", fetchImpl: limited }, { replicaId: "r", audioUrl: "https://a/b.wav", name: "x" }), (e: unknown) => e instanceof TavusError && e.code === "rate_limited")
  const refused = (async () => Response.json({ message: "invalid replica" }, { status: 400 })) as typeof fetch
  await assert.rejects(createVideo({ apiKey: "k", fetchImpl: refused }, { replicaId: "r", audioUrl: "https://a/b.wav", name: "x" }), (e: unknown) => e instanceof TavusError && e.code === "http" && /invalid replica/.test(e.message))
})

test("tavus: the status is retried on 5xx and read with its progress", async () => {
  let n = 0
  const flaky = (async () => (++n < 3 ? new Response("busy", { status: 503 }) : Response.json({ video_id: "v1", status: "generating", generation_progress: "45/100" }))) as typeof fetch
  const v = await getVideo({ apiKey: "k", fetchImpl: flaky, sleep: async () => {} }, "v1")
  assert.equal(v.progress, 45)
  assert.equal(n, 3)
  const gone = (async () => new Response("no such video", { status: 404 })) as typeof fetch
  await assert.rejects(getVideo({ apiKey: "k", fetchImpl: gone, sleep: async () => {} }, "v1"), (e: unknown) => e instanceof TavusError && e.code === "gone")
  const refused = (async () => new Response("bad key", { status: 401 })) as typeof fetch
  await assert.rejects(getVideo({ apiKey: "k", fetchImpl: refused, sleep: async () => {} }, "v1"), (e: unknown) => e instanceof TavusError && e.code === "auth")
})

test("quote: speech per clip, stored as public files, exact minutes, nothing ordered", async () => {
  const { scope, rows, files } = setup()
  const { synth, calls } = fakeSynth()
  const r = await quoteRender(scope, "avp_1", { shorts: true }, { files, synth })
  assert.ok(r.ok, JSON.stringify(r))
  assert.equal(calls.length, 3)
  assert.equal(r.quote.minutes, 0.2, "three clips of 4 s are 12 s, rounded up to a tenth of a minute")
  assert.equal(r.quote.over_limit, false)
  assert.equal(rows.jobs.length, 3)
  assert.ok(rows.jobs.every((j) => j.state === "quoted" && String(j.audio_url).startsWith("https://media.example.com/avatars/avp_1/")))
  assert.ok([...files.stored.values()].every((f) => f.mime === "audio/wav"))

  /* The same quote again costs no second synthesis. */
  const again = await quoteRender(scope, "avp_1", {}, { files, synth })
  assert.ok(again.ok)
  assert.equal(calls.length, 3)
  assert.equal(again.quote.quote_hash, r.quote.quote_hash)
})

test("quote: refused without approval, without consent, without keys; an edited slide is one new clip", async () => {
  const noConsent = setup({ avatar: { consent_state: "revoked" } })
  const a = await quoteRender(noConsent.scope, "avp_1", {}, { files: noConsent.files, synth: fakeSynth().synth })
  assert.equal(a.ok, false)
  assert.deepEqual(a.ok ? [] : a.problems, ["consent_missing"])

  const notApproved = setup({ presentation: { approved_hash: "old", state: "review" } })
  const b = await quoteRender(notApproved.scope, "avp_1", {}, { files: notApproved.files, synth: fakeSynth().synth })
  assert.deepEqual(b.ok ? [] : b.problems, ["state"])

  const noKeys = setup({ options: { tavusApiKey: "" } })
  const c = await quoteRender(noKeys.scope, "avp_1", {}, { files: noKeys.files, synth: fakeSynth().synth })
  assert.deepEqual(c.ok ? [] : c.problems, ["tavus_missing"])

  const { scope, rows, files } = setup()
  const { synth, calls } = fakeSynth()
  assert.ok((await quoteRender(scope, "avp_1", {}, { files, synth })).ok)
  const p = rows.presentations[0] as { script: { slides: Array<{ narration: string }> } }
  p.script.slides[1].narration = `${p.script.slides[1].narration} Count everyone at the point.`
  const fresh = await quoteRender(scope, "avp_1", {}, { files, synth })
  assert.ok(fresh.ok)
  assert.equal(calls.length, 3, "two at first, one for the edited slide")
  assert.equal(files.deleted.length, 1, "the old speech of the edited slide is deleted")
})

test("start: only the quote on screen, the consent document must answer, the speech must be public", async () => {
  const { scope, rows, files } = setup()
  const q = await quoteRender(scope, "avp_1", {}, { files, synth: fakeSynth().synth })
  assert.ok(q.ok)
  const ok = (async () => new Response(null, { status: 200 })) as typeof fetch
  const stale = await startRender(scope, "avp_1", { quote_hash: "other", minutes: q.quote.minutes }, "user_1", { fetchImpl: ok })
  assert.deepEqual(stale.ok ? [] : stale.problems, ["stale_quote"])
  const wrongMinutes = await startRender(scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: 99 }, "user_1", { fetchImpl: ok })
  assert.deepEqual(wrongMinutes.ok ? [] : wrongMinutes.problems, ["stale_quote"])
  const missing = (async () => new Response(null, { status: 404 })) as typeof fetch
  const noDoc = await startRender(scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: q.quote.minutes }, "user_1", { fetchImpl: missing })
  assert.deepEqual(noDoc.ok ? [] : noDoc.problems, ["consent_file_unreachable"])

  /* A voice changed after the quote: the quote no longer describes the clips. */
  ;(rows.avatars[0] as { voice: string }).voice = "Kore"
  const changed = await startRender(scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: q.quote.minutes }, "user_1", { fetchImpl: ok })
  assert.deepEqual(changed.ok ? [] : changed.problems, ["stale_quote"])
  ;(rows.avatars[0] as { voice: string }).voice = "Puck"

  const started = await startRender(scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: q.quote.minutes }, "user_1", { fetchImpl: ok })
  assert.ok(started.ok)
  assert.equal(rows.presentations[0].state, "rendering")
  assert.ok(rows.jobs.every((j) => j.state === "queued"))

  const local = setup()
  const localFiles: FilesLike = { createFiles: async (d) => d.map((x, i) => ({ id: `f${i}`, url: `http://localhost:9000/static/${x.filename}` })), deleteFiles: async () => {} }
  const lq = await quoteRender(local.scope, "avp_1", {}, { files: localFiles, synth: fakeSynth().synth })
  assert.ok(lq.ok)
  const refused = await startRender(local.scope, "avp_1", { quote_hash: lq.quote.quote_hash, minutes: lq.quote.minutes }, null, { fetchImpl: ok })
  assert.deepEqual(refused.ok ? [] : refused.problems, ["audio_not_public"])
})

test("start: a quote above the limit is refused", async () => {
  const { scope, files } = setup({ options: { maxRenderMinutes: 1 } })
  const long = (async () => wav(Buffer.alloc(24000 * 2 * 90), 24000)) as never
  const q = await quoteRender(scope, "avp_1", {}, { files, synth: long })
  assert.ok(q.ok)
  assert.equal(q.quote.over_limit, true)
  const r = await startRender(scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: q.quote.minutes }, null, { fetchImpl: (async () => new Response(null)) as typeof fetch })
  assert.deepEqual(r.ok ? [] : r.problems, ["over_limit"])
})

async function started(extra: Parameters<typeof setup>[0] = {}) {
  const ctx = setup(extra)
  const q = await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth: fakeSynth().synth })
  assert.ok(q.ok)
  const s = await startRender(ctx.scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: q.quote.minutes }, null, { fetchImpl: (async () => new Response(null)) as typeof fetch })
  assert.ok(s.ok)
  return ctx
}

test("run: orders each clip once, follows it, stores the video, deletes the speech, the presentation is ready", async () => {
  const ctx = await started()
  let status: Record<string, unknown> = { status: "generating", generation_progress: "20/100" }
  const t = fakeTavus({ status: () => status })
  const now = new Date("2026-11-27T10:00:00Z")
  const first = await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl, sleep: async () => {} }, now })
  assert.equal(first.ordered, 2)
  assert.equal(t.posts.length, 2)
  assert.deepEqual(Object.keys(t.posts[0] as object).sort(), ["audio_url", "replica_id", "video_name"])
  assert.equal((t.posts[0] as { replica_id: string }).replica_id, "r_face_1")
  assert.ok(ctx.rows.jobs.every((j) => j.state === "rendering" && String(j.provider_video_id).startsWith("vid_")))
  assert.equal(ctx.rows.jobs[0].progress, 20)

  /* A second run orders nothing again. */
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl, sleep: async () => {} }, now: new Date(now.getTime() + 60_000) })
  assert.equal(t.posts.length, 2)

  status = { status: "ready", download_url: "https://cdn.tavus.example/clip.mp4", hosted_url: "https://videos.tavus.example/x" }
  const done = await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl, sleep: async () => {} }, now: new Date(now.getTime() + 120_000) })
  assert.equal(done.ready, 2)
  assert.ok(ctx.rows.jobs.every((j) => j.state === "ready" && String(j.video_url).endsWith(".mp4")))
  assert.equal(ctx.rows.presentations[0].state, "ready")
  const kept = [...ctx.files.stored.values()]
  assert.equal(kept.length, 2)
  assert.ok(kept.every((f) => f.mime === "video/mp4"), "the speech files are gone, the clips stay")

  assert.ok((await publishPresentation(ctx.scope, "avp_1")).ok)
  assert.equal(ctx.rows.presentations[0].state, "published")
  assert.ok((await unpublishPresentation(ctx.scope, "avp_1")).ok)
  assert.equal(ctx.rows.presentations[0].state, "ready")
})

test("run: an order without an answer fails the clip and is never sent again", async () => {
  const ctx = await started()
  const t = fakeTavus({ post: () => Promise.reject(new Error("connection reset")) })
  const out = await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl }, now: new Date() })
  assert.equal(out.failed, 2)
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.error).startsWith("order_unknown")))
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl }, now: new Date(Date.now() + 3600_000) })
  assert.equal(t.posts.length, 2)
  assert.equal(ctx.rows.presentations[0].state, "failed")
  assert.match(String(ctx.rows.presentations[0].error), /2 of 2 clips failed/)
})

test("run: a rate limit waits, a failed clip at Tavus fails, a stalled one fails after 40 minutes", async () => {
  const ctx = await started()
  const limited = fakeTavus({ post: () => new Response("slow", { status: 429 }) })
  const now = new Date("2026-11-27T10:00:00Z")
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: limited.impl, tavus: { fetchImpl: limited.impl }, now })
  assert.ok(ctx.rows.jobs.every((j) => j.state === "queued"), "a 429 keeps the clip queued")
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: limited.impl, tavus: { fetchImpl: limited.impl }, now: new Date(now.getTime() + 30_000) })
  assert.equal(limited.posts.length, 2, "and waits before the next try")

  let status: Record<string, unknown> = { status: "generating", generation_progress: "33/100" }
  const t = fakeTavus({ status: () => status })
  const later = new Date(now.getTime() + 10 * 60_000)
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl, sleep: async () => {} }, now: later })
  assert.ok(ctx.rows.jobs.every((j) => j.state === "rendering"))
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl, sleep: async () => {} }, now: new Date(later.getTime() + STALL_MS + 60_000) })
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.error).startsWith("stalled")))

  const ctx2 = await started()
  const t2 = fakeTavus({ status: () => status })
  await runRender(ctx2.scope, { files: ctx2.files, fetchImpl: t2.impl, tavus: { fetchImpl: t2.impl, sleep: async () => {} }, now })
  status = { status: "error", status_details: "audio could not be processed" }
  await runRender(ctx2.scope, { files: ctx2.files, fetchImpl: t2.impl, tavus: { fetchImpl: t2.impl, sleep: async () => {} }, now: new Date(now.getTime() + 60_000) })
  assert.ok(ctx2.rows.jobs.every((j) => j.state === "failed" && /audio could not be processed/.test(String(j.error))))
  assert.equal(ctx2.rows.presentations[0].state, "failed")

  /* A new quote after failures keeps the speech: no second synthesis, the clips go back to quoted. */
  const { synth, calls } = fakeSynth()
  ;(ctx2.rows.presentations[0] as { state: string }).state = "failed"
  const again = await quoteRender(ctx2.scope, "avp_1", {}, { files: ctx2.files, synth })
  assert.ok(again.ok, JSON.stringify(again))
  assert.equal(calls.length, 0)
  assert.ok(ctx2.rows.jobs.every((j) => j.state === "quoted"))
})

test("run: a consent revoked after the start stops the clips not ordered yet", async () => {
  const ctx = await started()
  ;(ctx.rows.avatars[0] as { consent_state: string }).consent_state = "revoked"
  const t = fakeTavus()
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl }, now: new Date() })
  assert.equal(t.posts.length, 0)
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.error).startsWith("consent_missing")))
})

test("demo: the whole render runs without a paid call", async () => {
  const { scope, rows } = setup({ options: { demo: true, tavusApiKey: "", geminiApiKey: "" } })
  const files = fakeFiles()
  const q = await quoteRender(scope, "avp_1", {}, { files })
  assert.ok(q.ok, JSON.stringify(q))
  assert.ok((await startRender(scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: q.quote.minutes }, null, { files })).ok)
  await runRender(scope, { files })
  assert.equal(rows.presentations[0].state, "ready")
})

test("store: only what a learner sees, the clip of each slide", async () => {
  const ctx = await started()
  const t = fakeTavus({ status: () => ({ status: "ready", download_url: "https://cdn.tavus.example/c.mp4" }) })
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl, sleep: async () => {} }, now: new Date() })
  await runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl, sleep: async () => {} }, now: new Date(Date.now() + 60_000) })
  const row = { ...ctx.rows.presentations[0], source_text: "secret source", transcript: "secret transcript", state: "published" }
  const dto = toStorePresentation(row, ctx.rows.jobs)
  assert.ok(dto)
  const json = JSON.stringify(dto)
  for (const hidden of ["secret source", "secret transcript", "approved", "notes", "audio_url"]) assert.ok(!json.includes(hidden), hidden)
  assert.ok(dto.slides.every((s) => s.clip?.video_url?.endsWith(".mp4")))
})

test("delete: the speech and the clips go with the presentation", async () => {
  const ctx = await started()
  ;(ctx.rows.presentations[0] as { state: string }).state = "failed"
  const before = ctx.files.stored.size
  assert.ok(before > 0)
  const r = await deletePresentation(ctx.scope, "avp_1", { files: ctx.files })
  assert.ok(r.ok)
  assert.equal(ctx.files.stored.size, 0)
})

/* ------------------------------------------------------------------ */
/* Paying twice, waiting forever, leaking: the cases of the review     */
/* ------------------------------------------------------------------ */

const ok200 = (async () => new Response(null, { status: 200 })) as typeof fetch
const run = (ctx: { scope: never; files: FilesLike }, t: { impl: typeof fetch }, now: Date) => runRender(ctx.scope, { files: ctx.files, fetchImpl: t.impl, tavus: { fetchImpl: t.impl, sleep: async () => {} }, now })

test("run: a clip left in ordering (a crash after the order) fails as order_unknown and is never sent", async () => {
  const ctx = await started()
  const now = new Date("2026-11-27T10:00:00Z")
  for (const j of ctx.rows.jobs) Object.assign(j, { state: "ordering", metadata: { lease_until: new Date(now.getTime() - 1000).toISOString() } })
  const t = fakeTavus()
  await run(ctx, t, now)
  assert.equal(t.posts.length, 0)
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.error).startsWith("order_unknown")))
})

test("run: an order whose record fails keeps the video id and is never sent again", async () => {
  const ctx = await started()
  const update = ctx.svc.updateAvatarsRenderJobs
  let broke = false
  ctx.svc.updateAvatarsRenderJobs = (async (data: Array<Record<string, unknown>>) => {
    if (!broke && data.some((d) => d.state === "rendering")) {
      broke = true
      throw new Error("db down")
    }
    return update(data)
  }) as never
  const t = fakeTavus()
  const now = new Date("2026-11-27T10:00:00Z")
  await run(ctx, t, now)
  const lost = ctx.rows.jobs.find((j) => j.state === "failed")
  assert.ok(lost)
  assert.match(String(lost.error), /^order_unknown: ordered as Tavus video vid_1/)
  assert.equal(lost.provider_video_id, "vid_1")
  await run(ctx, t, new Date(now.getTime() + 3600_000))
  assert.equal(t.posts.length, 2, "one post per clip, the lost one never again")
})

test("quote: two rows of one clip (an old race) become one, the newest", async () => {
  const ctx = setup()
  const { synth } = fakeSynth()
  assert.ok((await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth })).ok)
  const first = ctx.rows.jobs[0]
  ctx.rows.jobs.push({ ...first, id: "avr_dup", created_at: new Date(Date.now() + 1000) })
  const q = await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth })
  assert.ok(q.ok)
  const live = ctx.rows.jobs.filter((j) => j.deleted_at == null && j.item_id === first.item_id)
  assert.deepEqual(live.map((j) => j.id), ["avr_dup"])
})

test("run: the queue of Tavus is no stall, a refused key keeps the clip, the deadline ends every clip", async () => {
  const ctx = await started()
  let status: Record<string, unknown> = { status: "queued" }
  const t = fakeTavus({ status: () => status })
  const now = new Date("2026-11-27T10:00:00Z")
  await run(ctx, t, now)
  await run(ctx, t, new Date(now.getTime() + STALL_MS + 60_000))
  assert.ok(ctx.rows.jobs.every((j) => j.state === "rendering"), "waiting in the queue is not a stall")

  const refused = (async (url: string | URL, init?: RequestInit) => (String(url).includes("/v2/videos/") ? new Response("bad key", { status: 401 }) : t.impl(url, init))) as typeof fetch
  await run(ctx, { impl: refused }, new Date(now.getTime() + 2 * STALL_MS))
  assert.ok(ctx.rows.jobs.every((j) => j.state === "rendering" && String(j.error).startsWith("status: auth")), "a 401 is shown, not final")

  status = { status: "generating", generation_progress: "50/100" }
  await run(ctx, t, new Date(now.getTime() + CLIP_DEADLINE_MS + 60_000))
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.error).startsWith("timeout")))
  assert.equal(ctx.rows.presentations[0].state, "failed")
})

test("run: a download that keeps failing ends the clip after a few runs", async () => {
  const ctx = await started()
  const t = fakeTavus({ status: () => ({ status: "ready", download_url: "https://cdn.broken.example/c.mp4" }) })
  const broken = (async (url: string | URL, init?: RequestInit) => (String(url).startsWith("https://cdn.broken.example/") ? new Response("busy", { status: 503 }) : t.impl(url, init))) as typeof fetch
  let now = new Date("2026-11-27T10:00:00Z")
  for (let i = 0; i <= FETCH_ATTEMPTS + 1; i++) {
    await run(ctx, { impl: broken }, now)
    now = new Date(now.getTime() + 6 * 60_000)
  }
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.error).startsWith("download")))
})

test("quote: a clip that may exist at Tavus is flagged and needs an acknowledgment", async () => {
  const ctx = await started()
  const t = fakeTavus({ post: () => Promise.reject(new Error("connection reset")) })
  await run(ctx, t, new Date())
  assert.equal(ctx.rows.presentations[0].state, "failed")
  const q = await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth: fakeSynth().synth })
  assert.ok(q.ok, JSON.stringify(q))
  assert.equal(q.quote.risky.length, 2)
  const refused = await startRender(ctx.scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: q.quote.minutes }, null, { fetchImpl: ok200 })
  assert.deepEqual(refused.ok ? [] : refused.problems, ["risky_not_acknowledged"])
  const s = await startRender(ctx.scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: q.quote.minutes, acknowledge_risky: true }, null, { fetchImpl: ok200 })
  assert.ok(s.ok)
})

test("quote: speech Tavus could not fetch is made again", async () => {
  const ctx = await started()
  const unreachable = (async (url: string | URL, init?: RequestInit) => (init?.method === "HEAD" ? new Response(null, { status: 403 }) : fakeTavus().impl(url, init))) as typeof fetch
  await run(ctx, { impl: unreachable }, new Date())
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.error).startsWith("audio_unreachable")))
  const { synth, calls } = fakeSynth()
  const q = await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth })
  assert.ok(q.ok)
  assert.equal(calls.length, 2, "both clips get new speech")
  assert.equal(q.quote.risky.length, 0, "nothing was ordered, nothing is risky")
})

test("publish: refused while a clip is missing or the consent is gone", async () => {
  const ctx = await started()
  ctx.rows.presentations[0].state = "ready"
  Object.assign(ctx.rows.jobs[0], { state: "ready", video_url: "https://media.example.com/a.mp4" })
  const r = await publishPresentation(ctx.scope, "avp_1")
  assert.deepEqual(r.ok ? [] : r.problems, ["clips_missing"])
  Object.assign(ctx.rows.jobs[1], { state: "ready", video_url: "https://media.example.com/b.mp4" })
  ;(ctx.rows.avatars[0] as { consent_state: string }).consent_state = "revoked"
  const c = await publishPresentation(ctx.scope, "avp_1")
  assert.deepEqual(c.ok ? [] : c.problems, ["consent_missing"])
})

test("store: the source of a slide never leaves the admin", async () => {
  const ctx = setup()
  const p = ctx.rows.presentations[0] as { script: { slides: Array<{ source: string }> } }
  for (const slide of p.script.slides) slide.source = "SOURCE-MARK internal page 12"
  const dto = toStorePresentation({ ...ctx.rows.presentations[0], state: "published" }, [])
  assert.ok(dto)
  assert.ok(!JSON.stringify(dto).includes("SOURCE-MARK"))
  assert.ok(dto.quiz.length > 0, "the quiz stays")
})

test("script: an approved presentation whose render failed is not written again", async () => {
  const ctx = setup({ presentation: { state: "failed", source_text: "x ".repeat(200) } })
  const r = await startScript(ctx.scope, "avp_1", null)
  assert.deepEqual(r.ok ? [] : r.problems, ["approved"])
})

test("cancel: clips not ordered yet stop, the presentation can be quoted again", async () => {
  const ctx = await started()
  const r = await cancelRender(ctx.scope, "avp_1")
  assert.ok(r.ok)
  assert.equal(ctx.rows.presentations[0].state, "failed")
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && j.error === "cancelled"))
  const t = fakeTavus()
  await run(ctx, t, new Date())
  assert.equal(t.posts.length, 0)
  assert.ok((await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth: fakeSynth().synth })).ok)
})

test("lock: a run while another holds the lock does nothing", async () => {
  const ctx = await started()
  const held: LockLike = { acquire: async () => Promise.reject(new Error("held")), release: async () => true }
  const t = fakeTavus()
  const out = await runRender(ctx.scope, { files: ctx.files, locking: held, fetchImpl: t.impl, tavus: { fetchImpl: t.impl }, now: new Date() })
  assert.equal(out.skipped, true)
  assert.equal(t.posts.length, 0)
  const q = await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, locking: held, synth: fakeSynth().synth })
  assert.deepEqual(q.ok ? [] : q.problems, ["busy"])
})

/* ------------------------------------------------------------------ */
/* Second review: the route, cancel, a clip Tavus made but we lost     */
/* ------------------------------------------------------------------ */

test("route: the quote answer carries the risky clips", async () => {
  const { scope } = setup({ options: { demo: true, tavusApiKey: "", geminiApiKey: "" } })
  let body: { quote?: Record<string, unknown> } = {}
  const res = { status: () => res, json: (b: unknown) => void (body = b as typeof body) }
  await quoteRoute({ scope, params: { id: "avp_1" }, body: {} } as never, res as never)
  assert.ok(body.quote, JSON.stringify(body))
  assert.deepEqual(body.quote.risky, [])
})

test("cancel: a clip at Tavus keeps rendering, a clip being ordered fails as order_unknown", async () => {
  const ctx = await started()
  Object.assign(ctx.rows.jobs[0], { state: "rendering", provider_video_id: "vid_9", metadata: { ordered_at: new Date().toISOString() } })
  Object.assign(ctx.rows.jobs[1], { state: "ordering" })
  assert.ok((await cancelRender(ctx.scope, "avp_1")).ok)
  assert.equal(ctx.rows.jobs[0].state, "rendering")
  assert.match(String(ctx.rows.jobs[1].error), /^order_unknown/)
  const q = await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth: fakeSynth().synth })
  assert.deepEqual(q.ok ? [] : q.problems, ["rendering"], "no new quote while a paid clip is still coming")
})

test("run: a clip Tavus made but the store could not keep is fetched again, never ordered again", async () => {
  const ctx = await started()
  const t = fakeTavus({ status: () => ({ status: "ready", download_url: "https://cdn.broken.example/c.mp4" }) })
  const broken = (async (url: string | URL, init?: RequestInit) => (String(url).startsWith("https://cdn.broken.example/") ? new Response("busy", { status: 503 }) : t.impl(url, init))) as typeof fetch
  let now = new Date("2026-11-27T10:00:00Z")
  for (let i = 0; i <= FETCH_ATTEMPTS + 1; i++) {
    await run(ctx, { impl: broken }, now)
    now = new Date(now.getTime() + 6 * 60_000)
  }
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.provider_video_id).startsWith("vid_")))
  const q = await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth: fakeSynth().synth })
  assert.ok(q.ok)
  assert.equal(q.quote.minutes, 0, "fetching again costs no minutes")
  assert.ok(q.quote.clips.every((c) => c.reused))
  assert.ok((await startRender(ctx.scope, "avp_1", { quote_hash: q.quote.quote_hash, minutes: 0 }, null, { fetchImpl: ok200, now })).ok)
  assert.ok(ctx.rows.jobs.every((j) => j.state === "rendering"))
  const good = fakeTavus({ status: () => ({ status: "ready", download_url: "https://cdn.tavus.example/c.mp4" }) })
  await run(ctx, good, now)
  assert.equal(good.posts.length, 0)
  assert.equal(t.posts.length, 2, "two orders in the whole story, one per clip")
  assert.ok(ctx.rows.jobs.every((j) => j.state === "ready"))
})

test("run: a clip too large to keep is flagged as risky, a rate limit spends no attempt", async () => {
  const ctx = await started()
  const huge = fakeTavus({ status: () => ({ status: "ready", download_url: "https://cdn.huge.example/c.mp4" }) })
  const impl = (async (url: string | URL, init?: RequestInit) => (String(url).startsWith("https://cdn.huge.example/") ? new Response("x", { status: 200, headers: { "content-length": String(300 * 1024 * 1024) } }) : huge.impl(url, init))) as typeof fetch
  const now = new Date("2026-11-27T10:00:00Z")
  await run(ctx, { impl }, now)
  await run(ctx, { impl }, new Date(now.getTime() + 60_000))
  assert.ok(ctx.rows.jobs.every((j) => j.state === "failed" && String(j.error).startsWith("download: too_large")))
  const q = await quoteRender(ctx.scope, "avp_1", {}, { files: ctx.files, synth: fakeSynth().synth })
  assert.ok(q.ok)
  assert.equal(q.quote.risky.length, 2)

  const ctx2 = await started()
  const limited = fakeTavus({ post: () => new Response("slow", { status: 429 }) })
  for (let i = 0; i < 5; i++) await run(ctx2, limited, new Date(now.getTime() + i * 3 * 60_000))
  assert.ok(ctx2.rows.jobs.every((j) => j.state === "queued" && Number(j.attempts) === 0))
})

test("script: two clips with one id are refused; duplicate rows keep the one at Tavus", () => {
  const s = structuredClone({ ...DEMO_SCRIPT, shorts: [{ id: "s02", title: "Alarm", narration: "When the alarm sounds, stop, leave and meet at the assembly point.", slide: "s02" }] })
  const r = parseScript(s)
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.issues.some((i) => i.code === "id_duplicate"))
  const { byItem, extra } = newestPerItem([
    { id: "a", item_id: "s01", state: "rendering", created_at: new Date("2026-11-01") },
    { id: "b", item_id: "s01", state: "quoted", created_at: new Date("2026-11-02") },
  ])
  assert.equal(byItem.get("s01")?.id, "a")
  assert.deepEqual(extra.map((j) => j.id), ["b"])
})
