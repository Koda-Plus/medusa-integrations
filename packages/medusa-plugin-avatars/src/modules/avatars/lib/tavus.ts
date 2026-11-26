/**
 * The Tavus client of the render, as plain functions over fetch (no SDK):
 *
 *   createVideo  POST /v2/videos with the face (`replica_id`) and our own
 *                speech (`audio_url`): the face moves its lips to that file.
 *                NEVER RETRIED: Tavus may have taken the order even when the
 *                answer was lost, and a second call pays twice.
 *   getVideo     GET /v2/videos/:id, retried on network errors, 429 and 5xx.
 *
 * Lessons of the pilot: the speech goes in as `audio_url` (Tavus has no
 * Polish voices of its own), short clips render reliably while one long
 * continuous render stalled, so the plugin orders one clip per slide.
 */

export const TAVUS_API = "https://tavusapi.com/v2"

export type TavusErrorCode = "http" | "gone" | "auth" | "rate_limited" | "unavailable" | "order_unknown" | "bad_answer" | "network" | "too_large"

export class TavusError extends Error {
  /** `order_unknown`: the order may exist at Tavus, never order the clip again on your own. */
  readonly code: TavusErrorCode
  readonly status?: number
  constructor(code: TavusErrorCode, message: string, status?: number) {
    super(message)
    this.name = "TavusError"
    this.code = code
    this.status = status
  }
}

export type TavusConfig = { apiKey: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

export type TavusVideo = {
  video_id: string
  status: string
  status_details: string | null
  /** 0 to 100, from Tavus' `generation_progress` ("33/100" or "33"). */
  progress: number
  download_url: string | null
  hosted_url: string | null
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** "33/100", "33", 33 or nothing, as a whole number from 0 to 100. */
export function progressOf(value: unknown): number {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : ""
  const m = text.match(/(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/)
  if (!m) return 0
  const n = Number(m[1])
  const of = m[2] ? Number(m[2]) : 100
  if (!Number.isFinite(n) || !Number.isFinite(of) || of <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((n / of) * 100)))
}

function asVideo(body: unknown): TavusVideo | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  if (typeof b.video_id !== "string" || !b.video_id || typeof b.status !== "string") return null
  const s = (v: unknown) => (typeof v === "string" && v ? v : null)
  return { video_id: b.video_id, status: b.status, status_details: s(b.status_details), progress: b.status === "ready" ? 100 : progressOf(b.generation_progress), download_url: s(b.download_url), hosted_url: s(b.hosted_url) }
}

/** The text of an error answer, short: Tavus explains refusals in JSON `message` or `error`. */
async function reason(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "")
  try {
    const j = JSON.parse(raw) as { message?: unknown; error?: unknown }
    const m = typeof j.message === "string" ? j.message : typeof j.error === "string" ? j.error : ""
    if (m) return m.slice(0, 300)
  } catch {
    /* not JSON */
  }
  return raw.slice(0, 300) || res.statusText
}

export type CreateVideoInput = { replicaId: string; audioUrl: string; name: string; callbackUrl?: string }

export async function createVideo(cfg: TavusConfig, input: CreateVideoInput): Promise<string> {
  const f = cfg.fetchImpl ?? fetch
  let res: Response
  try {
    res = await f(`${TAVUS_API}/videos`, {
      method: "POST",
      headers: { "x-api-key": cfg.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: input.replicaId, audio_url: input.audioUrl, video_name: input.name.slice(0, 120), ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}) }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (e) {
    throw new TavusError("order_unknown", `The order was sent but no answer came (${e instanceof Error ? e.message : String(e)}): check the Tavus dashboard before ordering again`)
  }
  if (res.status === 429) throw new TavusError("rate_limited", await reason(res), 429)
  /* A 5xx after the body was sent may still have created the video. */
  if (res.status >= 500) throw new TavusError("order_unknown", `Tavus answered ${res.status} (${await reason(res)}): check the Tavus dashboard before ordering again`, res.status)
  if (!res.ok) throw new TavusError("http", `Tavus refused the order: ${res.status} ${await reason(res)}`, res.status)
  const body = (await res.json().catch(() => null)) as { video_id?: unknown } | null
  if (!body || typeof body.video_id !== "string" || !body.video_id) throw new TavusError("order_unknown", "Tavus accepted the order without a video_id: check the Tavus dashboard")
  return body.video_id
}

export async function getVideo(cfg: TavusConfig, videoId: string, attempts = 4): Promise<TavusVideo> {
  const f = cfg.fetchImpl ?? fetch
  const sleep = cfg.sleep ?? wait
  let last: TavusError = new TavusError("network", "no answer")
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await f(`${TAVUS_API}/videos/${encodeURIComponent(videoId)}`, { headers: { "x-api-key": cfg.apiKey }, signal: AbortSignal.timeout(30_000) })
      if (res.ok) {
        const v = asVideo(await res.json().catch(() => null))
        if (!v) throw new TavusError("bad_answer", `Unexpected status answer for ${videoId}`)
        return v
      }
      const why = await reason(res)
      /* Only a video that is gone ends the clip; a refused key (401, 403) is the store's to fix, the clip keeps rendering. */
      const code = res.status === 429 ? "rate_limited" : res.status >= 500 ? "unavailable" : res.status === 404 || res.status === 410 ? "gone" : res.status === 401 || res.status === 403 ? "auth" : "http"
      last = new TavusError(code, `Tavus status ${res.status}: ${why}`, res.status)
      if (res.status !== 429 && res.status < 500) throw last
    } catch (e) {
      if (e instanceof TavusError && ["http", "gone", "auth", "bad_answer"].includes(e.code)) throw e
      if (!(e instanceof TavusError)) last = new TavusError("network", e instanceof Error ? e.message : String(e))
    }
    if (i < attempts) await sleep(1000 * 2 ** i)
  }
  throw last
}

/** The largest clip the plugin stores: it passes through memory as base64 for the File Module. */
export const MAX_CLIP_BYTES = 250 * 1024 * 1024

/**
 * The finished clip, read as a stream with a running byte count: a clip
 * above the limit stops the download (`too_large`, final) whether or not
 * the host sent its length. One attempt more on a broken download.
 */
export async function downloadVideo(url: string, fetchImpl: typeof fetch = fetch, maxBytes = MAX_CLIP_BYTES): Promise<Buffer> {
  let last = ""
  for (let i = 1; i <= 2; i++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10 * 60_000) })
      if (!res.ok) {
        last = `HTTP ${res.status}`
        await res.body?.cancel().catch(() => undefined)
        if (res.status < 500) break
        continue
      }
      const declared = Number(res.headers.get("content-length") ?? 0)
      if (declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined)
        throw new TavusError("too_large", `The clip has ${declared} bytes, the limit is ${maxBytes}`)
      }
      if (!res.body) return Buffer.from(await res.arrayBuffer())
      const chunks: Buffer[] = []
      let size = 0
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined)
          throw new TavusError("too_large", `The clip has more than ${maxBytes} bytes`)
        }
        chunks.push(Buffer.from(value))
      }
      return Buffer.concat(chunks, size)
    } catch (e) {
      if (e instanceof TavusError) throw e
      last = e instanceof Error ? e.message : String(e)
    }
  }
  throw new TavusError("unavailable", `The clip could not be downloaded (${last})`)
}
