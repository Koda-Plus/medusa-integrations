/**
 * The shapes the admin API answers with. Type imports only: shared by the
 * server and the admin bundle.
 */
import type { ScriptIssue } from "./script"
import type { ConsentState, Lang, PresentationState, RenderState, SourceKind } from "./constants"

export interface AvatarDto {
  id: string
  name: string
  provider: string
  face_id: string
  voice: string
  consent: {
    state: ConsentState
    file_url: string | null
    signed_by: string | null
    signed_at: string | null
    note: string | null
    recorded_by: string | null
  }
  /** Whether a render may start with this avatar (consent signed, file on record). */
  can_render: boolean
  demo: boolean
  created_at: string | null
}

export interface RenderJobDto {
  id: string
  item_id: string
  state: RenderState
  progress: number
  video_url: string | null
  /** Length of the clip's speech, which is also the length of the clip. */
  duration_ms: number | null
  error: string | null
}

/** The last quote of a render and the start that confirmed it. */
export interface RenderSummaryDto {
  quote_hash: string | null
  minutes: number | null
  items: string[]
  shorts: boolean
  quoted_at: string | null
  started_at: string | null
  /** The most avatar minutes one render may order (option `maxRenderMinutes`). */
  limit: number
}

export interface QuoteClipDto {
  item_id: string
  duration_ms: number
  /** Already rendered with the same signature: costs nothing. */
  reused: boolean
}

export interface QuoteDto {
  clips: QuoteClipDto[]
  minutes: number
  quote_hash: string
  limit: number
  over_limit: boolean
  /** Clips that may already exist at Tavus (a lost order, a stall, a timeout): the start needs `acknowledge_risky`. */
  risky: Array<{ item_id: string; error: string; previous_video_id: string | null }>
}

export interface PresentationDto {
  id: string
  title: string
  lang: Lang
  state: PresentationState
  source_kind: SourceKind
  source_file_url: string | null
  /** Words in the source text or transcript (the text itself comes with the detail call). */
  source_words: number
  target_minutes: number
  avatar_id: string | null
  slides: number
  script_words: number
  /** Estimated video minutes of the script at the configured speech rate. */
  estimated_minutes: number
  approved: boolean
  approved_by: string | null
  approved_at: string | null
  published_at: string | null
  error: string | null
  demo: boolean
  created_at: string | null
  updated_at: string | null
}

export interface PresentationDetailDto extends PresentationDto {
  source_text: string | null
  transcript: string | null
  script: unknown
  script_hash: string | null
  /** What breaks the writing rules in the stored script: warnings, the script is kept. */
  issues: ScriptIssue[]
  jobs: RenderJobDto[]
  render: RenderSummaryDto
}

/** One clip of a published presentation, as the store gets it. */
export interface StoreClipDto {
  item_id: string
  video_url: string | null
  duration_ms: number | null
}

export interface StorePresentationDto {
  id: string
  title: string
  lang: Lang
  published_at: string | null
  minutes: number
  slides: Array<Record<string, unknown> & { id: string; clip: StoreClipDto | null }>
  quiz: unknown[]
  shorts: Array<{ id: string; title: string; clip: StoreClipDto | null }>
}

export interface StatusResponse {
  demo: boolean
  configured: { tavus: boolean; claude: boolean; gemini: boolean }
  options: {
    claudeModel: string
    ttsModel: string
    transcribeModel: string
    defaultVoice: string
    defaultLang: Lang
    wordsPerMinute: number
    maxRenderMinutes: number
    filePrefix: string
    /** Whether a store brief for the script writer is set (the text stays on the server). */
    scriptBrief: boolean
    voiceStyle: boolean
    maxSourceMb: number
  }
  counts: {
    avatars: number
    without_consent: number
    presentations: number
    needs_action: number
    running: number
    published: number
  }
  avatars: AvatarDto[]
  presentations: PresentationDto[]
}
