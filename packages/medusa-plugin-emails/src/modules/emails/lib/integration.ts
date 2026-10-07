import { BOARD_WINDOW_DAYS } from "./constants"
import type { CounterDraft, MessageDraft, SummaryDraft } from "./kit-routes"
import type { BoardCounts, SummaryRow } from "./store"

/**
 * E-mails in the koda.integration/1 contract, as pure functions over the
 * plugin's own send log (testable without a database): one line per order
 * and per customer, and the board counters.
 *
 * Every message of the record counts and the worst one speaks: red (a
 * message that failed), orange (one that may not have gone out, an address
 * refused: a person looks), blue (one being sent), green (sent). Messages
 * that were skipped on purpose (a template switched off, no API key) only
 * speak when there is nothing else. Test sends never count. Nothing comes
 * from order or cart metadata: the rows are the plugin's record of what it
 * sent. The plugin reads no bounce webhooks of Resend, so "bounced" means
 * an address Resend (or the plugin) refused when the message was sent.
 */

export interface SummaryContext {
  demo: boolean
  /** The name of a template in the answer's language. */
  label: (template: string) => string
  /** A date and time in the answer's language and time zone. */
  when: (value: string | Date) => string
}

type Entity = "order" | "customer"

type Line = { state: SummaryDraft["state"]; rank: number; title: MessageDraft; row: SummaryRow }

/* Within orange, an address refused for sure comes before a message that may still have gone out. */
const RANK = { failed: 0, refused: 1, attention: 1.5, active: 2, ok: 3, none: 4 } as const

function at(row: Pick<SummaryRow, "sent_at" | "updated_at" | "created_at">): number {
  for (const v of [row.sent_at, row.updated_at, row.created_at]) {
    if (!v) continue
    const t = new Date(v).getTime()
    if (Number.isFinite(t)) return t
  }
  return 0
}

/** One message as a line of the card: its state, title and rank (lower is worse). */
export function messageLine(row: SummaryRow, entity: Entity, ctx: Pick<SummaryContext, "label">): Line {
  const t = (key: string): MessageDraft => ({ key: `integration.${entity}.${key}`, params: { template: ctx.label(row.template) } })
  switch (row.status) {
    case "failed":
      if (entity === "customer" && row.error_code === "INVALID_RECIPIENT") return { state: "attention", rank: RANK.refused, title: t("addressRefused"), row }
      return { state: "failed", rank: RANK.failed, title: t("failed"), row }
    case "unknown":
      return { state: "attention", rank: RANK.attention, title: t("unknown"), row }
    case "sending":
      return { state: "active", rank: RANK.active, title: t("sending"), row }
    case "sent":
      return { state: "ok", rank: RANK.ok, title: { key: `integration.${entity}.sent`, params: { count: 1 } }, row }
  }
  if (row.error_code === "TEMPLATE_OFF") return { state: "none", rank: RANK.none, title: t("skippedOff"), row }
  if (row.error_code === "NO_API_KEY") return { state: "none", rank: RANK.none, title: t("skippedNoKey"), row }
  if (entity === "customer" && row.error_code === "THROTTLED") return { state: "none", rank: RANK.none, title: t("throttled"), row }
  return { state: "none", rank: RANK.none, title: t("skipped"), row }
}

/**
 * The line of one record from its messages (current mode, tests left out,
 * newest first). Undefined without messages: the record answers "none".
 */
export function recordSummary(rows: readonly SummaryRow[], entity: Entity, id: string, ctx: SummaryContext): SummaryDraft | undefined {
  if (rows.length === 0) return undefined
  const newest = [...rows].sort((a, b) => at(b) - at(a))
  const lines = newest.map((r) => messageLine(r, entity, ctx))
  /* The worst line, the newest among equals. */
  const worst = [...lines].sort((a, b) => a.rank - b.rank || at(b.row) - at(a.row))[0]
  const counts = {
    total: rows.length,
    sent: rows.filter((r) => r.status === "sent").length,
    failed: rows.filter((r) => r.status === "failed").length,
    unknown: rows.filter((r) => r.status === "unknown").length,
    sending: rows.filter((r) => r.status === "sending").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
  }
  const key = (k: string, params?: Record<string, string | number>): MessageDraft => ({ key: `integration.${entity}.${k}`, ...(params ? { params } : {}) })
  const latestSent = lines.find((l) => l.state === "ok")
  const others = lines.filter((l) => l !== worst && l.rank <= RANK.attention).length

  let title = worst.title
  let detail: MessageDraft | undefined
  if (worst.state === "ok") {
    title = key(ctx.demo ? "simulated" : "sent", { count: counts.sent })
    detail = key("latest", { template: ctx.label(worst.row.template), when: ctx.when(new Date(at(worst.row))) })
  } else if (others > 0) {
    detail = key("more", { count: others })
  } else if (worst.state === "attention") {
    detail = key(worst.row.error_code === "INVALID_RECIPIENT" ? "checkAddress" : "checkResend")
  } else if (latestSent) {
    detail = key("latest", { template: ctx.label(latestSent.row.template), when: ctx.when(new Date(at(latestSent.row))) })
  }
  if (ctx.demo && worst.state !== "ok" && !detail) detail = key("demo")

  const href = entity === "order" ? `/emails?order_id=${encodeURIComponent(id)}` : `/emails?customer_id=${encodeURIComponent(id)}`
  return {
    state: worst.state,
    title,
    ...(detail ? { detail } : {}),
    facts: [],
    counts,
    links: [{ kind: "admin", href }],
    widget: entity === "order" ? "emails.order" : null,
    updatedAt: new Date(at(newest[0])),
  }
}

/** The link of a counter: the plugin page with the filter and the window it counts. */
export const COUNTER_LINKS = {
  messages_failed: `/emails?filter=attention&since=${BOARD_WINDOW_DAYS}d`,
  bounced: `/emails?filter=bounced&since=${BOARD_WINDOW_DAYS}d`,
} as const

/** Board counters from one grouped count of the current mode over the last `BOARD_WINDOW_DAYS` days. */
export function emailsCounters(c: BoardCounts): CounterDraft[] {
  return [
    { key: "messages_failed", scope: "orders", count: c.orderFailed, tone: "red", link: { kind: "admin", href: COUNTER_LINKS.messages_failed }, entity: "order" },
    { key: "bounced", scope: "customers", count: c.refusedAddresses, tone: "orange", link: { kind: "admin", href: COUNTER_LINKS.bounced }, entity: "customer" },
  ]
}
