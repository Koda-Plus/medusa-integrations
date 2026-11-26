/**
 * The pure part of the render: which clips a script needs, the signature
 * that decides whether a clip is ordered again, the length of a WAV, the
 * quote the office confirms and whether a URL is one Tavus can fetch.
 * Zero imports of the server on purpose: the tests run it as it is.
 */
import { createHash } from "node:crypto"
import type { Script } from "./script"

/** Tavus takes speech from 3 seconds to 10 minutes per clip. */
export const CLIP_MIN_MS = 3000
export const CLIP_MAX_MS = 10 * 60_000

export type RenderItem = { item_id: string; kind: "slide" | "short"; text: string }

/** One clip per slide, then the short versions when asked for. */
export function renderItems(script: Script, withShorts: boolean): RenderItem[] {
  const items: RenderItem[] = script.slides.map((s) => ({ item_id: s.id, kind: "slide" as const, text: s.narration }))
  if (withShorts) items.push(...script.shorts.map((k) => ({ item_id: k.id, kind: "short" as const, text: k.narration })))
  return items
}

/**
 * What a clip says and how: the face, the voice, the speech model, the
 * director's notes and the text. A clip is ordered again only when this
 * changes, so editing one slide re-renders one clip.
 */
export function clipSignature(p: { faceId: string; voice: string; ttsModel: string; style: string; text: string }): string {
  return createHash("sha256").update([p.faceId, p.voice, p.ttsModel, p.style, p.text].join("\n")).digest("hex").slice(0, 32)
}

/**
 * The length of a PCM WAV in milliseconds, read from its header (the byte
 * rate and the size of the `data` chunk). Null for anything else.
 */
export function wavDurationMs(buf: Buffer): number | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null
  let byteRate = 0
  let at = 12
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4)
    const size = buf.readUInt32LE(at + 4)
    if (id === "fmt " && at + 20 <= buf.length) byteRate = buf.readUInt32LE(at + 8 + 8)
    if (id === "data") {
      if (!byteRate) return null
      const data = Math.min(size, buf.length - at - 8)
      return Math.round((data / byteRate) * 1000)
    }
    at += 8 + size + (size % 2)
  }
  return null
}

export type QuoteClip = { item_id: string; signature: string; duration_ms: number; reused: boolean }

/** Minutes the office pays for: only clips that are not already rendered, rounded up to a tenth. */
export function quoteMinutes(clips: QuoteClip[]): number {
  const ms = clips.filter((c) => !c.reused).reduce((a, c) => a + c.duration_ms, 0)
  return Math.ceil(ms / 6000) / 10
}

/** The hash of a quote: a confirmation is valid only for exactly these clips. */
export function quoteHash(scriptHash: string, faceId: string, clips: QuoteClip[]): string {
  const lines = [...clips].sort((a, b) => a.item_id.localeCompare(b.item_id)).map((c) => `${c.item_id}:${c.signature}:${c.duration_ms}:${c.reused ? 1 : 0}`)
  return createHash("sha256").update([scriptHash, faceId, ...lines].join("\n")).digest("hex").slice(0, 32)
}

/**
 * Whether Tavus can fetch the file: https on a public host. The local file
 * provider of a dev store (http://localhost) answers no, so the render is
 * refused before anything is paid.
 */
export function isPublicUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== "https:") return false
    const h = u.hostname.toLowerCase()
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]") return false
    return true
  } catch {
    return false
  }
}

/** Runs `fn` over the list with at most `limit` at once, in order of the results. */
export async function mapLimit<T, R>(list: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++
      out[i] = await fn(list[i], i)
    }
  })
  await Promise.all(workers)
  return out
}
