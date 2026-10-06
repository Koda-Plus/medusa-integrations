/**
 * THE RESEND CLIENT: one endpoint, `POST https://api.resend.com/emails`.
 * Zero imports beyond the constants; `fetch` is injected for the tests.
 *
 * What it relies on (docs/resend-api-notes.md):
 *   - `Authorization: Bearer re_...`, JSON body with from, to, subject, html,
 *     text, reply_to, cc, bcc, headers, tags, attachments; answer `{ id }`;
 *   - `Idempotency-Key` (1 to 256 characters, kept 24 hours): the same key
 *     and payload returns the first answer and sends nothing again; the same
 *     key with another payload is refused (409 invalid_idempotent_request);
 *     a request still running under the key gives 409
 *     concurrent_idempotent_requests;
 *   - errors as `{ statusCode, name, message }`; 429 with `retry-after`.
 *
 * NO RETRY STORMS:
 *   - only answers that say "try again" are tried again (network errors,
 *     timeouts, 5xx, rate_limit_exceeded, concurrent_idempotent_requests), at
 *     most `maxRetries` times, with the same Idempotency-Key, so a retry can
 *     never send twice;
 *   - the wait follows `retry-after` (at most 10 s) or grows 0.6 s, 2 s;
 *   - after 5 temporary failures in a row the process stops retrying for a
 *     minute (each send still gets one try);
 *   - every request waits its turn: `requestsPerSecond` per process;
 *   - quotas, auth and validation errors are final: no retry.
 */

import { BREAKER_COOLDOWN_MS, BREAKER_THRESHOLD, MAX_RETRY_WAIT_MS, RESEND_EMAILS_URL } from "./constants"

export interface ResendPayload {
  from: string
  to: string[]
  subject: string
  html?: string
  text?: string
  reply_to?: string[]
  cc?: string[]
  bcc?: string[]
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
  attachments?: Array<{ filename: string; content: string; content_type?: string }>
}

export interface ResendFailure {
  /** Resend's error name (`validation_error`), or NETWORK, TIMEOUT, HTTP_<status>, NO_ID. */
  code: string
  status: number | null
  message: string
  /** Worth another try later (a person's retry): temporary on Resend's side. */
  temporary: boolean
  /** The message may have gone out (a timeout, a 5xx after the request reached Resend, an idempotency conflict). */
  maybeSent: boolean
}

export type ResendResult = { ok: true; id: string; attempts: number } | { ok: false; error: ResendFailure; attempts: number }

/** What an answer means: final or not, worth another try now, and how long to wait. */
export interface Verdict {
  retryNow: boolean
  waitMs: number
  failure: ResendFailure
}

function retryAfterMs(headers: { get(name: string): string | null } | null | undefined): number | null {
  const raw = headers?.get("retry-after")
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_WAIT_MS, Math.round(seconds * 1000))
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.min(MAX_RETRY_WAIT_MS, Math.max(0, at - Date.now())) : null
}

/** Classifies an HTTP error answer of Resend. */
export function classify(status: number, body: unknown, headers?: { get(name: string): string | null } | null): Verdict {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : `HTTP_${status}`
  const message = (typeof b.message === "string" && b.message.trim() ? b.message.trim() : typeof b.error === "string" ? b.error : `Resend answered HTTP ${status}.`).slice(0, 800)
  const failure = (temporary: boolean, maybeSent: boolean): ResendFailure => ({ code: name, status, message, temporary, maybeSent })
  if (status === 429) {
    if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") return { retryNow: false, waitMs: 0, failure: failure(false, false) }
    return { retryNow: true, waitMs: retryAfterMs(headers) ?? 1000, failure: failure(true, false) }
  }
  if (status === 409) {
    if (name === "concurrent_idempotent_requests") return { retryNow: true, waitMs: retryAfterMs(headers) ?? 1000, failure: failure(true, true) }
    if (name === "resource_locked") return { retryNow: true, waitMs: 1000, failure: failure(true, false) }
    /* invalid_idempotent_request: the key was used in the last 24 hours with another payload, so that one went in. */
    return { retryNow: false, waitMs: 0, failure: failure(false, true) }
  }
  if (status >= 500) {
    const unavailable = status === 503
    return { retryNow: true, waitMs: retryAfterMs(headers) ?? 0, failure: failure(true, !unavailable) }
  }
  return { retryNow: false, waitMs: 0, failure: failure(false, false) }
}

/* ------------------------------------------------------------------ */
/* Process-wide pacing and the breaker                                 */
/* ------------------------------------------------------------------ */

const STATE_KEY = Symbol.for("koda.emails.resendState")
interface PaceState {
  nextSlot: number
  failures: number
  openUntil: number
}
type Holder = typeof globalThis & { [STATE_KEY]?: PaceState }

export function paceState(): PaceState {
  const holder = globalThis as Holder
  if (!holder[STATE_KEY]) holder[STATE_KEY] = { nextSlot: 0, failures: 0, openUntil: 0 }
  return holder[STATE_KEY] as PaceState
}

/** For the tests: a fresh pace and breaker. */
export function resetPace(): void {
  const s = paceState()
  s.nextSlot = 0
  s.failures = 0
  s.openUntil = 0
}

export interface ResendClientDeps {
  apiKey: string
  timeoutMs: number
  maxRetries: number
  requestsPerSecond: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Jitter of the backoff, 0 to 1; injected as 0 in the tests. */
  random?: () => number
}

export interface ResendClient {
  send(payload: ResendPayload, idempotencyKey: string): Promise<ResendResult>
}

const BACKOFF_MS = [600, 2000, 5000]

export function createResendClient(deps: ResendClientDeps): ResendClient {
  const doFetch = deps.fetch ?? globalThis.fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = deps.now ?? (() => Date.now())
  const random = deps.random ?? Math.random
  const interval = 1000 / Math.max(0.1, deps.requestsPerSecond)

  async function waitTurn(): Promise<void> {
    const s = paceState()
    const t = now()
    const slot = Math.max(t, s.nextSlot)
    s.nextSlot = slot + interval
    if (slot > t) await sleep(slot - t)
  }

  async function once(payload: ResendPayload, key: string): Promise<{ ok: true; id: string } | { ok: false; verdict: Verdict }> {
    await waitTurn()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
    try {
      const res = await doFetch(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": key,
          "User-Agent": "KodaPlus-Medusa-Emails/0.1 (+https://koda.plus)",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const raw = await res.text().catch(() => "")
      let body: unknown = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = { message: raw.slice(0, 300) }
      }
      if (res.ok) {
        const id = body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : ""
        if (id) return { ok: true, id }
        return {
          ok: false,
          verdict: { retryNow: false, waitMs: 0, failure: { code: "NO_ID", status: res.status, message: "Resend answered without an e-mail id.", temporary: true, maybeSent: true } },
        }
      }
      return { ok: false, verdict: classify(res.status, body, res.headers) }
    } catch (err) {
      const timeout = (err as { name?: string } | null)?.name === "AbortError"
      return {
        ok: false,
        verdict: {
          retryNow: true,
          waitMs: 0,
          failure: {
            code: timeout ? "TIMEOUT" : "NETWORK",
            status: null,
            message: timeout ? `No answer from Resend within ${Math.round(deps.timeoutMs / 1000)} s.` : `Could not reach Resend: ${(err as Error)?.message ?? String(err)}`.slice(0, 500),
            temporary: true,
            maybeSent: true,
          },
        },
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async send(payload, key) {
      const state = paceState()
      let attempts = 0
      for (;;) {
        attempts += 1
        const r = await once(payload, key)
        if (r.ok) {
          state.failures = 0
          return { ok: true, id: r.id, attempts }
        }
        const { verdict } = r
        if (verdict.failure.temporary) {
          state.failures += 1
          if (state.failures >= BREAKER_THRESHOLD) state.openUntil = now() + BREAKER_COOLDOWN_MS
        }
        const open = now() < state.openUntil
        if (!verdict.retryNow || attempts > deps.maxRetries || open) return { ok: false, error: verdict.failure, attempts }
        const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
        const wait = Math.min(MAX_RETRY_WAIT_MS, Math.max(verdict.waitMs, Math.round(backoff * (0.8 + 0.4 * random()))))
        await sleep(wait)
      }
    },
  }
}
