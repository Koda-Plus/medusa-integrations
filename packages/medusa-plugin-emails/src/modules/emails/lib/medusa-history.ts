/**
 * APP MODE HISTORY: the e-mails Medusa's notification module handed to the
 * store's own provider, read from Medusa's `notification` table. The log then
 * shows every message from the store's first day, not only the ones the
 * provider reported since the plugin was installed, and it works before the
 * plugin's migrations ran (the log falls back to this history alone).
 *
 * Read only, and never a body: the columns the log needs, the address masked
 * on the way out, and the data only for the subject, without attachments and
 * without anything shaped like a link or a secret. A notification the
 * provider also reported (`recordAppEmail` keeps its id in `notification_id`)
 * is listed once, as the plugin's richer row.
 *
 * Every query here is plain SQL for the knex connection Medusa registers
 * (`?` bindings), so the whole log of app mode is one sorted, paged union.
 */

import { customerIdOf } from "./keys"
import { isEmail, maskEmail } from "./security"
import type { MessageRow } from "./store"
import type { MessageFilter } from "./contract"

export interface HistoryQuery {
  filter: MessageFilter
  template?: string | null
  orderId?: string | null
  since?: Date | null
  /** A full address searched for (the `q` of the log when it is an address). */
  email?: string | null
  /** The messages of one customer: by the receiver id, or by the customer's address. */
  customerId?: string | null
  customerEmail?: string | null
  /** Any other search text: the template, an order id, an order number (#1234). */
  text?: string | null
  /** Search `text` also in the addresses, by any part (option showAddresses). */
  addresses?: boolean
  /** Filter `bounced` with what Resend knows: suppressed addresses and bounced message ids. */
  bounced?: { emails: string[]; ids: string[] } | null
  /** The hash of `email` / `customerEmail`, for the plugin's own rows. */
  emailHash?: string | null
  customerEmailHash?: string | null
  limit: number
  offset: number
}

export interface SqlRaw {
  raw(sql: string, bindings?: unknown[]): Promise<{ rows?: Array<Record<string, unknown>> }>
}

/** Data keys never read, not even for a subject: bodies, attachments, links and secrets. */
const DROPPED_IN_SQL = ["attachment_pdf_base64", "attachments", "attachment", "html", "text", "body", "content"]
const SECRET_KEY = /(token|secret|password|passw|base64|attachment|url|link|code|hash|signature)/i

/** The data a subject may read: the scalar fields that are not links or secrets. */
export function subjectData(data: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!data || typeof data !== "object" || Array.isArray(data)) return out
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) continue
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      if (typeof v === "string" && (v.length > 300 || /^https?:\/\//i.test(v))) continue
      out[k] = v
    }
  }
  return out
}

/** Medusa's statuses as the log's. */
export function historyStatus(s: unknown): "sent" | "failed" | "sending" {
  if (s === "success") return "sent"
  if (s === "failure") return "failed"
  return "sending"
}

const ORDER_ID = /^order_[A-Za-z0-9]+$/

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** The addresses of a `to` as they are, tidied (option showAddresses). */
export function fullRecipients(to: unknown): string | null {
  const parts = String(to ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

/** Every address of a `to` masked, as the plugin's own rows keep it. */
export function maskRecipients(to: unknown): string | null {
  const parts = String(to ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  return parts.map((a) => (isEmail(a) ? maskEmail(a) : "***")).join(", ")
}

/**
 * One union row as the log's row. Plugin rows come as they are stored
 * (already masked); history rows get their address masked here and a subject
 * from the template, when it can tell one (`subjectOf`).
 */
export function unionRowToMessage(
  r: Record<string, unknown>,
  subjectOf: (template: string, data: Record<string, unknown>, locale: string | null) => string | null,
  showAddresses = false,
): MessageRow & { source: "plugin" | "medusa" } {
  const medusa = r.source === "medusa"
  const template = str(r.template) ?? "unknown"
  const locale = str(r.locale)
  let subject = str(r.subject)
  if (medusa && !subject) {
    try {
      subject = subjectOf(template, subjectData(r.data), locale)
    } catch {
      subject = null
    }
  }
  const orderId = str(r.order_id)
  return {
    source: medusa ? "medusa" : "plugin",
    id: String(r.id),
    key: String(r.key ?? r.id),
    template,
    locale,
    demo: false,
    kind: medusa ? "medusa" : String(r.kind ?? "app"),
    status: medusa ? historyStatus(r.status) : String(r.status),
    recipient: showAddresses && str(r.recipient_full) ? fullRecipients(r.recipient_full) : medusa ? maskRecipients(r.recipient) : str(r.recipient),
    subject: subject ? subject.slice(0, 300) : null,
    trigger: str(r.trigger),
    resource_type: str(r.resource_type),
    resource_id: str(r.resource_id),
    order_id: orderId && ORDER_ID.test(orderId) ? orderId : null,
    notification_id: medusa ? String(r.id) : str(r.notification_id),
    external_id: str(r.external_id),
    resend_key: null,
    rotation: Number(r.rotation ?? 0),
    attempts: Number(r.attempts ?? (medusa ? 1 : 0)),
    error_code: medusa ? (r.status === "failure" ? "PROVIDER_ERROR" : null) : str(r.error_code),
    error: medusa ? null : str(r.error),
    retryable: medusa ? false : Boolean(r.retryable),
    claim_token: null,
    lease_until: null,
    sent_at: (r.sent_at as Date | string | null) ?? null,
    requested_by: medusa ? null : str(r.requested_by),
    body_html: r.has_body ? "1" : null,
    body_text: null,
    customer_id: customerIdOf(str(r.customer_id)),
    recipient_hash: null,
    created_at: (r.created_at as Date | string) ?? new Date(0),
    updated_at: (r.updated_at as Date | string) ?? new Date(0),
  } as MessageRow & { source: "plugin" | "medusa" }
}

/* ------------------------------------------------------------------ */
/* SQL                                                                 */
/* ------------------------------------------------------------------ */

/** The `to` of a notification as an array of lower-case addresses. */
const TO_ARRAY = `string_to_array(replace(lower(n."to"), ' ', ''), ',')`

/** The order a notification is about: its resource, else the data's order_id or order.id. */
const N_ORDER = `coalesce(case when n.resource_type = 'order' then n.resource_id end, n.data->>'order_id', n.data->'order'->>'id')`

function historyWhere(q: HistoryQuery, ownTable: boolean): { sql: string; bindings: unknown[] } | null {
  /* History has no skips or tests of its own; bounces only when Resend told us (q.bounced). */
  if (q.filter === "skipped" || q.filter === "test") return null
  if (q.filter === "bounced" && !(q.bounced && (q.bounced.emails.length || q.bounced.ids.length))) return null
  const parts: string[] = [`n.channel = 'email'`, `n.deleted_at is null`]
  const b: unknown[] = []
  if (q.filter === "sent") parts.push(`n.status = 'success'`)
  if (q.filter === "attention") parts.push(`n.status = 'failure'`)
  if (q.filter === "bounced" && q.bounced) {
    const e = q.bounced.emails.slice(0, 500)
    const i = q.bounced.ids.slice(0, 500)
    const or: string[] = []
    if (e.length) {
      or.push(`exists (select 1 from unnest(${TO_ARRAY}) a where a in (${e.map(() => "?").join(", ")}))`)
      b.push(...e)
    }
    if (i.length) {
      or.push(`n.external_id in (${i.map(() => "?").join(", ")})`)
      b.push(...i)
    }
    parts.push(`(${or.join(" or ")})`)
  }
  if (q.template) {
    parts.push(`n.template = ?`)
    b.push(q.template)
  }
  if (q.orderId) {
    parts.push(`${N_ORDER} = ?`)
    b.push(q.orderId)
  }
  if (q.since) {
    parts.push(`n.created_at >= ?`)
    b.push(q.since)
  }
  if (q.email) {
    parts.push(`? = any(${TO_ARRAY})`)
    b.push(q.email.toLowerCase())
  }
  if (q.customerId) {
    if (q.customerEmail) {
      parts.push(`(n.receiver_id = ? or ? = any(${TO_ARRAY}))`)
      b.push(q.customerId, q.customerEmail.toLowerCase())
    } else {
      parts.push(`n.receiver_id = ?`)
      b.push(q.customerId)
    }
  }
  if (q.text) {
    const t = q.text.slice(0, 80)
    const number = t.replace(/^#/, "")
    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    parts.push(`(n.template ilike ? or n.id = ? or n.resource_id = ? or ${N_ORDER} = ? or n.data->>'display_id' = ?${q.addresses ? ` or n."to" ilike ?` : ""})`)
    b.push(like, t, t, t, number, ...(q.addresses ? [like] : []))
  }
  if (ownTable) parts.push(`not exists (select 1 from "emails_message" m2 where m2.notification_id = n.id and m2.deleted_at is null)`)
  return { sql: parts.join(" and "), bindings: b }
}

function ownWhere(q: HistoryQuery): { sql: string; bindings: unknown[] } {
  const parts: string[] = [`m.deleted_at is null`, `m.demo = false`]
  const b: unknown[] = []
  if (q.filter === "sent") parts.push(`m.status = 'sent'`)
  if (q.filter === "attention") parts.push(`m.status in ('failed', 'unknown')`)
  if (q.filter === "skipped") parts.push(`m.status = 'skipped'`)
  if (q.filter === "test") parts.push(`m.kind = 'test'`)
  if (q.filter === "bounced") {
    const or = [`(m.status = 'failed' and m.error_code = 'INVALID_RECIPIENT')`]
    const i = (q.bounced?.ids ?? []).slice(0, 500)
    const e = (q.bounced?.emails ?? []).slice(0, 500)
    if (i.length) {
      or.push(`m.external_id in (${i.map(() => "?").join(", ")})`)
      b.push(...i)
    }
    if (e.length) {
      or.push(`exists (select 1 from "notification" n5 where n5.id = m.notification_id and lower(n5."to") in (${e.map(() => "?").join(", ")}))`)
      b.push(...e)
    }
    parts.push(`(${or.join(" or ")})`)
  }
  if (q.template) {
    parts.push(`m.template = ?`)
    b.push(q.template)
  }
  if (q.orderId) {
    parts.push(`m.order_id = ?`)
    b.push(q.orderId)
  }
  if (q.since) {
    parts.push(`m.created_at >= ?`)
    b.push(q.since)
  }
  if (q.emailHash) {
    parts.push(`m.recipient_hash = ?`)
    b.push(q.emailHash)
  }
  if (q.customerId) {
    if (q.customerEmailHash) {
      parts.push(`(m.customer_id = ? or m.recipient_hash = ?)`)
      b.push(q.customerId, q.customerEmailHash)
    } else {
      parts.push(`m.customer_id = ?`)
      b.push(q.customerId)
    }
  }
  if (q.text) {
    const t = q.text.slice(0, 80)
    const like = `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    /* A plugin row keeps its address masked; the full one is on Medusa's notification it reports. */
    const addr = q.addresses ? ` or exists (select 1 from "notification" n4 where n4.id = m.notification_id and n4."to" ilike ?) or (m.kind = 'campaign' and m.recipient ilike ?)` : ""
    parts.push(`(m.subject ilike ? or m.template ilike ? or m.order_id = ? or m.resource_id = ?${addr})`)
    b.push(like, like, t, t, ...(q.addresses ? [like, like] : []))
  }
  return { sql: parts.join(" and "), bindings: b }
}

const OWN_SELECT = `'plugin' as source, m.id, m.key, m.template, m.locale, m.kind, m.status, m.recipient, m.subject, m.trigger,
  m.resource_type, m.resource_id, m.order_id, m.notification_id, m.customer_id, m.external_id, m.rotation, m.attempts, m.error_code, m.error,
  m.retryable, m.sent_at, m.requested_by, (m.body_html is not null) as has_body, m.created_at, m.updated_at, null::jsonb as data,
  (select n3."to" from "notification" n3 where n3.id = m.notification_id) as recipient_full`

const HISTORY_SELECT = `'medusa' as source, n.id, ('medusa:' || n.id) as key, n.template, n.data->>'locale' as locale, 'medusa' as kind, n.status,
  n."to" as recipient, null as subject, n.trigger_type as trigger, n.resource_type, n.resource_id, ${N_ORDER} as order_id, n.id as notification_id,
  n.receiver_id as customer_id, n.external_id, 0 as rotation, 1 as attempts, null as error_code, null as error, false as retryable,
  case when n.status = 'success' then n.updated_at end as sent_at, null as requested_by, false as has_body, n.created_at, n.updated_at,
  (n.data - array[${DROPPED_IN_SQL.map((k) => `'${k}'`).join(", ")}]::text[]) as data, n."to" as recipient_full`

/** Whether the plugin's own log table exists (it does not before db:migrate). */
export async function ownTableExists(pg: SqlRaw): Promise<boolean> {
  try {
    const r = await pg.raw(`select to_regclass('public.emails_message') is not null as ok`)
    return Boolean(r.rows?.[0]?.ok)
  } catch {
    return false
  }
}

/**
 * One page of the app mode log, newest first: the plugin's rows and Medusa's
 * history in one union, and their total.
 */
export async function listAppLog(
  pg: SqlRaw,
  q: HistoryQuery,
  subjectOf: (template: string, data: Record<string, unknown>, locale: string | null) => string | null,
): Promise<{ rows: Array<MessageRow & { source: "plugin" | "medusa" }>; count: number; ownTable: boolean }> {
  const ownTable = await ownTableExists(pg)
  const parts: string[] = []
  const bindings: unknown[] = []
  if (ownTable) {
    const w = ownWhere(q)
    parts.push(`select ${OWN_SELECT} from "emails_message" m where ${w.sql}`)
    bindings.push(...w.bindings)
  }
  const h = historyWhere(q, ownTable)
  if (h) {
    parts.push(`select ${HISTORY_SELECT} from "notification" n where ${h.sql}`)
    bindings.push(...h.bindings)
  }
  if (parts.length === 0) return { rows: [], count: 0, ownTable }
  const union = parts.join(" union all ")
  const page = await pg.raw(`select * from (${union}) u order by u.created_at desc, u.id desc limit ? offset ?`, [...bindings, q.limit, q.offset])
  const total = await pg.raw(`select count(*)::int as n from (${union}) u`, bindings)
  return {
    rows: (page.rows ?? []).map((r) => unionRowToMessage(r, subjectOf, q.addresses === true)),
    count: Number(total.rows?.[0]?.n ?? 0),
    ownTable,
  }
}

/** One history message by its notification id (`noti_...`), or null. */
export async function historyMessage(
  pg: SqlRaw,
  id: string,
  subjectOf: (template: string, data: Record<string, unknown>, locale: string | null) => string | null,
  showAddresses = false,
): Promise<(MessageRow & { source: "plugin" | "medusa" }) | null> {
  if (!/^noti_[A-Za-z0-9]+$/.test(id)) return null
  const r = await pg.raw(`select ${HISTORY_SELECT} from "notification" n where n.id = ? and n.channel = 'email' and n.deleted_at is null limit 1`, [id])
  const row = r.rows?.[0]
  return row ? unionRowToMessage(row, subjectOf, showAddresses) : null
}

export interface HistoryCounts {
  sent24h: number
  sent30d: number
  failed30d: number
  total: number
  firstAt: string | null
  byTemplate: Array<{ template: string; status: "sent" | "failed" | "sending"; count: number; last_at: Date | string | null }>
}

/** The board numbers of the history the plugin's own log does not cover. */
export async function historyCounts(pg: SqlRaw, now: Date, ownTable: boolean): Promise<HistoryCounts> {
  const not = ownTable ? `and not exists (select 1 from "emails_message" m2 where m2.notification_id = n.id and m2.deleted_at is null)` : ""
  const day = new Date(now.getTime() - 24 * 3600 * 1000)
  const month = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
  const c = await pg.raw(
    `select
       count(*) filter (where n.status = 'success' and n.created_at >= ?)::int as sent24h,
       count(*) filter (where n.status = 'success' and n.created_at >= ?)::int as sent30d,
       count(*) filter (where n.status = 'failure' and n.created_at >= ?)::int as failed30d,
       count(*)::int as total,
       min(n.created_at) as first_at
     from "notification" n where n.channel = 'email' and n.deleted_at is null ${not}`,
    [day, month, month],
  )
  const t = await pg.raw(
    `select n.template, n.status, count(*)::int as count, max(n.created_at) as last_at
     from "notification" n where n.channel = 'email' and n.deleted_at is null and n.created_at >= ? ${not}
     group by n.template, n.status`,
    [month],
  )
  const row = c.rows?.[0] ?? {}
  const first = row.first_at ? new Date(row.first_at as string) : null
  return {
    sent24h: Number(row.sent24h ?? 0),
    sent30d: Number(row.sent30d ?? 0),
    failed30d: Number(row.failed30d ?? 0),
    total: Number(row.total ?? 0),
    firstAt: first && !Number.isNaN(first.getTime()) ? first.toISOString() : null,
    byTemplate: (t.rows ?? []).map((r) => ({ template: String(r.template), status: historyStatus(r.status), count: Number(r.count ?? 0), last_at: (r.last_at as Date | string | null) ?? null })),
  }
}

/** The latest history message to each address (lower-cased), for the list of suppressed addresses. */
export async function lastHistoryByAddress(
  pg: SqlRaw,
  emails: string[],
  subjectOf: (template: string, data: Record<string, unknown>, locale: string | null) => string | null,
  showAddresses = false,
): Promise<Map<string, MessageRow & { source: "plugin" | "medusa" }>> {
  const out = new Map<string, MessageRow & { source: "plugin" | "medusa" }>()
  const list = [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, 500)
  if (!list.length) return out
  const r = await pg.raw(
    `select distinct on (lower(n."to")) lower(n."to") as addr, ${HISTORY_SELECT}
     from "notification" n
     where n.channel = 'email' and n.deleted_at is null and lower(n."to") in (${list.map(() => "?").join(", ")})
     order by lower(n."to"), n.created_at desc`,
    list,
  )
  for (const row of r.rows ?? []) out.set(String(row.addr), unionRowToMessage(row, subjectOf, showAddresses))
  return out
}
