/**
 * Test doubles shared by the tests (this file is not a test itself: the
 * runner picks up `*.test.ts` only).
 *
 *   memoryStore   the send log with the SAME rules as the SQL store: a unique
 *                 row per key and mode, claims only for new keys or from the
 *                 retryable states, results only for the claim's owner
 *   FakeResend    a scripted Resend behind `fetch`, recording every request
 *   logger        collects what the plugin logs
 *   container     a fake Medusa container for the flows
 */
import { resolveOptions, type EmailsPluginOptions } from "../src/modules/emails/lib/options.ts"
import type { SettingRow } from "../src/modules/emails/lib/settings.ts"
import type { Counts, MessagePatch, MessageRow, MessageStore, NewMessage, StatRow } from "../src/modules/emails/lib/store.ts"

export const API_KEY = "re_TEST_0123456789abcdefghij"
export const LIVE: EmailsPluginOptions = {
  apiKey: API_KEY,
  from: "Koda Supply <orders@mail.example.com>",
  replyTo: "support@example.com",
  storefrontUrl: "https://shop.example.com",
  brand: { name: "Koda Supply", supportEmail: "help@example.com" },
  timeZone: "Europe/Warsaw",
  requestsPerSecond: 1000,
}

export const live = (extra: EmailsPluginOptions = {}) => resolveOptions({ ...LIVE, ...extra })

/* ------------------------------------------------------------------ */
/* The send log in memory                                             */
/* ------------------------------------------------------------------ */

export interface MemoryStore extends MessageStore {
  rows: MessageRow[]
  settingRows: SettingRow[]
  failWith?: Error
}

export function memoryStore(): MemoryStore {
  let seq = 0
  const rows: MessageRow[] = []
  const settingRows: SettingRow[] = []
  const byKey = (key: string, demo: boolean) => rows.find((r) => r.key === key && r.demo === demo)
  const make = (m: NewMessage, extra: Partial<MessageRow>): MessageRow => {
    seq += 1
    const now = new Date()
    return {
      id: `emmsg_${String(seq).padStart(4, "0")}`,
      key: m.key,
      template: m.template,
      locale: m.locale,
      demo: m.demo,
      kind: m.kind,
      status: "sending",
      recipient: m.recipient,
      subject: m.subject,
      trigger: m.trigger,
      resource_type: m.resource_type,
      resource_id: m.resource_id,
      order_id: m.order_id,
      notification_id: m.notification_id,
      external_id: null,
      resend_key: null,
      rotation: 0,
      attempts: 0,
      error_code: null,
      error: null,
      retryable: false,
      claim_token: null,
      lease_until: null,
      sent_at: null,
      requested_by: m.requested_by,
      body_html: null,
      body_text: null,
      created_at: m.created_at ?? now,
      updated_at: now,
      ...extra,
    }
  }
  const store: MemoryStore = {
    rows,
    settingRows,
    async claimNew(m, args) {
      if (store.failWith) throw store.failWith
      if (byKey(m.key, m.demo)) return null
      const row = make(m, { status: "sending", resend_key: args.resendKey, attempts: 1, claim_token: args.token, lease_until: args.leaseUntil })
      rows.push(row)
      return { ...row }
    },
    async claimRetry(key, demo, args) {
      const row = byKey(key, demo)
      if (!row) return null
      const stale = row.status === "sending" && row.lease_until !== null && new Date(row.lease_until).getTime() < Date.now()
      if (!["failed", "unknown", "skipped"].includes(String(row.status)) && !stale) return null
      row.status = "sending"
      row.rotation += 1
      row.resend_key = `${row.key}#r${row.rotation}`
      row.attempts += 1
      row.claim_token = args.token
      row.lease_until = args.leaseUntil
      row.error = null
      row.error_code = null
      row.retryable = false
      row.notification_id = args.notificationId ?? row.notification_id
      row.requested_by = args.requestedBy ?? row.requested_by
      return { ...row }
    },
    async finish(id, token, patch: MessagePatch) {
      const row = rows.find((r) => r.id === id)
      if (!row || row.claim_token !== token || row.status !== "sending") return false
      Object.assign(row, patch, { claim_token: null, lease_until: null, updated_at: new Date() })
      return true
    },
    async record(m) {
      if (store.failWith) throw store.failWith
      if (byKey(m.key, m.demo)) return null
      const row = make(m, {
        status: m.status,
        external_id: m.external_id ?? null,
        error_code: m.error_code ?? null,
        error: m.error ?? null,
        retryable: m.retryable ?? false,
        sent_at: m.sent_at ?? null,
        body_html: m.body_html ?? null,
        body_text: m.body_text ?? null,
        attempts: m.status === "skipped" ? 0 : 1,
      })
      rows.push(row)
      return { ...row }
    },
    async replaceSeed(input) {
      if (store.failWith) throw store.failWith
      const keys = new Set<string>()
      let written = 0
      for (const m of input) {
        if (!m.demo || m.kind !== "seed" || keys.has(m.key)) continue
        keys.add(m.key)
        const existing = byKey(m.key, true)
        const fresh = make(m, {
          status: m.status,
          external_id: m.external_id ?? null,
          error_code: m.error_code ?? null,
          error: m.error ?? null,
          retryable: m.retryable ?? false,
          sent_at: m.sent_at ?? null,
          body_html: m.body_html ?? null,
          body_text: m.body_text ?? null,
          attempts: m.status === "skipped" ? 0 : 1,
        })
        if (!existing) {
          rows.push(fresh)
          written += 1
        } else if (existing.kind === "seed" && existing.status !== "sending") {
          const { id: _id, key: _key, demo: _demo, kind: _kind, ...rest } = fresh
          Object.assign(existing, rest)
          written += 1
        }
      }
      const keep = rows.filter((r) => !(r.demo && r.kind === "seed" && r.status !== "sending" && !keys.has(r.key)))
      const removed = rows.length - keep.length
      rows.splice(0, rows.length, ...keep)
      return { written, removed }
    },
    async find(key, demo) {
      const row = byKey(key, demo)
      return row ? { ...row } : null
    },
    async existingKeys(keys, demo) {
      return new Set(rows.filter((r) => r.demo === demo && keys.includes(r.key)).map((r) => r.key))
    },
    async expireLeases(now) {
      let n = 0
      for (const r of rows) {
        if (r.status === "sending" && r.lease_until && new Date(r.lease_until).getTime() < now.getTime()) {
          r.status = "unknown"
          r.error_code = "lease_expired"
          r.claim_token = null
          r.lease_until = null
          r.retryable = true
          n += 1
        }
      }
      return n
    },
    async prune(before, demo) {
      const keep = rows.filter((r) => !(r.demo === demo && new Date(r.created_at).getTime() < before.getTime() && r.status !== "sending"))
      const removed = rows.length - keep.length
      rows.splice(0, rows.length, ...keep)
      return removed
    },
    async stats(demo, since): Promise<StatRow[]> {
      const map = new Map<string, StatRow>()
      for (const r of rows) {
        if (r.demo !== demo || new Date(r.created_at).getTime() < since.getTime()) continue
        const k = `${r.template}|${r.status}`
        const s = map.get(k) ?? { template: r.template, status: String(r.status), count: 0, last_at: null }
        s.count += 1
        s.last_at = r.created_at
        map.set(k, s)
      }
      return [...map.values()]
    },
    async counts(demo, now): Promise<Counts> {
      const day = now.getTime() - 24 * 3600 * 1000
      const month = now.getTime() - 30 * 24 * 3600 * 1000
      const mine = rows.filter((r) => r.demo === demo && new Date(r.created_at).getTime() >= month)
      return {
        sent24h: mine.filter((r) => r.status === "sent" && new Date(r.created_at).getTime() >= day).length,
        sent30d: mine.filter((r) => r.status === "sent").length,
        attention30d: mine.filter((r) => r.status === "failed" || r.status === "unknown").length,
        tests30d: mine.filter((r) => r.kind === "test").length,
        skipped30d: mine.filter((r) => r.status === "skipped").length,
      }
    },
    async settings() {
      return settingRows.map((r) => ({ ...r }))
    },
    async setSetting(key, value, by) {
      const row = settingRows.find((r) => r.key === key)
      if (row) Object.assign(row, { value, updated_by: by, updated_at: new Date() })
      else settingRows.push({ key, value, updated_by: by, updated_at: new Date() })
    },
  }
  return store
}

/* ------------------------------------------------------------------ */
/* Resend behind fetch                                                 */
/* ------------------------------------------------------------------ */

export interface ResendCall {
  url: string
  headers: Record<string, string>
  body: Record<string, any>
}

type Scripted = { status: number; body?: unknown; headers?: Record<string, string> } | "timeout" | "network"

export class FakeResend {
  calls: ResendCall[] = []
  private script: Scripted[] = []
  private seq = 0
  /** Answers given in order; when they run out, every request succeeds. */
  answer(...answers: Scripted[]): this {
    this.script.push(...answers)
    return this
  }
  fetch = async (url: unknown, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v
    this.calls.push({ url: String(url), headers, body: JSON.parse(String(init?.body ?? "{}")) })
    const next = this.script.shift()
    if (next === "timeout") {
      const err = new Error("This operation was aborted")
      err.name = "AbortError"
      throw err
    }
    if (next === "network") throw new TypeError("fetch failed")
    if (next) return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status, headers: next.headers })
    this.seq += 1
    return new Response(JSON.stringify({ id: `re_msg_${this.seq}` }), { status: 200 })
  }
}

/* ------------------------------------------------------------------ */
/* Logger                                                              */
/* ------------------------------------------------------------------ */

export function logger() {
  const lines: string[] = []
  return {
    lines,
    info: (m: string) => void lines.push(`info ${m}`),
    warn: (m: string) => void lines.push(`warn ${m}`),
    error: (m: string) => void lines.push(`error ${m}`),
    debug: (m: string) => void lines.push(`debug ${m}`),
  }
}

/** Every character that may never appear in copy: en dash, em dash, middle dot. */
export const FORBIDDEN = /[–—·]/
