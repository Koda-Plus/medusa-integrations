/**
 * The shapes the admin API answers with. Type imports only: shared by the
 * server and the admin bundle.
 */
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
  duration_ms: number | null
  error: string | null
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
  jobs: RenderJobDto[]
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
