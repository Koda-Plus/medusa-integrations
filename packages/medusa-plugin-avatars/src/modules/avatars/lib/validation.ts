/**
 * Input checks of the admin forms, as pure functions: they return either the
 * problems (codes the admin translates) or the clean values to write.
 */
import { isLang, isSourceKind, NAME_MAX, SOURCE_TEXT_MAX, TITLE_MAX, URL_MAX, type Lang, type SourceKind } from "./constants"

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/** Tavus replica ids and Gemini voice names: letters, digits, dashes and underscores. */
const SAFE_ID = /^[A-Za-z0-9_-]{2,64}$/

export type AvatarProblem = "name_missing" | "name_too_long" | "face_missing" | "face_invalid" | "voice_invalid"

export interface AvatarValues {
  name: string
  face_id: string
  voice: string
}

export function avatarInput(body: Record<string, unknown>, defaultVoice: string): { ok: false; problems: AvatarProblem[] } | { ok: true; values: AvatarValues } {
  const problems: AvatarProblem[] = []
  const name = str(body.name)
  const face = str(body.face_id)
  const voice = str(body.voice) || defaultVoice
  if (!name) problems.push("name_missing")
  else if (name.length > NAME_MAX) problems.push("name_too_long")
  if (!face) problems.push("face_missing")
  else if (!SAFE_ID.test(face)) problems.push("face_invalid")
  if (!SAFE_ID.test(voice)) problems.push("voice_invalid")
  return problems.length ? { ok: false, problems } : { ok: true, values: { name, face_id: face, voice } }
}

export type PresentationProblem =
  | "title_missing"
  | "title_too_long"
  | "lang_invalid"
  | "source_invalid"
  | "text_missing"
  | "text_too_long"
  | "file_missing"
  | "file_invalid"
  | "minutes_invalid"

export interface PresentationValues {
  title: string
  lang: Lang
  source_kind: SourceKind
  source_text: string | null
  source_file_url: string | null
  target_minutes: number
  avatar_id: string | null
}

function isFileUrl(value: string): boolean {
  if (value.length > URL_MAX) return false
  if (value.startsWith("/")) return !value.startsWith("//")
  try {
    const u = new URL(value)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}

/**
 * A new presentation: a title, a language, and either a text (pasted
 * lecture, article, notes) or a recording already stored through the File
 * Module. Target length 2 to 25 minutes: a longer lecture should be split.
 */
export function presentationInput(body: Record<string, unknown>, defaultLang: Lang): { ok: false; problems: PresentationProblem[] } | { ok: true; values: PresentationValues } {
  const problems: PresentationProblem[] = []
  const title = str(body.title)
  const langText = str(body.lang) || defaultLang
  const kind = str(body.source_kind) || "text"
  const text = typeof body.source_text === "string" ? body.source_text.trim() : ""
  const file = str(body.source_file_url)
  const minutesRaw = body.target_minutes === undefined || body.target_minutes === "" ? 12 : Number(body.target_minutes)
  const avatar = str(body.avatar_id)

  if (!title) problems.push("title_missing")
  else if (title.length > TITLE_MAX) problems.push("title_too_long")
  if (!isLang(langText)) problems.push("lang_invalid")
  if (!isSourceKind(kind)) problems.push("source_invalid")
  if (kind === "text") {
    if (!text) problems.push("text_missing")
    else if (text.length > SOURCE_TEXT_MAX) problems.push("text_too_long")
  }
  if (kind === "recording") {
    if (!file) problems.push("file_missing")
    else if (!isFileUrl(file)) problems.push("file_invalid")
  }
  if (!Number.isInteger(minutesRaw) || minutesRaw < 2 || minutesRaw > 25) problems.push("minutes_invalid")

  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    values: {
      title,
      lang: langText as Lang,
      source_kind: kind as SourceKind,
      source_text: kind === "text" ? text : null,
      source_file_url: kind === "recording" ? file : null,
      target_minutes: minutesRaw,
      avatar_id: avatar || null,
    },
  }
}
