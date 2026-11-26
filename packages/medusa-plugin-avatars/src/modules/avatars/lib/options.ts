/**
 * Options of `@koda-plus/medusa-plugin-avatars`, passed in `medusa-config.ts`:
 *
 *   plugins: [{
 *     resolve: "@koda-plus/medusa-plugin-avatars",
 *     options: {
 *       tavusApiKey: process.env.TAVUS_API_KEY,
 *       anthropicApiKey: process.env.ANTHROPIC_API_KEY,
 *       geminiApiKey: process.env.GEMINI_API_KEY,
 *     },
 *   }]
 *
 * Every key is optional and nothing here can stop Medusa from starting.
 * Without keys the module runs "to be configured": the admin page works, the
 * paid steps refuse with a clear message. Demo mode is only ever on with
 * `demo: true`, never because a key is missing. Keys never reach the browser:
 * the status shows only whether each one is set.
 */
import { isLang, type Lang } from "./constants"

export interface AvatarsPluginOptions {
  /** Demo mode: a sample avatar and presentation, no call to Tavus, Claude or Gemini. Default: false. */
  demo?: boolean | string
  /** Tavus API key (video rendering). */
  tavusApiKey?: string
  /** Anthropic API key (script, slides and quiz). */
  anthropicApiKey?: string
  /** Claude model for the script. Default: claude-opus-5-5. */
  claudeModel?: string
  /** Google AI Studio key (transcription and text to speech). */
  geminiApiKey?: string
  /** Gemini text to speech model. Default: gemini-3.8-flash-tts. */
  ttsModel?: string
  /** Gemini model that transcribes recordings. Default: gemini-3.5-transcribe. */
  transcribeModel?: string
  /**
   * What the script writer should know about the store: the audience, the
   * tone, words to avoid. Plain text, added to the writer's instructions.
   */
  scriptBrief?: string
  /** Director's notes for the voice (style, pace, accent), read by the text to speech model, never spoken. */
  voiceStyle?: string
  /** The largest recording the transcription downloads, in megabytes. Default: 500. */
  maxSourceMb?: number | string
  /** The voice new avatars get. Default: Kore. */
  defaultVoice?: string
  /** The language new presentations get. Default: pl. */
  defaultLang?: Lang | string
  /** Speech rate used to estimate durations before a render, words per minute. Default: 135. */
  wordsPerMinute?: number | string
  /**
   * The most avatar video minutes one render run may order. A presentation
   * above the limit is refused before anything is sent. Default: 30.
   */
  maxRenderMinutes?: number | string
  /** File prefix of everything the plugin stores through the File Module. Default: avatars/. */
  filePrefix?: string
}

export interface ResolvedAvatarsOptions {
  demo: boolean
  tavusApiKey: string
  anthropicApiKey: string
  claudeModel: string
  geminiApiKey: string
  ttsModel: string
  transcribeModel: string
  scriptBrief: string
  voiceStyle: string
  maxSourceMb: number
  defaultVoice: string
  defaultLang: Lang
  wordsPerMinute: number
  maxRenderMinutes: number
  filePrefix: string
}

/** Whether each paid service has its key, for the status and the guards. Never the keys themselves. */
export interface ConfiguredServices {
  tavus: boolean
  claude: boolean
  gemini: boolean
}

export function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase())
  return false
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback
}

const SAFE_PREFIX = /^[a-z0-9][a-z0-9/_-]{0,60}\/$/

export function resolveOptions(o: AvatarsPluginOptions | undefined | null): ResolvedAvatarsOptions {
  const opts = o && typeof o === "object" ? o : {}
  const prefix = text(opts.filePrefix, "avatars/")
  const lang = text(opts.defaultLang, "pl").toLowerCase()
  return {
    demo: bool(opts.demo),
    tavusApiKey: text(opts.tavusApiKey, ""),
    anthropicApiKey: text(opts.anthropicApiKey, ""),
    claudeModel: text(opts.claudeModel, "claude-opus-5-5"),
    geminiApiKey: text(opts.geminiApiKey, ""),
    ttsModel: text(opts.ttsModel, "gemini-3.8-flash-tts"),
    transcribeModel: text(opts.transcribeModel, "gemini-3.5-transcribe"),
    scriptBrief: text(opts.scriptBrief, "").slice(0, 8000),
    voiceStyle: text(opts.voiceStyle, "").slice(0, 4000),
    maxSourceMb: int(opts.maxSourceMb, 500, 1, 2000),
    defaultVoice: text(opts.defaultVoice, "Kore"),
    defaultLang: isLang(lang) ? lang : "pl",
    wordsPerMinute: int(opts.wordsPerMinute, 135, 60, 250),
    maxRenderMinutes: int(opts.maxRenderMinutes, 30, 1, 600),
    filePrefix: SAFE_PREFIX.test(prefix) ? prefix : "avatars/",
  }
}

export function configuredServices(o: ResolvedAvatarsOptions): ConfiguredServices {
  return { tavus: Boolean(o.tavusApiKey), claude: Boolean(o.anthropicApiKey), gemini: Boolean(o.geminiApiKey) }
}

/** Every secret of the options, to be masked wherever text may carry it (errors, logs). */
export function secretsOf(o: ResolvedAvatarsOptions): string[] {
  return [o.tavusApiKey, o.anthropicApiKey, o.geminiApiKey].filter((s) => s.length >= 8)
}

/** Replaces every secret in a text with a mask. Errors of outside services sometimes echo the key back. */
export function maskSecrets(value: string, secrets: string[]): string {
  let out = value
  for (const s of secrets) out = out.split(s).join(`${s.slice(0, 3)}***`)
  return out
}
