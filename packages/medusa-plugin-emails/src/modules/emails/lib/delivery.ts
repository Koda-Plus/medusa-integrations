/**
 * DELIVERY: what happened to a message after Resend accepted it. Medusa's
 * notification table (and the plugin's own log) only know that the provider
 * took the message; whether the recipient's server delivered it, delayed it
 * or bounced it is known only to Resend. This reads it, GET only:
 *
 *   GET /suppressions          the addresses Resend no longer sends to (bounce, complaint, manual)
 *   GET /emails?limit=100      the latest messages with their last_event (paged by `after`)
 *   GET /emails/{id}           one message's last_event, for older rows of the page
 *
 * Docs: resend.com/docs/api-reference (emails/list-emails, emails/retrieve-email,
 * suppressions/list-suppressions). last_event: sent, delivered, delivery_delayed,
 * bounced, complained, opened, clicked, failed, suppressed, queued, scheduled, canceled.
 *
 * The key needs read access (a full access key; a sending-only key gets 401 on
 * these). Results are cached in memory, and every read stays under Resend's
 * 10 requests a second. Never throws to the caller: an error is a reason in
 * the result, and the log simply shows no delivery state.
 */

export type DeliveryEvent = "sent" | "delivered" | "delivery_delayed" | "bounced" | "complained" | "opened" | "clicked" | "failed" | "suppressed" | "queued" | "scheduled" | "canceled" | string

export interface Suppression {
  email: string
  origin: "bounce" | "complaint" | "manual" | string
  sourceId: string | null
  createdAt: string | null
}

export interface RecentEmail {
  id: string
  to: string[]
  subject: string | null
  createdAt: string | null
  lastEvent: DeliveryEvent | null
}

type Fetch = typeof fetch

const API = "https://api.resend.com"
const SUPPRESSIONS_TTL = 10 * 60_000
const RECENT_TTL = 5 * 60_000
const EVENT_TTL_FINAL = 60 * 60_000
const EVENT_TTL_OPEN = 5 * 60_000
const RECENT_PAGES = 5
const SUPPRESSION_PAGES = 20
const PER_CALL_LOOKUPS = 20
/** Final states do not change any more: cached longer. */
const FINAL = new Set(["delivered", "bounced", "complained", "opened", "clicked", "failed", "suppressed", "canceled"])

type Page = { data?: any[]; has_more?: boolean }
type Got<T> = { ok: true; data: T } | { ok: false; status: number; message: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class DeliveryReader {
  private suppressionsCache: { at: number; list: Suppression[] } | null = null
  private recentCache: { at: number; list: RecentEmail[] } | null = null
  private events = new Map<string, { at: number; event: DeliveryEvent | null }>()
  private last = 0
  private readonly key: string
  private readonly fetchImpl: Fetch
  constructor(key: string, fetchImpl: Fetch = fetch) {
    this.key = key
    this.fetchImpl = fetchImpl
  }

  /* One request at a time, at most ~8 a second (Resend: 10 per second per team). */
  private async get<T>(path: string): Promise<Got<T>> {
    const wait = this.last + 125 - Date.now()
    if (wait > 0) await sleep(wait)
    this.last = Date.now()
    try {
      const r = await this.fetchImpl(`${API}${path}`, { method: "GET", headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) })
      if (r.status === 429) {
        await sleep(1000)
        return { ok: false, status: 429, message: "Resend: too many requests" }
      }
      if (!r.ok) return { ok: false, status: r.status, message: r.status === 401 || r.status === 403 ? "the Resend key cannot read (it needs full access, not sending only)" : `Resend answered HTTP ${r.status}` }
      return { ok: true, data: (await r.json()) as T }
    } catch (e) {
      return { ok: false, status: 0, message: `Resend unreachable (${(e as Error)?.message ?? "network"})` }
    }
  }

  /** Every suppressed address, newest first. */
  async suppressions(fresh = false): Promise<{ list: Suppression[]; readAt: string; error: string | null }> {
    if (!fresh && this.suppressionsCache && Date.now() - this.suppressionsCache.at < SUPPRESSIONS_TTL) return { list: this.suppressionsCache.list, readAt: new Date(this.suppressionsCache.at).toISOString(), error: null }
    const out: Suppression[] = []
    let after: string | null = null
    for (let page = 0; page < SUPPRESSION_PAGES; page++) {
      const r: Got<Page> = await this.get<Page>(`/suppressions?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`)
      if (!r.ok) {
        if (!out.length) return { list: this.suppressionsCache?.list ?? [], readAt: new Date().toISOString(), error: r.message }
        break
      }
      const data: any[] = r.data.data ?? []
      for (const x of data) out.push({ email: String(x.email ?? "").toLowerCase(), origin: String(x.origin ?? ""), sourceId: x.source_id ?? null, createdAt: x.created_at ?? null })
      if (!r.data.has_more || !data.length) break
      after = String(data[data.length - 1].id)
    }
    out.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    this.suppressionsCache = { at: Date.now(), list: out }
    return { list: out, readAt: new Date().toISOString(), error: null }
  }

  /** The latest messages (up to 500) with their last event; feeds the per-message cache. */
  async recent(fresh = false): Promise<{ list: RecentEmail[]; error: string | null }> {
    if (!fresh && this.recentCache && Date.now() - this.recentCache.at < RECENT_TTL) return { list: this.recentCache.list, error: null }
    const out: RecentEmail[] = []
    let after: string | null = null
    for (let page = 0; page < RECENT_PAGES; page++) {
      const r: Got<Page> = await this.get<Page>(`/emails?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`)
      if (!r.ok) {
        if (!out.length) return { list: this.recentCache?.list ?? [], error: r.message }
        break
      }
      const data: any[] = r.data.data ?? []
      for (const x of data) {
        const e: RecentEmail = { id: String(x.id), to: Array.isArray(x.to) ? x.to.map(String) : [String(x.to ?? "")], subject: x.subject ?? null, createdAt: x.created_at ?? null, lastEvent: x.last_event ?? null }
        out.push(e)
        this.events.set(e.id, { at: Date.now(), event: e.lastEvent })
      }
      if (!r.data.has_more || !data.length) break
      after = String(data[data.length - 1].id)
    }
    this.recentCache = { at: Date.now(), list: out }
    return { list: out, error: null }
  }

  /** The last event of each message id (Resend email ids), from the cache or one read each, a few per call. */
  async eventsFor(ids: Array<string | null | undefined>): Promise<Map<string, DeliveryEvent | null>> {
    const out = new Map<string, DeliveryEvent | null>()
    const wanted = [...new Set(ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{20,}$/i.test(x)))]
    if (!wanted.length) return out
    await this.recent()
    let lookups = 0
    for (const id of wanted) {
      const c = this.events.get(id)
      const ttl = c && c.event && FINAL.has(c.event) ? EVENT_TTL_FINAL : EVENT_TTL_OPEN
      if (c && Date.now() - c.at < ttl) {
        out.set(id, c.event)
        continue
      }
      if (lookups >= PER_CALL_LOOKUPS) continue
      lookups++
      const r = await this.get<{ last_event?: string }>(`/emails/${encodeURIComponent(id)}`)
      if (r.ok) {
        const ev = r.data.last_event ?? null
        this.events.set(id, { at: Date.now(), event: ev })
        out.set(id, ev)
      }
    }
    return out
  }
}

/* One reader per key in the process: the caches outlive a request. */
const readers = new Map<string, DeliveryReader>()
export function deliveryReader(key: string | null | undefined): DeliveryReader | null {
  if (!key) return null
  let r = readers.get(key)
  if (!r) {
    r = new DeliveryReader(key)
    readers.set(key, r)
  }
  return r
}

/* Frequent typos in the domain of an address: the usual reason of a bounce in a shop. */
const DOMAIN_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.pl": "gmail.com",
  "gamil.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gnail.com": "gmail.com",
  "wp.p": "wp.pl",
  "wp.com": "wp.pl",
  "onet.p": "onet.pl",
  "onet.com": "onet.pl",
  "interia.p": "interia.pl",
  "interia.com": "interia.pl",
  "o2.p": "o2.pl",
  "hotmial.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "icloud.co": "icloud.com",
}

/** The address with its domain corrected, when the domain is a known typo; else null. */
export function domainTypo(email: string): string | null {
  const at = email.lastIndexOf("@")
  if (at < 1) return null
  const domain = email.slice(at + 1).toLowerCase()
  const fixed = DOMAIN_FIXES[domain]
  return fixed ? `${email.slice(0, at)}@${fixed}` : null
}
