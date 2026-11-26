import { createHash } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ClaudeError, writeScript, type WriteInput } from "../../modules/avatars/lib/claude"
import { GeminiError, silence, synthesize, transcribe } from "../../modules/avatars/lib/gemini"
import { maskSecrets, secretsOf, type ResolvedAvatarsOptions } from "../../modules/avatars/lib/options"
import { canonicalJson, checkScript, parseScript, targetsFor, words, type Script, type ScriptIssue } from "../../modules/avatars/lib/script"
import { avatarsSvc, num, str, type AvatarsServiceLike, type Row } from "../../modules/avatars/lib/store"
import type { Result } from "./avatars"
import { DEMO_SCRIPT } from "./demo"
import { findPresentation } from "./presentations"

/**
 * From the source to an approved script.
 *
 *   startScript   draft or failed: checks the keys, moves the presentation to
 *                 `transcribing` (a recording without a transcript) or
 *                 `scripting`. Nothing paid runs in the request.
 *   runPipeline   the scheduled job: at most `limit` presentations a run,
 *                 one step each. A lease is written BEFORE the paid call, so
 *                 a second worker or the next run skips it; a crash leaves
 *                 the lease to expire and the step runs again. Three failed
 *                 attempts end in `failed` with the error.
 *   saveScript    an edit from the admin: the shape must hold, the rule
 *                 issues come back as warnings. An edit after approval takes
 *                 the approval back (the hash no longer matches).
 *   approveScript the hash the person saw must be the current one.
 *   previewSlide  one narration as speech, with the avatar's voice.
 *
 * In demo mode nothing leaves the server: a sample transcript and script,
 * a second of silence for the voice.
 */

export const MIN_SOURCE_WORDS = 150
/* Longer than the worst case of one step: a transcription is capped at about 90 minutes
   (download 10, upload 30, model 3 x 15, polling 3), a script at 2 rounds of 3 x 20 minutes. */
export const LEASE_MS = 3 * 60 * 60_000
export const MAX_ATTEMPTS = 3

export const scriptHash = (s: Script): string => createHash("sha256").update(canonicalJson(s)).digest("hex").slice(0, 32)

type Pipeline = { attempts?: number; lease_until?: string | null; not_before?: string | null; issues?: ScriptIssue[]; usage?: Record<string, unknown>; started_by?: string | null }

const metaOf = (row: Row): Record<string, unknown> => (row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {})
const pipelineOf = (row: Row): Pipeline => (metaOf(row).pipeline && typeof metaOf(row).pipeline === "object" ? (metaOf(row).pipeline as Pipeline) : {})
const withPipeline = (row: Row, p: Pipeline) => ({ ...metaOf(row), pipeline: { ...pipelineOf(row), ...p } })

export type StartProblem = "not_found" | "state" | "claude_missing" | "gemini_missing" | "source_missing"

export async function startScript(container: MedusaContainer, id: string, actor: string | null): Promise<Result<Row, StartProblem>> {
  const svc = avatarsSvc(container)
  const row = await findPresentation(container, id)
  if (!row) return { ok: false, status: 404, problems: ["not_found"] }
  if (!["draft", "failed"].includes(String(row.state))) return { ok: false, status: 409, problems: ["state"] }
  const recording = row.source_kind === "recording" && !str(row.transcript)
  if (recording && !str(row.source_file_url)) return { ok: false, status: 400, problems: ["source_missing"] }
  if (!recording && !str(row.transcript) && !str(row.source_text)) return { ok: false, status: 400, problems: ["source_missing"] }
  if (!svc.isDemo()) {
    const c = svc.configured()
    const missing: StartProblem[] = []
    if (!c.claude) missing.push("claude_missing")
    if (recording && !c.gemini) missing.push("gemini_missing")
    if (missing.length) return { ok: false, status: 409, problems: missing }
  }
  const [updated] = await svc.updateAvatarsPresentations([
    { id, state: recording ? "transcribing" : "scripting", error: null, metadata: withPipeline(row, { attempts: 0, lease_until: null, not_before: null, started_by: actor }) },
  ])
  return { ok: true, row: updated }
}

/* ------------------------------------------------------------------ */
/* The scheduled run                                                   */
/* ------------------------------------------------------------------ */

export type Steps = {
  transcribe: (o: ResolvedAvatarsOptions, row: Row) => Promise<string>
  write: (o: ResolvedAvatarsOptions, input: WriteInput) => Promise<{ raw: unknown; usage: Record<string, unknown> }>
}

export const liveSteps: Steps = {
  transcribe: async (o, row) =>
    (await transcribe({ apiKey: o.geminiApiKey }, { fileUrl: String(row.source_file_url), lang: String(row.lang), model: o.transcribeModel, maxBytes: o.maxSourceMb * 1024 * 1024 })).text,
  write: async (o, input) => {
    const r = await writeScript(o.anthropicApiKey, o.claudeModel, input)
    return { raw: r.raw, usage: { model: r.model, ...r.usage } }
  },
}

export const DEMO_TRANSCRIPT = "This is the sample transcript of the demo mode. ".repeat(40).trim()

const demoSteps: Steps = {
  transcribe: async () => DEMO_TRANSCRIPT,
  write: async () => ({ raw: DEMO_SCRIPT, usage: { model: "demo" } }),
}

function failure(e: unknown, o: ResolvedAvatarsOptions): { code: string; message: string } {
  if (e instanceof GeminiError || e instanceof ClaudeError) return { code: e.code, message: maskSecrets(e.message, secretsOf(o)) }
  return { code: "error", message: maskSecrets(e instanceof Error ? e.message : String(e), secretsOf(o)).slice(0, 500) }
}

/** One transcription: the text replaces nothing the office typed, it lands in `transcript`. */
async function stepTranscribe(svc: AvatarsServiceLike, row: Row, steps: Steps): Promise<Record<string, unknown>> {
  const o = svc.getOptions()
  const text = await steps.transcribe(o, row)
  if (words(text) < MIN_SOURCE_WORDS) return { state: "failed", error: `source_too_short: ${words(text)} words, at least ${MIN_SOURCE_WORDS}` }
  return { state: "scripting", transcript: text }
}

/**
 * One script: a correction round when the rules break, then the script is
 * stored for review either way (a person fixes what is left). Only a shape
 * that does not parse twice fails the step.
 */
async function stepScript(svc: AvatarsServiceLike, row: Row, steps: Steps): Promise<Record<string, unknown>> {
  const o = svc.getOptions()
  const source = str(row.transcript) ?? str(row.source_text) ?? ""
  if (words(source) < MIN_SOURCE_WORDS) return { state: "failed", error: `source_too_short: ${words(source)} words, at least ${MIN_SOURCE_WORDS}` }
  const minutes = num(row.target_minutes) || 12
  const targets = targetsFor(minutes, o.wordsPerMinute)
  const input: WriteInput = { title: String(row.title ?? ""), lang: String(row.lang ?? o.defaultLang), source, minutes, wordsPerMinute: o.wordsPerMinute, targets, brief: o.scriptBrief }

  let best: { script: Script; issues: ScriptIssue[] } | null = null
  let lastShape: ScriptIssue[] = []
  let usage: Record<string, unknown> = {}
  for (let round = 1; round <= 2; round++) {
    let answer: Awaited<ReturnType<Steps["write"]>>
    try {
      answer = await steps.write(o, input)
    } catch (e) {
      /* A failed correction round keeps the first script: the office fixes what is left. */
      if (best) break
      throw e
    }
    usage = answer.usage
    const parsed = parseScript(answer.raw)
    if (!parsed.ok) {
      lastShape = parsed.issues
      input.previous = { raw: answer.raw, issues: parsed.issues }
      continue
    }
    const issues = checkScript(parsed.script, targets)
    best = { script: parsed.script, issues }
    if (issues.length === 0) break
    input.previous = { raw: answer.raw, issues }
  }
  if (!best) return { state: "failed", error: `script_shape: ${lastShape.slice(0, 5).map((i) => `${i.at} ${i.code}`).join(", ")}` }
  return { state: "review", script: best.script, script_hash: scriptHash(best.script), _issues: best.issues, _usage: usage }
}

export async function runPipeline(container: MedusaContainer, opts: { limit?: number; now?: Date; steps?: Steps } = {}): Promise<{ ran: number; done: number; failed: number }> {
  const svc = avatarsSvc(container)
  const o = svc.getOptions()
  const now = opts.now ?? new Date()
  const steps = opts.steps ?? (o.demo ? demoSteps : liveSteps)
  const rows = await svc.listAvatarsPresentations({ state: ["transcribing", "scripting"] }, { take: 50, order: { updated_at: "ASC" } })
  const due = rows.filter((r) => {
    const p = pipelineOf(r)
    const lease = p.lease_until ? Date.parse(p.lease_until) : 0
    const notBefore = p.not_before ? Date.parse(p.not_before) : 0
    return lease <= now.getTime() && notBefore <= now.getTime()
  })
  const out = { ran: 0, done: 0, failed: 0 }
  for (const listed of due.slice(0, opts.limit ?? 2)) {
    /* Read again right before the lease: another run may have taken the row since the list was read. */
    const row = (await svc.listAvatarsPresentations({ id: listed.id }, { take: 1 }))[0]
    if (!row || !["transcribing", "scripting"].includes(String(row.state))) continue
    const fresh = pipelineOf(row)
    if ((fresh.lease_until ? Date.parse(fresh.lease_until) : 0) > now.getTime()) continue
    const attempts = (fresh.attempts ?? 0) + 1
    if (attempts > MAX_ATTEMPTS) {
      /* The process died during the earlier attempts (no catch ran): stop paying for it. */
      await svc.updateAvatarsPresentations([{ id: row.id, state: "failed", error: "interrupted: the step stopped without an answer too many times", metadata: withPipeline(row, { lease_until: null, not_before: null }) }])
      out.failed++
      continue
    }
    out.ran++
    /* The marker goes in before anything paid runs. */
    await svc.updateAvatarsPresentations([{ id: row.id, metadata: withPipeline(row, { attempts, lease_until: new Date(now.getTime() + LEASE_MS).toISOString() }) }])
    const leased = { ...row, metadata: withPipeline(row, { attempts }) }
    try {
      const patch = row.state === "transcribing" ? await stepTranscribe(svc, leased, steps) : await stepScript(svc, leased, steps)
      const { _issues, _usage, ...fields } = patch as Record<string, unknown> & { _issues?: ScriptIssue[]; _usage?: Record<string, unknown> }
      const p: Pipeline = { lease_until: null, not_before: null, attempts: fields.state === "scripting" ? 0 : attempts }
      if (_issues) p.issues = _issues
      if (_usage) p.usage = _usage
      await svc.updateAvatarsPresentations([{ id: row.id, ...fields, error: fields.error ?? null, metadata: withPipeline(leased, p) }])
      if (fields.state === "failed") out.failed++
      else out.done++
    } catch (e) {
      const f = failure(e, o)
      const final = attempts >= MAX_ATTEMPTS || f.code === "refused" || f.code === "truncated" || f.code.startsWith("source_") || f.code === "transcript_truncated"
      await svc.updateAvatarsPresentations([
        {
          id: row.id,
          ...(final ? { state: "failed" } : {}),
          error: `${f.code}: ${f.message}`.slice(0, 1000),
          metadata: withPipeline(leased, { lease_until: null, not_before: final ? null : new Date(now.getTime() + 2 * 60_000 * attempts).toISOString() }),
        },
      ])
      if (final) out.failed++
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Edit, approve, preview                                              */
/* ------------------------------------------------------------------ */

export type SaveResult = { ok: true; row: Row; issues: ScriptIssue[] } | { ok: false; status: 400 | 404 | 409; problems: string[]; issues?: ScriptIssue[] }

export async function saveScript(container: MedusaContainer, id: string, body: Record<string, unknown>): Promise<SaveResult> {
  const svc = avatarsSvc(container)
  const row = await findPresentation(container, id)
  if (!row) return { ok: false, status: 404, problems: ["not_found"] }
  if (!["review", "approved"].includes(String(row.state))) return { ok: false, status: 409, problems: ["state"] }
  /* The hash the editor started from: a save over someone else's newer save is refused. */
  if (typeof body.base_hash === "string" && body.base_hash !== (str(row.script_hash) ?? "")) return { ok: false, status: 409, problems: ["stale"] }
  const parsed = parseScript(body.script)
  if (!parsed.ok) return { ok: false, status: 400, problems: ["script_shape"], issues: parsed.issues }
  const hash = scriptHash(parsed.script)
  const issues = checkScript(parsed.script, targetsFor(num(row.target_minutes) || 12, svc.getOptions().wordsPerMinute))
  const [updated] = await svc.updateAvatarsPresentations([
    { id, script: parsed.script, script_hash: hash, state: hash === str(row.approved_hash) ? row.state : "review", metadata: withPipeline(row, { issues }) },
  ])
  return { ok: true, row: updated, issues }
}

export async function approveScript(container: MedusaContainer, id: string, body: Record<string, unknown>, actor: string | null): Promise<Result<Row, "not_found" | "state" | "stale" | "script_shape">> {
  const svc = avatarsSvc(container)
  const row = await findPresentation(container, id)
  if (!row) return { ok: false, status: 404, problems: ["not_found"] }
  if (row.state !== "review") return { ok: false, status: 409, problems: ["state"] }
  const current = str(row.script_hash)
  if (!current || body.script_hash !== current) return { ok: false, status: 409, problems: ["stale"] }
  if (!parseScript(row.script).ok) return { ok: false, status: 400, problems: ["script_shape"] }
  const [updated] = await svc.updateAvatarsPresentations([{ id, state: "approved", approved_hash: current, approved_by: actor, approved_at: new Date() }])
  return { ok: true, row: updated }
}

/** Speech of one narration. A small cache: listening twice to the same text costs once. */
const previews = new Map<string, Buffer>()
const PREVIEW_CACHE = 40

export type PreviewResult = { ok: true; audio: Buffer } | { ok: false; status: 400 | 404 | 409 | 502; problems: string[] }

export async function previewSlide(container: MedusaContainer, id: string, body: Record<string, unknown>, synth: typeof synthesize = synthesize): Promise<PreviewResult> {
  const svc = avatarsSvc(container)
  const o = svc.getOptions()
  const row = await findPresentation(container, id)
  if (!row) return { ok: false, status: 404, problems: ["not_found"] }
  const parsed = parseScript(row.script)
  if (!parsed.ok) return { ok: false, status: 409, problems: ["no_script"] }
  const target = typeof body.item === "string" ? body.item : ""
  const item = parsed.script.slides.find((s) => s.id === target) ?? parsed.script.shorts.find((k) => k.id === target)
  /* The text the office is editing right now, when sent; the stored one otherwise. */
  const text = (typeof body.text === "string" && body.text.trim() ? body.text.trim() : item?.narration ?? "").slice(0, 4000)
  if (!item || !text) return { ok: false, status: 400, problems: ["item_not_found"] }
  if (o.demo) return { ok: true, audio: silence() }
  if (!svc.configured().gemini) return { ok: false, status: 409, problems: ["gemini_missing"] }
  const avatarId = str(row.avatar_id)
  const avatar = avatarId ? (await svc.listAvatarsAvatars({ id: avatarId }, { take: 1 }))[0] : undefined
  const voice = str(avatar?.voice) ?? o.defaultVoice
  const key = createHash("sha256").update(`${o.ttsModel}\n${voice}\n${o.voiceStyle}\n${text}`).digest("hex")
  const hit = previews.get(key)
  if (hit) return { ok: true, audio: hit }
  try {
    const audio = await synth({ apiKey: o.geminiApiKey }, { text, voice, model: o.ttsModel, style: o.voiceStyle })
    previews.set(key, audio)
    if (previews.size > PREVIEW_CACHE) previews.delete(previews.keys().next().value as string)
    return { ok: true, audio }
  } catch (e) {
    return { ok: false, status: 502, problems: [e instanceof GeminiError ? e.code : "tts_failed"] }
  }
}
