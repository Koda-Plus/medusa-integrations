import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { canRender, consentOf } from "../../modules/avatars/lib/consent"
import { GeminiError, silence, synthesize } from "../../modules/avatars/lib/gemini"
import { maskSecrets, secretsOf, type ResolvedAvatarsOptions } from "../../modules/avatars/lib/options"
import { CLIP_MAX_MS, CLIP_MIN_MS, clipSignature, isPublicUrl, mapLimit, quoteHash, quoteMinutes, renderItems, wavDurationMs, type QuoteClip, type RenderItem } from "../../modules/avatars/lib/render"
import { parseScript } from "../../modules/avatars/lib/script"
import { avatarsSvc, num, str, type AvatarsServiceLike, type Row } from "../../modules/avatars/lib/store"
import { createVideo, downloadVideo, getVideo, TavusError, type TavusConfig } from "../../modules/avatars/lib/tavus"
import type { Result } from "./avatars"
import { findPresentation } from "./presentations"

/**
 * From an approved script to the clips of the avatar.
 *
 *   quoteRender   the speech of every clip that is not rendered yet (Gemini,
 *                 cheap), stored through the File Module so Tavus can fetch
 *                 it, and its exact length. The answer is the number of clips
 *                 and the avatar minutes they cost. Nothing is ordered.
 *   startRender   the office confirms the quote (its hash and its minutes):
 *                 the consent is checked again, its document must answer,
 *                 every speech file must be public. The clips are queued.
 *   runRender     the scheduled job: orders queued clips, follows the
 *                 rendering ones, stores each finished clip through the File
 *                 Module. Every clip ends ready or failed within a deadline.
 *   cancelRender  stops what was not ordered yet and frees the presentation.
 *   publish       a presentation with every clip ready becomes visible to
 *                 the store API.
 *
 * PAYING TWICE IS THE FAILURE TO AVOID. A clip goes to `ordering` before the
 * order is sent; one found there later (a crash, a lost answer) is failed as
 * `order_unknown`, never sent again. A new quote of such a clip is flagged
 * and needs an explicit acknowledgment. The run and each quote hold a lock
 * (Medusa's Locking Module) so two workers never take the same clip.
 *
 * A clip is ordered again only when its signature changes (face, voice,
 * speech model, director's notes, text): editing one slide costs one clip.
 */

/** File Module calls the render needs. Structural: the tests pass a fake. */
export interface FilesLike {
  createFiles(data: { filename: string; mimeType: string; content: string; access?: "public" | "private" }[]): Promise<{ id: string; url: string }[]>
  deleteFiles(ids: string[]): Promise<void>
}

/** Locking Module calls: acquire with an owner and an expiry, release. */
export interface LockLike {
  acquire(keys: string | string[], args?: { ownerId?: string | null; expire?: number }): Promise<void>
  release(keys: string | string[], args?: { ownerId?: string | null }): Promise<boolean>
}

export type RenderDeps = {
  files?: FilesLike | null
  locking?: LockLike | null
  synth?: typeof synthesize
  tavus?: Partial<TavusConfig>
  fetchImpl?: typeof fetch
  now?: Date
}

/** How long a clip may sit at the same progress while Tavus generates it (the pilot saw one stop at 33%). */
export const STALL_MS = 40 * 60_000
/** Every ordered clip ends within this time, ready or failed: nothing waits forever. */
export const CLIP_DEADLINE_MS = 4 * 60 * 60_000
export const ORDER_LEASE_MS = 10 * 60_000
export const FETCH_LEASE_MS = 60 * 60_000
export const ORDER_ATTEMPTS = 3
export const FETCH_ATTEMPTS = 5
const ORDERS_PER_RUN = 3
const POLLS_PER_RUN = 25
const RUN_LOCK = "avatars:render-run"
const RUN_LOCK_SECONDS = 50 * 60

/** Errors of a clip that may already exist (and be billed) at Tavus: a new order needs an acknowledgment. */
export const RISKY = /^(order_unknown|stalled|timeout|download: too_large)/
/** A clip Tavus finished but the store could not keep: the next render fetches it again, nothing is ordered. */
const REFETCH = /^(download|files_missing)/
const RUN_BUDGET_MS = 5 * 60_000

type RenderMeta = { quote_hash?: string; minutes?: number; items?: string[]; shorts?: boolean; risky?: string[]; quoted_at?: string; started_at?: string; started_by?: string | null }
type JobMeta = {
  audio_file_id?: string | null
  video_file_id?: string | null
  replaces_file_id?: string | null
  lease_until?: string | null
  not_before?: string | null
  ordered_at?: string
  last_progress_at?: string
  polled_at?: string
  fetch_failures?: number
  previous_video_id?: string | null
  hosted_url?: string | null
  /** Quoted to be fetched again from Tavus (the video exists), not ordered. */
  refetch?: boolean
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
export const renderOf = (row: Row): RenderMeta => obj(obj(row.metadata).render) as RenderMeta
const withRender = (row: Row, r: RenderMeta) => ({ ...obj(row.metadata), render: { ...renderOf(row), ...r } })
export const jobMetaOf = (row: Row): JobMeta => obj(row.metadata) as JobMeta
const withJob = (row: Row, m: JobMeta) => ({ ...obj(row.metadata), ...m })

export function filesOf(container: MedusaContainer, deps: RenderDeps): FilesLike | null {
  if (deps.files !== undefined) return deps.files
  try {
    return container.resolve("file") as FilesLike
  } catch {
    return null
  }
}

function lockingOf(container: MedusaContainer, deps: RenderDeps): LockLike | null {
  if (deps.locking !== undefined) return deps.locking
  try {
    return container.resolve("locking") as LockLike
  } catch {
    return null
  }
}

/**
 * Runs `fn` while holding `key`, or answers `null` when someone else holds
 * it. Without a Locking Module (an old store) it runs unlocked: the states
 * and leases still keep one worker from taking a clip twice in turn.
 */
export async function withLock<T>(container: MedusaContainer, deps: RenderDeps, key: string, expireSeconds: number, fn: () => Promise<T>): Promise<T | null> {
  const locking = lockingOf(container, deps)
  if (!locking) return fn()
  const ownerId = randomUUID()
  let timer: ReturnType<typeof setTimeout> | undefined
  const got = await Promise.race([
    locking.acquire(key, { ownerId, expire: expireSeconds }).then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), 3000)
    }),
  ])
  clearTimeout(timer)
  if (!got) {
    /* An acquire that lands after the timeout must not keep the key until it expires. */
    void locking.release(key, { ownerId }).catch(() => false)
    return null
  }
  try {
    return await fn()
  } finally {
    await locking.release(key, { ownerId }).catch(() => false)
  }
}

async function dropFiles(files: FilesLike | null, ids: (string | null | undefined)[]): Promise<void> {
  const list = ids.filter((i): i is string => typeof i === "string" && i.length > 0)
  if (!files || list.length === 0) return
  /* A file left behind costs storage, never a render: a failed delete does not stop the flow. */
  await files.deleteFiles(list).catch(() => undefined)
}

const time = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) || 0 : 0)

/** Which row of an item to keep: one at Tavus (ordered and paid) before a rendered one before the rest. */
const rank = (j: Row) => (j.state === "ordering" || j.state === "rendering" ? 0 : j.state === "ready" ? 1 : 2)

/**
 * The clip of each item when two rows exist (a race of two quotes before the
 * unique index existed): the one at Tavus, else the rendered one, else the
 * newest. The others are returned to drop.
 */
export function newestPerItem(jobs: Row[]): { byItem: Map<string, Row>; extra: Row[] } {
  const byItem = new Map<string, Row>()
  const extra: Row[] = []
  for (const j of [...jobs].sort((a, b) => rank(a) - rank(b) || time(b.created_at) - time(a.created_at))) {
    const key = String(j.item_id)
    if (byItem.has(key)) extra.push(j)
    else byItem.set(key, j)
  }
  return { byItem, extra }
}

const RENDERABLE = ["approved", "ready", "failed"]

type Ready = { svc: AvatarsServiceLike; o: ResolvedAvatarsOptions; row: Row; avatar: Row; items: RenderItem[]; scriptHash: string }

type QuoteProblem = "not_found" | "state" | "not_approved" | "no_script" | "avatar_missing" | "consent_missing" | "tavus_missing" | "gemini_missing" | "files_missing" | "busy"

/** What both the quote and the start need: an approved script, an avatar with consent, the keys. */
async function prepare(container: MedusaContainer, id: string, shorts: boolean | null): Promise<Result<Ready, QuoteProblem>> {
  const svc = avatarsSvc(container)
  const o = svc.getOptions()
  const row = await findPresentation(container, id)
  if (!row) return { ok: false, status: 404, problems: ["not_found"] }
  if (!RENDERABLE.includes(String(row.state))) return { ok: false, status: 409, problems: ["state"] }
  const scriptHash = str(row.script_hash)
  if (!scriptHash || scriptHash !== str(row.approved_hash)) return { ok: false, status: 409, problems: ["not_approved"] }
  const parsed = parseScript(row.script)
  if (!parsed.ok) return { ok: false, status: 409, problems: ["no_script"] }
  const avatarId = str(row.avatar_id)
  const avatar = avatarId ? (await svc.listAvatarsAvatars({ id: avatarId }, { take: 1 }))[0] : undefined
  if (!avatar) return { ok: false, status: 409, problems: ["avatar_missing"] }
  if (!canRender(consentOf(avatar))) return { ok: false, status: 409, problems: ["consent_missing"] }
  if (!o.demo) {
    const c = svc.configured()
    const missing: QuoteProblem[] = []
    if (!c.tavus) missing.push("tavus_missing")
    if (!c.gemini) missing.push("gemini_missing")
    if (missing.length) return { ok: false, status: 409, problems: missing }
  }
  const withShorts = shorts ?? renderOf(row).shorts ?? false
  return { ok: true, row: { svc, o, row, avatar, items: renderItems(parsed.script, withShorts), scriptHash } }
}

const signatureOf = (r: Ready, item: RenderItem) => clipSignature({ faceId: String(r.avatar.face_id ?? ""), voice: str(r.avatar.voice) ?? r.o.defaultVoice, ttsModel: r.o.ttsModel, style: r.o.voiceStyle, text: item.text })

export type Quote = {
  clips: QuoteClip[]
  minutes: number
  quote_hash: string
  limit: number
  over_limit: boolean
  /** Clips that may already exist at Tavus (a lost order, a stall, a timeout): ordering them again needs an acknowledgment. */
  risky: Array<{ item_id: string; error: string; previous_video_id: string | null }>
}

export type QuoteResult = { ok: true; row: Row; quote: Quote } | { ok: false; status: 400 | 404 | 409 | 502; problems: string[]; item?: string }

export async function quoteRender(container: MedusaContainer, id: string, body: Record<string, unknown>, deps: RenderDeps = {}): Promise<QuoteResult> {
  const locked = await withLock(container, deps, `avatars:quote:${id}`, 15 * 60, () => quoteLocked(container, id, body, deps))
  return locked ?? { ok: false, status: 409, problems: ["busy"] }
}

async function quoteLocked(container: MedusaContainer, id: string, body: Record<string, unknown>, deps: RenderDeps): Promise<QuoteResult> {
  const prep = await prepare(container, id, typeof body.shorts === "boolean" ? body.shorts : null)
  if (!prep.ok) return prep
  const r = prep.row
  const { svc, o, row } = r
  const files = filesOf(container, deps)
  if (!files && !o.demo) return { ok: false, status: 409, problems: ["files_missing"] }
  const synth = deps.synth ?? synthesize
  const voice = str(r.avatar.voice) ?? o.defaultVoice
  const all = await svc.listAvatarsRenderJobs({ presentation_id: id }, { take: 500 })
  const { byItem, extra } = newestPerItem(all)
  if (extra.length) {
    await dropFiles(files, extra.flatMap((j) => [jobMetaOf(j).audio_file_id, jobMetaOf(j).replaces_file_id]))
    await svc.softDeleteAvatarsRenderJobs(extra.map((j) => j.id))
  }
  if ([...byItem.values()].some((j) => j.state === "ordering" || j.state === "rendering" || j.state === "queued")) return { ok: false, status: 409, problems: ["rendering"] }

  const risky: Quote["risky"] = []
  let failedItem: { item: string; code: string } | null = null
  const clips = await mapLimit(r.items, 3, async (item): Promise<QuoteClip | null> => {
    const signature = signatureOf(r, item)
    const job = byItem.get(item.item_id)
    const same = job && job.signature === signature
    if (same && job.state === "ready" && (str(job.video_url) || o.demo)) return { item_id: item.item_id, signature, duration_ms: num(job.duration_ms), reused: true }
    const lastError = str(job?.error) ?? ""
    if (same && job.state === "failed" && REFETCH.test(lastError) && !RISKY.test(lastError) && str(job.provider_video_id)) {
      await svc.updateAvatarsRenderJobs([{ id: job.id, state: "quoted", attempts: 0, metadata: withJob(job, { refetch: true, lease_until: null, not_before: null, fetch_failures: 0 }) }])
      return { item_id: item.item_id, signature, duration_ms: num(job.duration_ms), reused: true }
    }
    if (same && RISKY.test(lastError)) risky.push({ item_id: item.item_id, error: lastError.slice(0, 300), previous_video_id: str(job.provider_video_id) ?? jobMetaOf(job).previous_video_id ?? null })
    /* The speech of a quoted or failed clip with the same signature is still good, unless Tavus could not fetch it. */
    if (same && str(job.audio_url) && num(job.duration_ms) > 0 && !lastError.startsWith("audio_unreachable")) {
      if (job.state !== "quoted") {
        await svc.updateAvatarsRenderJobs([{ id: job.id, state: "quoted", progress: 0, provider_video_id: null, attempts: 0, metadata: withJob(job, { previous_video_id: str(job.provider_video_id) ?? jobMetaOf(job).previous_video_id ?? null, lease_until: null, not_before: null, fetch_failures: 0, refetch: false }) }])
      }
      return { item_id: item.item_id, signature, duration_ms: num(job.duration_ms), reused: false }
    }
    let audio: Buffer
    try {
      audio = o.demo ? silence(Math.max(3, Math.round(item.text.split(/\s+/).length / (o.wordsPerMinute / 60)))) : await synth({ apiKey: o.geminiApiKey }, { text: item.text, voice, model: o.ttsModel, style: o.voiceStyle })
    } catch (e) {
      failedItem = { item: item.item_id, code: e instanceof GeminiError ? e.code : "tts_failed" }
      return null
    }
    const duration = wavDurationMs(audio)
    if (!duration || duration < CLIP_MIN_MS || duration > CLIP_MAX_MS) {
      failedItem = { item: item.item_id, code: "clip_length" }
      return null
    }
    let audioUrl = `demo://${item.item_id}.wav`
    let audioFileId: string | null = null
    if (files) {
      const [file] = await files.createFiles([{ filename: `${o.filePrefix}${id}/${item.item_id}-${signature.slice(0, 8)}.wav`, mimeType: "audio/wav", content: audio.toString("base64"), access: "public" }])
      audioUrl = file.url
      audioFileId = file.id
    }
    const fields = { signature, state: "quoted", audio_url: audioUrl, duration_ms: duration, progress: 0, provider_video_id: null, attempts: 0 }
    if (job) {
      const m = jobMetaOf(job)
      /* The old speech goes now; the old video stays until the new one is in. The error stays for the risky flag. */
      await dropFiles(files, [m.audio_file_id])
      await svc.updateAvatarsRenderJobs([
        {
          id: job.id,
          ...fields,
          error: same ? job.error ?? null : null,
          metadata: withJob(job, { audio_file_id: audioFileId, replaces_file_id: m.video_file_id ?? m.replaces_file_id ?? null, video_file_id: null, lease_until: null, not_before: null, fetch_failures: 0, refetch: false, previous_video_id: str(job.provider_video_id) ?? m.previous_video_id ?? null }),
        },
      ])
    } else {
      await svc.createAvatarsRenderJobs([{ presentation_id: id, item_id: item.item_id, ...fields, error: null, demo: o.demo, metadata: { audio_file_id: audioFileId } }])
    }
    return { item_id: item.item_id, signature, duration_ms: duration, reused: false }
  })

  if (failedItem) {
    const f = failedItem as { item: string; code: string }
    return { ok: false, status: f.code === "clip_length" ? 400 : 502, problems: [f.code], item: f.item }
  }
  const list = clips.filter((c): c is QuoteClip => c !== null)
  /* Clips of removed slides (or dropped short versions) that never rendered go; rendered ones stay on record. */
  const wanted = new Set(r.items.map((i) => i.item_id))
  const stale = [...byItem.values()].filter((j) => !wanted.has(String(j.item_id)) && j.state !== "ready")
  if (stale.length) {
    await dropFiles(files, stale.flatMap((j) => [jobMetaOf(j).audio_file_id, jobMetaOf(j).replaces_file_id]))
    await svc.softDeleteAvatarsRenderJobs(stale.map((j) => j.id))
  }
  const minutes = quoteMinutes(list)
  const hash = quoteHash(r.scriptHash, String(r.avatar.face_id ?? ""), list)
  const shorts = r.items.some((i) => i.kind === "short") || (typeof body.shorts === "boolean" ? body.shorts : renderOf(row).shorts ?? false)
  const [updated] = await svc.updateAvatarsPresentations([
    { id, metadata: withRender(row, { quote_hash: hash, minutes, items: r.items.map((i) => i.item_id), shorts, risky: risky.map((x) => x.item_id), quoted_at: (deps.now ?? new Date()).toISOString() }) },
  ])
  return { ok: true, row: updated, quote: { clips: list, minutes, quote_hash: hash, limit: o.maxRenderMinutes, over_limit: minutes > o.maxRenderMinutes, risky } }
}

/** Whether the consent document answers. A path on the store's own host is the File Module's and counts. */
async function documentAnswers(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  if (url.startsWith("/")) return true
  try {
    const head = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) })
    if (head.ok) return true
    /* Some hosts refuse HEAD: one byte of the file is enough. */
    const get = await fetchImpl(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(15_000) })
    await get.body?.cancel().catch(() => undefined)
    return get.ok
  } catch {
    return false
  }
}

export type StartProblem = QuoteProblem | "stale_quote" | "over_limit" | "consent_file_unreachable" | "audio_not_public" | "risky_not_acknowledged"

export async function startRender(container: MedusaContainer, id: string, body: Record<string, unknown>, actor: string | null, deps: RenderDeps = {}): Promise<Result<Row, StartProblem>> {
  const locked = await withLock(container, deps, `avatars:quote:${id}`, 120, () => startLocked(container, id, body, actor, deps))
  return locked ?? { ok: false, status: 409, problems: ["busy"] }
}

async function startLocked(container: MedusaContainer, id: string, body: Record<string, unknown>, actor: string | null, deps: RenderDeps): Promise<Result<Row, StartProblem>> {
  const prep = await prepare(container, id, null)
  if (!prep.ok) return prep
  const r = prep.row
  const { svc, o, row } = r
  const meta = renderOf(row)
  if (!meta.quote_hash || body.quote_hash !== meta.quote_hash || body.minutes !== meta.minutes) return { ok: false, status: 409, problems: ["stale_quote"] }
  const { byItem } = newestPerItem(await svc.listAvatarsRenderJobs({ presentation_id: id }, { take: 500 }))
  /* The quote must still describe the clips: a voice or face changed since makes it stale. */
  const clips: QuoteClip[] = []
  for (const item of r.items) {
    const job = byItem.get(item.item_id)
    const signature = signatureOf(r, item)
    if (!job || job.signature !== signature || !["quoted", "ready"].includes(String(job.state))) return { ok: false, status: 409, problems: ["stale_quote"] }
    clips.push({ item_id: item.item_id, signature, duration_ms: num(job.duration_ms), reused: job.state === "ready" || jobMetaOf(job).refetch === true })
  }
  if (quoteHash(r.scriptHash, String(r.avatar.face_id ?? ""), clips) !== meta.quote_hash) return { ok: false, status: 409, problems: ["stale_quote"] }
  if (quoteMinutes(clips) > o.maxRenderMinutes) return { ok: false, status: 409, problems: ["over_limit"] }
  const quoted = r.items.map((i) => byItem.get(i.item_id)!).filter((j) => j.state === "quoted")
  /* Read from the clips, not from the quote's record: a clip that may exist at Tavus always needs the acknowledgment. */
  if (quoted.some((j) => RISKY.test(str(j.error) ?? "")) && body.acknowledge_risky !== true) return { ok: false, status: 409, problems: ["risky_not_acknowledged"] }
  const refetch = quoted.filter((j) => jobMetaOf(j).refetch === true)
  const toOrder = quoted.filter((j) => jobMetaOf(j).refetch !== true)
  if (!o.demo) {
    const consentFile = consentOf(r.avatar).file_url ?? ""
    if (!(await documentAnswers(consentFile, deps.fetchImpl ?? fetch))) return { ok: false, status: 409, problems: ["consent_file_unreachable"] }
    if (toOrder.some((j) => !isPublicUrl(String(j.audio_url ?? "")))) return { ok: false, status: 409, problems: ["audio_not_public"] }
  }
  const now = deps.now ?? new Date()
  if (toOrder.length) await svc.updateAvatarsRenderJobs(toOrder.map((j) => ({ id: j.id, state: "queued", attempts: 0, error: null, metadata: withJob(j, { lease_until: null, not_before: null, fetch_failures: 0 }) })))
  /* Back to following the existing video: the run polls it and fetches the file again, no order. */
  if (refetch.length)
    await svc.updateAvatarsRenderJobs(refetch.map((j) => ({ id: j.id, state: "rendering", error: null, metadata: withJob(j, { refetch: false, lease_until: null, not_before: null, fetch_failures: 0, ordered_at: now.toISOString(), last_progress_at: now.toISOString() }) })))
  const allReady = quoted.length === 0
  const [updated] = await svc.updateAvatarsPresentations([
    { id, state: allReady ? "ready" : "rendering", error: null, metadata: withRender(row, { started_at: now.toISOString(), started_by: actor, risky: [] }) },
  ])
  return { ok: true, row: updated }
}

/**
 * Stops a render: clips not ordered yet fail as cancelled and the
 * presentation leaves `rendering`. Clips already at Tavus are paid for: the
 * run keeps following them to the end, so a later quote reuses them. A clip
 * caught in `ordering` fails as `order_unknown`, never sent again.
 */
export async function cancelRender(container: MedusaContainer, id: string, deps: RenderDeps = {}): Promise<Result<Row, "not_found" | "state" | "busy">> {
  const locked = await withLock(container, deps, RUN_LOCK, 120, async (): Promise<Result<Row, "not_found" | "state" | "busy">> => {
    const svc = avatarsSvc(container)
    const row = await findPresentation(container, id)
    if (!row) return { ok: false, status: 404, problems: ["not_found"] }
    if (row.state !== "rendering") return { ok: false, status: 409, problems: ["state"] }
    const jobs = await svc.listAvatarsRenderJobs({ presentation_id: id, state: ["queued", "ordering"] }, { take: 500 })
    if (jobs.length) {
      await svc.updateAvatarsRenderJobs(
        jobs.map((j) => ({
          id: j.id,
          state: "failed",
          error: j.state === "ordering" ? "order_unknown: the render was stopped while this clip was being ordered. Check the Tavus dashboard before quoting it again" : "cancelled",
          metadata: withJob(j, { lease_until: null, not_before: null }),
        })),
      )
    }
    const [updated] = await svc.updateAvatarsPresentations([{ id, state: "failed", error: "render: stopped. Clips already at Tavus still finish; quote again when they are in" }])
    return { ok: true, row: updated }
  })
  return locked ?? { ok: false, status: 409, problems: ["busy"] }
}

/* ------------------------------------------------------------------ */
/* The scheduled run                                                   */
/* ------------------------------------------------------------------ */

const due = (m: JobMeta, now: Date) => (m.lease_until ? Date.parse(m.lease_until) : 0) <= now.getTime() && (m.not_before ? Date.parse(m.not_before) : 0) <= now.getTime()

async function reread(svc: AvatarsServiceLike, id: string): Promise<Row | undefined> {
  return (await svc.listAvatarsRenderJobs({ id }, { take: 1 }))[0]
}

async function audioAnswers(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) })
    return res.ok
  } catch {
    return false
  }
}

export type RunRenderResult = { ordered: number; ready: number; failed: number; polled: number; skipped?: boolean }

export async function runRender(container: MedusaContainer, deps: RenderDeps = {}): Promise<RunRenderResult> {
  const out = await withLock(container, deps, RUN_LOCK, RUN_LOCK_SECONDS, () => runLocked(container, deps))
  return out ?? { ordered: 0, ready: 0, failed: 0, polled: 0, skipped: true }
}

async function runLocked(container: MedusaContainer, deps: RenderDeps): Promise<RunRenderResult> {
  const svc = avatarsSvc(container)
  const o = svc.getOptions()
  const now = deps.now ?? new Date()
  const files = filesOf(container, deps)
  const fetchImpl = deps.fetchImpl ?? fetch
  const tavus: TavusConfig = { apiKey: o.tavusApiKey, ...deps.tavus }
  const mask = (s: string) => maskSecrets(s, secretsOf(o)).slice(0, 1000)
  const out: RunRenderResult = { ordered: 0, ready: 0, failed: 0, polled: 0 }
  /* The time inside this run: leases written late in a long run start from when they are written. */
  const t0 = Date.now()
  const clock = () => new Date(now.getTime() + (Date.now() - t0))
  const fail = async (job: Row, error: string, extra: JobMeta = {}) => {
    await svc.updateAvatarsRenderJobs([{ id: job.id, state: "failed", error: mask(error), metadata: withJob(job, { lease_until: null, not_before: null, ...extra }) }])
    out.failed++
  }

  /* 0. A clip left in `ordering` (a crash or a lost answer between the order and the record): never sent again. */
  const stuck = (await svc.listAvatarsRenderJobs({ state: "ordering" }, { take: 50 })).filter((j) => due(jobMetaOf(j), now))
  for (const job of stuck) await fail(job, "order_unknown: the order was sent but its answer was not recorded. Check the Tavus dashboard before quoting this clip again")

  /* 1. Orders: the clip goes to `ordering` before the order, to `rendering` with the video id right after. */
  const queued = (await svc.listAvatarsRenderJobs({ state: "queued" }, { take: 50, order: { created_at: "ASC" } })).filter((j) => due(jobMetaOf(j), now))
  for (const listed of queued.slice(0, ORDERS_PER_RUN)) {
    const job = await reread(svc, listed.id)
    if (!job || job.state !== "queued" || !due(jobMetaOf(job), now)) continue
    const attempts = num(job.attempts) + 1
    if (attempts > ORDER_ATTEMPTS) {
      await fail(job, "order_failed: Tavus refused the order too many times")
      continue
    }
    if (o.demo) {
      await svc.updateAvatarsRenderJobs([{ id: job.id, state: "ready", progress: 100, attempts, provider_video_id: `demo_${job.item_id}`, metadata: withJob(job, { lease_until: null, ordered_at: now.toISOString() }) }])
      out.ordered++
      out.ready++
      continue
    }
    const presentation = await findPresentation(container, String(job.presentation_id))
    const avatarId = str(presentation?.avatar_id)
    const avatar = avatarId ? (await svc.listAvatarsAvatars({ id: avatarId }, { take: 1 }))[0] : undefined
    /* The consent is read again at the order: a consent revoked after the start stops what was not ordered yet. */
    if (!presentation || !avatar || !canRender(consentOf(avatar))) {
      await fail(job, "consent_missing: the avatar has no signed consent any more")
      continue
    }
    const audioUrl = String(job.audio_url ?? "")
    if (!isPublicUrl(audioUrl) || !(await audioAnswers(audioUrl, fetchImpl))) {
      await fail(job, "audio_unreachable: Tavus could not fetch the speech file, quote again to make it anew")
      continue
    }
    await svc.updateAvatarsRenderJobs([{ id: job.id, state: "ordering", attempts, metadata: withJob(job, { lease_until: new Date(clock().getTime() + ORDER_LEASE_MS).toISOString() }) }])
    let videoId: string
    try {
      videoId = await createVideo(tavus, { replicaId: String(avatar.face_id), audioUrl, name: `${str(presentation.title) ?? presentation.id} ${job.item_id}` })
    } catch (e) {
      const t = e instanceof TavusError ? e : new TavusError("network", e instanceof Error ? e.message : String(e))
      if (t.code === "rate_limited") {
        /* Refused before anything was made: back to the queue after a pause, the attempt not counted. The other clips wait too. */
        await svc.updateAvatarsRenderJobs([{ id: job.id, state: "queued", attempts: attempts - 1, error: mask(`${t.code}: ${t.message}`), metadata: withJob(job, { lease_until: null, not_before: new Date(clock().getTime() + 2 * 60_000).toISOString() }) }])
        break
      }
      await fail(job, `${t.code}: ${t.message}`)
      continue
    }
    try {
      await svc.updateAvatarsRenderJobs([{ id: job.id, state: "rendering", provider_video_id: videoId, progress: 0, error: null, metadata: withJob(job, { lease_until: null, not_before: null, ordered_at: now.toISOString(), last_progress_at: now.toISOString(), polled_at: now.toISOString() }) }])
      out.ordered++
    } catch (e) {
      /* The video exists and is billed: keep its id wherever it can be kept. */
      try {
        container.resolve<{ error?: (m: string) => void }>("logger")?.error?.(`[avatars] clip ${job.id} ordered as Tavus video ${videoId} but not recorded: ${e instanceof Error ? e.message : String(e)}`)
      } catch {
        /* no logger registered */
      }
      await svc
        .updateAvatarsRenderJobs([{ id: job.id, state: "failed", provider_video_id: videoId, error: `order_unknown: ordered as Tavus video ${videoId} but the record failed. Do not order it again before checking the dashboard` }])
        .catch(() => undefined)
    }
  }

  /* 2. Clips at Tavus: progress, the finished file, a failure, a stall or the deadline. Least recently polled first. */
  if (!o.demo) {
    const rendering = (await svc.listAvatarsRenderJobs({ state: "rendering" }, { take: 500 }))
      .filter((j) => due(jobMetaOf(j), now))
      .sort((a, b) => (Date.parse(jobMetaOf(a).polled_at ?? "") || 0) - (Date.parse(jobMetaOf(b).polled_at ?? "") || 0))
    for (const listed of rendering.slice(0, POLLS_PER_RUN)) {
      /* A slow Tavus must not hold the run lock for an hour: the rest waits for the next run. */
      if (Date.now() - t0 > RUN_BUDGET_MS) break
      const job = await reread(svc, listed.id)
      if (!job || job.state !== "rendering" || !str(job.provider_video_id) || !due(jobMetaOf(job), now)) continue
      out.polled++
      const m = jobMetaOf(job)
      const ordered = m.ordered_at ? Date.parse(m.ordered_at) : now.getTime()
      if (now.getTime() - ordered > CLIP_DEADLINE_MS) {
        await fail(job, `timeout: not ready ${CLIP_DEADLINE_MS / 3_600_000} hours after the order (Tavus video ${job.provider_video_id}). Check the dashboard before quoting it again`)
        continue
      }
      let v
      try {
        v = await getVideo(tavus, String(job.provider_video_id))
      } catch (e) {
        const t = e instanceof TavusError ? e : new TavusError("network", e instanceof Error ? e.message : String(e))
        if (t.code === "gone") {
          await fail(job, `tavus_gone: ${t.message}`)
          continue
        }
        /* Busy, refused key or a broken answer: shown on the clip, tried again next run, the deadline ends it. */
        await svc.updateAvatarsRenderJobs([{ id: job.id, error: mask(`status: ${t.code}: ${t.message}`), metadata: withJob(job, { polled_at: now.toISOString() }) }])
        continue
      }
      if (v.status === "ready") {
        if (!v.download_url) {
          await svc.updateAvatarsRenderJobs([{ id: job.id, error: "ready without a download link yet", metadata: withJob(job, { polled_at: now.toISOString() }) }])
          continue
        }
        if (!files) {
          await fail(job, "files_missing: the store has no File Module to keep the clip")
          continue
        }
        await svc.updateAvatarsRenderJobs([{ id: job.id, metadata: withJob(job, { lease_until: new Date(clock().getTime() + FETCH_LEASE_MS).toISOString(), polled_at: now.toISOString() }) }])
        try {
          const mp4 = await downloadVideo(v.download_url, fetchImpl)
          const [file] = await files.createFiles([{ filename: `${o.filePrefix}${job.presentation_id}/${job.item_id}-${String(job.signature).slice(0, 8)}.mp4`, mimeType: "video/mp4", content: mp4.toString("base64"), access: "public" }])
          await svc.updateAvatarsRenderJobs([
            { id: job.id, state: "ready", progress: 100, video_url: file.url, error: null, metadata: withJob(job, { lease_until: null, video_file_id: file.id, replaces_file_id: null, audio_file_id: null, hosted_url: v.hosted_url, fetch_failures: 0 }) },
          ])
          /* The speech was public only for Tavus; the replaced video is no longer shown. */
          await dropFiles(files, [m.audio_file_id, m.replaces_file_id])
          out.ready++
        } catch (e) {
          const failures = (m.fetch_failures ?? 0) + 1
          const tooLarge = e instanceof TavusError && e.code === "too_large"
          const why = `${tooLarge ? "too_large: " : ""}${e instanceof Error ? e.message : String(e)}`
          /* The video stays at Tavus (its id is kept): a new quote fetches it again without ordering, except a clip too large to keep. */
          if (failures >= FETCH_ATTEMPTS || tooLarge) await fail(job, `download: ${why}`, { fetch_failures: failures })
          else await svc.updateAvatarsRenderJobs([{ id: job.id, error: mask(`download: ${why}`), metadata: withJob(job, { lease_until: null, fetch_failures: failures, not_before: new Date(now.getTime() + 5 * 60_000).toISOString() }) }])
        }
        continue
      }
      if (v.status === "error" || v.status === "deleted") {
        await fail(job, `tavus_${v.status}: ${v.status_details ?? "no details"}`)
        continue
      }
      const generating = v.status !== "queued"
      const last = m.last_progress_at ? Date.parse(m.last_progress_at) : now.getTime()
      if (v.progress !== num(job.progress) || !generating) {
        /* Waiting in Tavus' own queue is not a stall: the clock starts when the generation moves. */
        await svc.updateAvatarsRenderJobs([{ id: job.id, progress: v.progress, error: null, metadata: withJob(job, { last_progress_at: now.toISOString(), polled_at: now.toISOString() }) }])
      } else if (now.getTime() - last > STALL_MS) {
        await fail(job, `stalled: no progress for 40 minutes at ${v.progress}% (Tavus video ${job.provider_video_id}). Check the dashboard before quoting it again`)
      } else {
        await svc.updateAvatarsRenderJobs([{ id: job.id, metadata: withJob(job, { polled_at: now.toISOString() }) }])
      }
    }
  }

  /* 3. Presentations: ready when every clip of the quote is in, failed when nothing runs and a clip failed. */
  const presentations = await svc.listAvatarsPresentations({ state: "rendering" }, { take: 100 })
  for (const p of presentations) {
    const items = renderOf(p).items ?? []
    const { byItem } = newestPerItem(await svc.listAvatarsRenderJobs({ presentation_id: p.id }, { take: 500 }))
    const jobs = items.map((i) => byItem.get(i)).filter((j): j is Row => Boolean(j))
    const states = jobs.map((j) => String(j.state))
    if (jobs.length === items.length && states.every((s) => s === "ready")) {
      await svc.updateAvatarsPresentations([{ id: p.id, state: "ready", error: null }])
    } else if (!states.some((s) => ["queued", "ordering", "rendering"].includes(s))) {
      /* Nothing more will happen: a missing or only counted clip counts as failed here. */
      const failed = items.filter((i) => byItem.get(i)?.state !== "ready")
      await svc.updateAvatarsPresentations([{ id: p.id, state: "failed", error: `render: ${failed.length} of ${items.length} clips failed (${failed.join(", ")}). Quote again: rendered clips are kept` }])
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

/** Whether every clip of the last render is ready with its file: what publishing needs. */
export async function clipsComplete(svc: AvatarsServiceLike, row: Row): Promise<boolean> {
  const items = renderOf(row).items ?? []
  if (items.length === 0) return false
  const { byItem } = newestPerItem(await svc.listAvatarsRenderJobs({ presentation_id: row.id }, { take: 500 }))
  return items.every((i) => {
    const j = byItem.get(i)
    return j?.state === "ready" && (Boolean(str(j.video_url)) || j.demo === true)
  })
}

export async function publishPresentation(container: MedusaContainer, id: string, now: Date = new Date()): Promise<Result<Row, "not_found" | "state" | "not_approved" | "clips_missing" | "consent_missing">> {
  const svc = avatarsSvc(container)
  const row = await findPresentation(container, id)
  if (!row) return { ok: false, status: 404, problems: ["not_found"] }
  if (row.state !== "ready") return { ok: false, status: 409, problems: ["state"] }
  if (!str(row.approved_hash) || row.approved_hash !== row.script_hash) return { ok: false, status: 409, problems: ["not_approved"] }
  if (!(await clipsComplete(svc, row))) return { ok: false, status: 409, problems: ["clips_missing"] }
  const avatarId = str(row.avatar_id)
  const avatar = avatarId ? (await svc.listAvatarsAvatars({ id: avatarId }, { take: 1 }))[0] : undefined
  if (!avatar || !canRender(consentOf(avatar))) return { ok: false, status: 409, problems: ["consent_missing"] }
  const [updated] = await svc.updateAvatarsPresentations([{ id, state: "published", published_at: now }])
  return { ok: true, row: updated }
}

export async function unpublishPresentation(container: MedusaContainer, id: string): Promise<Result<Row, "not_found" | "state">> {
  const svc = avatarsSvc(container)
  const row = await findPresentation(container, id)
  if (!row) return { ok: false, status: 404, problems: ["not_found"] }
  if (row.state !== "published") return { ok: false, status: 409, problems: ["state"] }
  const [updated] = await svc.updateAvatarsPresentations([{ id, state: "ready", published_at: null }])
  return { ok: true, row: updated }
}

/** The files of a presentation's clips, for the delete: speech, video and a replaced video. */
export function jobFileIds(jobs: Row[]): string[] {
  return jobs.flatMap((j) => {
    const m = jobMetaOf(j)
    return [m.audio_file_id, m.video_file_id, m.replaces_file_id].filter((v): v is string => typeof v === "string" && v.length > 0)
  })
}
