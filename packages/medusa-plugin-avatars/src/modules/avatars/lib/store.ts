import type { MedusaContainer } from "@medusajs/framework/types"
import { AVATARS_MODULE, isLang, isPresentationState, isSourceKind, RENDER_STATES, type RenderState } from "./constants"
import { canRender, consentOf } from "./consent"
import type { AvatarDto, PresentationDetailDto, PresentationDto, RenderJobDto } from "./contract"
import type { ConfiguredServices, ResolvedAvatarsOptions } from "./options"

/**
 * The generated CRUD of the module, as the routes and workflows use it from
 * outside the service (through the container). Kept structural so the code
 * never imports the concrete service class and the service stays thin.
 */
export interface AvatarsServiceLike {
  getOptions(): ResolvedAvatarsOptions
  isDemo(): boolean
  configured(): ConfiguredServices

  listAvatarsAvatars(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createAvatarsAvatars(data: unknown | unknown[]): Promise<Row[]>
  updateAvatarsAvatars(data: unknown | unknown[]): Promise<Row[]>
  softDeleteAvatarsAvatars(ids: string | string[]): Promise<unknown>

  listAvatarsPresentations(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createAvatarsPresentations(data: unknown | unknown[]): Promise<Row[]>
  updateAvatarsPresentations(data: unknown | unknown[]): Promise<Row[]>
  softDeleteAvatarsPresentations(ids: string | string[]): Promise<unknown>

  listAvatarsRenderJobs(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createAvatarsRenderJobs(data: unknown | unknown[]): Promise<Row[]>
  updateAvatarsRenderJobs(data: unknown | unknown[]): Promise<Row[]>
  softDeleteAvatarsRenderJobs(ids: string | string[]): Promise<unknown>
}

export type Row = Record<string, unknown> & {
  id: string
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export function avatarsSvc(scope: MedusaContainer): AvatarsServiceLike {
  return scope.resolve(AVATARS_MODULE) as AvatarsServiceLike
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

export function iso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString()
  return typeof v === "string" && v ? v : null
}

export const countWords = (text: string | null | undefined): number => (text ? text.split(/\s+/).filter(Boolean).length : 0)

/**
 * What the list needs of a script: the number of slides and the words the
 * avatar will say. The script is JSON written by Claude and edited by
 * people, so it is read defensively: anything unexpected counts as nothing.
 */
export function scriptStats(script: unknown): { slides: number; words: number } {
  if (!script || typeof script !== "object") return { slides: 0, words: 0 }
  const slides = (script as { slides?: unknown }).slides
  if (!Array.isArray(slides)) return { slides: 0, words: 0 }
  let words = 0
  for (const s of slides) {
    if (s && typeof s === "object") words += countWords(typeof (s as { narration?: unknown }).narration === "string" ? ((s as { narration: string }).narration) : "")
  }
  return { slides: slides.length, words }
}

export function toAvatar(row: Row): AvatarDto {
  const consent = consentOf(row)
  return {
    id: row.id,
    name: str(row.name) ?? row.id,
    provider: str(row.provider) ?? "tavus",
    face_id: str(row.face_id) ?? "",
    voice: str(row.voice) ?? "",
    consent: {
      ...consent,
      note: str(row.consent_note),
      recorded_by: str(row.consent_recorded_by),
    },
    can_render: canRender(consent),
    demo: row.demo === true,
    created_at: iso(row.created_at),
  }
}

export function toJob(row: Row): RenderJobDto {
  const state = (RENDER_STATES as readonly string[]).includes(String(row.state)) ? (row.state as RenderState) : "queued"
  return {
    id: row.id,
    item_id: str(row.item_id) ?? "",
    state,
    progress: num(row.progress),
    video_url: str(row.video_url),
    duration_ms: typeof row.duration_ms === "number" ? row.duration_ms : null,
    error: str(row.error),
  }
}

export function toPresentation(row: Row, wordsPerMinute: number): PresentationDto {
  const stats = scriptStats(row.script)
  const source = str(row.transcript) ?? str(row.source_text)
  const approvedHash = str(row.approved_hash)
  return {
    id: row.id,
    title: str(row.title) ?? row.id,
    lang: isLang(row.lang) ? row.lang : "pl",
    state: isPresentationState(row.state) ? row.state : "draft",
    source_kind: isSourceKind(row.source_kind) ? row.source_kind : "text",
    source_file_url: str(row.source_file_url),
    source_words: countWords(source),
    target_minutes: num(row.target_minutes) || 12,
    avatar_id: str(row.avatar_id),
    slides: stats.slides,
    script_words: stats.words,
    estimated_minutes: Math.round((stats.words / wordsPerMinute) * 10) / 10,
    approved: Boolean(approvedHash) && approvedHash === str(row.script_hash),
    approved_by: str(row.approved_by),
    approved_at: iso(row.approved_at),
    published_at: iso(row.published_at),
    error: str(row.error),
    demo: row.demo === true,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  }
}

export function toPresentationDetail(row: Row, jobs: Row[], wordsPerMinute: number): PresentationDetailDto {
  return {
    ...toPresentation(row, wordsPerMinute),
    source_text: str(row.source_text),
    transcript: str(row.transcript),
    script: row.script ?? null,
    script_hash: str(row.script_hash),
    jobs: jobs.map(toJob).sort((a, b) => a.item_id.localeCompare(b.item_id)),
  }
}
