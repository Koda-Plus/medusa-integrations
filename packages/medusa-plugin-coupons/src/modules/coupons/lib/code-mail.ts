/**
 * E-mails of a coupon's code, deleting an unused coupon and the plain
 * counter of uses. Pure: no Medusa imports, so the routes, the admin and the
 * tests agree.
 *
 * Who got the code lives in the promotion's metadata under `code_sent` (a
 * list of { customer_id, email, at, by }); a second send to the same person
 * never happens, the store's adapter adds an idempotency key on top.
 */
import type { CodeSentEntry, CouponDto } from "./contract"

export const CODE_SENT_KEY = "code_sent"

/** The instruction in the e-mail: a few sentences at most. */
export const MESSAGE_MAX = 1000

/** At most this many people in one send. */
export const RECIPIENTS_MAX = 200

const ID = /^[A-Za-z0-9_-]{1,80}$/

/** The `code_sent` list of a promotion's metadata, broken rows left out. */
export function codeSentOf(metadata: unknown): CodeSentEntry[] {
  const raw = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>)[CODE_SENT_KEY] : null
  if (!Array.isArray(raw)) return []
  const out: CodeSentEntry[] = []
  for (const r of raw) {
    if (!r || typeof r !== "object") continue
    const x = r as Record<string, unknown>
    const id = typeof x.customer_id === "string" ? x.customer_id : ""
    if (!id) continue
    out.push({
      customer_id: id,
      email: typeof x.email === "string" ? x.email : "",
      at: typeof x.at === "string" ? x.at : "",
      by: typeof x.by === "string" && x.by ? x.by : null,
    })
  }
  return out
}

/** The metadata with the new sends appended (other keys kept, one row per person). */
export function withSent(metadata: unknown, entries: readonly CodeSentEntry[]): Record<string, unknown> {
  const base = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...(metadata as Record<string, unknown>) } : {}
  const prev = codeSentOf(base)
  const have = new Set(prev.map((e) => e.customer_id))
  const next = [...prev, ...entries.filter((e) => !have.has(e.customer_id))]
  return { ...base, [CODE_SENT_KEY]: next }
}

/** The instruction checked: trimmed, never empty, at most MESSAGE_MAX characters. */
export function cleanMessage(raw: unknown): { ok: boolean; value: string; error: string | null } {
  const value = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : ""
  if (!value) return { ok: false, value, error: "message" }
  if (value.length > MESSAGE_MAX) return { ok: false, value, error: "message_long" }
  return { ok: true, value, error: null }
}

/** Customer ids from a request: valid ones, once each, at most RECIPIENTS_MAX. */
export function cleanIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  return [...new Set(list.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, RECIPIENTS_MAX)
}

/**
 * Why the code cannot go out now: no code to type (automatic), no sender in
 * the store, or the coupon does not work (ended, used up, paused).
 */
export function sendBlockers(c: Pick<CouponDto, "automatic" | "code" | "status">, canSend: boolean): string[] {
  const out: string[] = []
  if (!canSend) out.push("no_sender")
  if (c.automatic || !c.code) out.push("automatic")
  if (c.status === "expired" || c.status === "used_up") out.push("ended")
  if (c.status === "paused" || c.status === "draft") out.push("paused")
  return out
}

/**
 * Who gets the e-mail now: everyone asked for who did not get it before.
 * When the coupon has a customer rule, the new people who are not on it are
 * added first, so the code works for them; the store's "nobody" marker is
 * dropped then. A coupon without a customer rule (for everyone, for groups)
 * is never narrowed to the people it is sent to.
 */
export function planSend(input: { requested: readonly string[]; sent: readonly CodeSentEntry[]; ruleIds: readonly string[]; nobody: string | null }): {
  toSend: string[]
  skipped: string[]
  addToRule: string[]
  ruleAfter: string[] | null
} {
  const had = new Set(input.sent.map((e) => e.customer_id))
  const requested = [...new Set(input.requested)].filter((id) => id !== input.nobody)
  const toSend = requested.filter((id) => !had.has(id))
  const skipped = requested.filter((id) => had.has(id))
  const hasRule = input.ruleIds.length > 0
  const real = input.ruleIds.filter((id) => id !== input.nobody)
  const addToRule = hasRule ? toSend.filter((id) => !real.includes(id)) : []
  return { toSend, skipped, addToRule, ruleAfter: addToRule.length ? [...real, ...addToRule] : null }
}

/** A coupon may be deleted when nobody used it: no use counted by Medusa, no order with it (canceled ones too). */
export function deleteBlockers(input: { used: number; orders: number }): string[] {
  return input.used > 0 || input.orders > 0 ? ["used"] : []
}

/** The admin's guess from the list (orders there leave canceled ones out; the server checks those too). */
export function looksDeletable(c: Pick<CouponDto, "used" | "stats">): boolean {
  return c.used === 0 && c.stats.orders === 0
}

/**
 * The counter of uses in plain parts: how many so far, the limit for all
 * customers together, the orders each customer may place with it, and how
 * many customers it is for. The admin says them in words.
 */
export function usageOf(c: Pick<CouponDto, "used" | "limit" | "terms" | "shape">, nobody: string | null | undefined): {
  used: number
  limit: number | null
  perCustomer: number | null
  customers: number
} {
  const perCustomer = c.terms?.perCustomerOrders && c.terms.perCustomerOrders > 0 ? c.terms.perCustomerOrders : null
  return { used: c.used, limit: c.limit, perCustomer, customers: c.shape.customerIds.filter((id) => id !== nobody).length }
}
