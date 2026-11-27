/**
 * Gemini over REST: the transcription of a recording and the text to speech
 * of a narration. Plain fetch, no SDK: two endpoints and the Files API.
 *
 *   transcribe  downloads the recording (size capped), uploads it to the
 *               Files API, waits until it is ACTIVE, asks the model for a
 *               verbatim transcript, deletes the file in every case.
 *   synthesize  one narration to a WAV (PCM 16 bit mono), the director's
 *               notes above the text steer the voice and are never spoken.
 *
 * Busy answers (429, 5xx) are retried with a growing pause; anything else
 * fails at once. The key goes in a header and is masked out of every error.
 */
import { maskSecrets } from "./options"

const BASE = "https://generativelanguage.googleapis.com"

export class GeminiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "GeminiError"
    this.code = code
  }
}

export type GeminiConfig = { apiKey: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function call(cfg: GeminiConfig, url: string, init: RequestInit, attempts = 4, timeoutMs = 180_000): Promise<Response> {
  const f = cfg.fetchImpl ?? fetch
  const sleep = cfg.sleep ?? pause
  let last = ""
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await f(url, { ...init, headers: { "x-goog-api-key": cfg.apiKey, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) return res
      const body = (await res.text()).slice(0, 300)
      last = `HTTP ${res.status} ${body}`
      if (res.status !== 429 && res.status < 500) throw new GeminiError(`http_${res.status}`, maskSecrets(last, [cfg.apiKey]))
    } catch (e) {
      if (e instanceof GeminiError) throw e
      last = e instanceof Error ? e.message : String(e)
    }
    if (i < attempts) await sleep(3000 * i)
  }
  throw new GeminiError("unavailable", maskSecrets(last, [cfg.apiKey]))
}

type Part = { text?: string; inlineData?: { mimeType: string; data: string } }
type GenerateAnswer = { candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>; usageMetadata?: Record<string, unknown> }

/* ------------------------------------------------------------------ */
/* Transcription                                                       */
/* ------------------------------------------------------------------ */

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mp3",
  m4a: "audio/m4a",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  aac: "audio/aac",
  webm: "audio/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
}

export function mimeOf(url: string, header: string | null): string {
  const h = (header ?? "").split(";")[0].trim().toLowerCase()
  if (h.startsWith("audio/") || h.startsWith("video/")) return h
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXT[ext] ?? "audio/mpeg"
}

const LANG_NAME: Record<string, string> = { pl: "Polish", en: "English", de: "German" }

export type TranscribeInput = { fileUrl: string; lang: string; model: string; maxBytes: number }

export async function transcribe(cfg: GeminiConfig, input: TranscribeInput): Promise<{ text: string; usage: Record<string, unknown> }> {
  const f = cfg.fetchImpl ?? fetch
  const src = await f(input.fileUrl, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!src.ok) throw new GeminiError("source_unreachable", `The recording answered HTTP ${src.status}`)
  const declared = Number(src.headers.get("content-length") ?? "0")
  if (declared > input.maxBytes) throw new GeminiError("source_too_large", `The recording has ${declared} bytes, the limit is ${input.maxBytes}`)
  const bytes = Buffer.from(await src.arrayBuffer())
  if (bytes.length > input.maxBytes) throw new GeminiError("source_too_large", `The recording has ${bytes.length} bytes, the limit is ${input.maxBytes}`)
  if (bytes.length === 0) throw new GeminiError("source_empty", "The recording is empty")
  const mime = mimeOf(input.fileUrl, src.headers.get("content-type"))

  const start = await call(cfg, `${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "avatars-source" } }),
  })
  const uploadUrl = start.headers.get("x-goog-upload-url")
  if (!uploadUrl) throw new GeminiError("upload_failed", "No upload URL in the answer")
  const up = await call(cfg, uploadUrl, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes }, 1, 30 * 60_000)
  let file = ((await up.json()) as { file?: { name?: string; uri?: string; state?: string; mimeType?: string } }).file
  if (!file?.name || !file.uri) throw new GeminiError("upload_failed", "The upload answered without a file")
  const name = file.name

  try {
    for (let i = 0; file?.state && file.state !== "ACTIVE"; i++) {
      if (file.state === "FAILED") throw new GeminiError("upload_failed", "Gemini could not process the recording")
      if (i >= 90) throw new GeminiError("upload_timeout", "The recording was not ready in time")
      await (cfg.sleep ?? pause)(2000)
      file = (await (await call(cfg, `${BASE}/v1beta/${name}`, { method: "GET" })).json()) as typeof file
    }
    const prompt = [
      `Transcribe this recording verbatim, in ${LANG_NAME[input.lang] ?? "its own language"}.`,
      "Plain text only, paragraphs where the speaker pauses. No speaker labels, no timestamps, no comments.",
      "Write what is said, including hesitations only when they carry meaning.",
    ].join(" ")
    const res = await call(cfg, `${BASE}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { file_data: { mime_type: file?.mimeType ?? mime, file_uri: file?.uri } }] }] }),
    }, 3, 15 * 60_000)
    const answer = (await res.json()) as GenerateAnswer
    const cand = answer.candidates?.[0]
    const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim()
    if (cand?.finishReason === "MAX_TOKENS") throw new GeminiError("transcript_truncated", "The transcript was cut at the output limit: split the recording")
    if (!text) throw new GeminiError("transcript_empty", `No text in the answer (${cand?.finishReason ?? "no candidate"})`)
    return { text, usage: answer.usageMetadata ?? {} }
  } finally {
    await (cfg.fetchImpl ?? fetch)(`${BASE}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": cfg.apiKey } }).catch(() => undefined)
  }
}

/* ------------------------------------------------------------------ */
/* Text to speech                                                      */
/* ------------------------------------------------------------------ */

export function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44)
  h.write("RIFF", 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write("WAVEfmt ", 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write("data", 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** Director's notes above the transcript: the model reads only the part after the marker. */
export function speechPrompt(style: string, text: string): string {
  return style ? `${style}\n#### TRANSCRIPT\n${text}` : text
}

export type SynthesizeInput = { text: string; voice: string; model: string; style: string }

export async function synthesize(cfg: GeminiConfig, input: SynthesizeInput): Promise<Buffer> {
  const res = await call(cfg, `${BASE}/v1beta/models/${encodeURIComponent(input.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: speechPrompt(input.style, input.text) }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } } },
    }),
  })
  const answer = (await res.json()) as GenerateAnswer
  const part = answer.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
  if (!part) throw new GeminiError("no_audio", "No audio in the answer")
  const rate = Number(part.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000)
  return wav(Buffer.from(part.data, "base64"), rate)
}

/** A second of silence, the demo mode's answer to a voice preview. */
export function silence(seconds = 1, rate = 24000): Buffer {
  return wav(Buffer.alloc(rate * 2 * seconds), rate)
}
