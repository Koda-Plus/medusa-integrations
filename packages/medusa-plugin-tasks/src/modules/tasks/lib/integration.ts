import { CLOSED_STATUSES, OPEN_STATUSES, type LinkType } from "./constants"
import type { CounterDraft, SummaryDraft } from "./kit-routes"
import { utcDay } from "./dates"
import { taskSample } from "./dto"
import { PRIORITY_RANK, normalizePriority, normalizeStatus } from "./status"

/**
 * Tasks in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows (testable without a database): one line per order,
 * product or customer with linked tasks, and the board counters.
 *
 * The worst task speaks: red when an open task is past its due day, orange
 * when one is due today or waits in review for a person to check it, blue
 * while tasks are open, green when every linked task is closed. A record
 * without linked tasks has no line (state none). Nothing comes from order,
 * cart or customer metadata: the rows are the plugin's tables, read on the
 * board of the person or key asking. No facts: tasks are not a fact about an
 * order, they are work about it.
 */

export type RecordType = Extract<LinkType, "order" | "product" | "customer">

/** What the summary needs of a linked task. */
export interface LinkedTask {
  id: string
  title: string
  status: string
  priority: string
  due_date: Date | string | null
  updated_at: Date | string
  metadata?: unknown
}

export const WIDGET_OF: Record<RecordType, string> = { order: "tasks.order", product: "tasks.product", customer: "tasks.customer" }

/** The board page with only the tasks linked to this record. */
export function recordHref(type: RecordType, id: string): string {
  return `/tasks?record=${encodeURIComponent(`${type}:${id}`)}`
}

/* Unknown statuses of old rows read as backlog, as everywhere else. */
const isOpen = (status: string) => (OPEN_STATUSES as readonly string[]).includes(normalizeStatus(status))
const isClosed = (status: string) => (CLOSED_STATUSES as readonly string[]).includes(normalizeStatus(status))
const time = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : 0)

/** The task's title in `lang` (sample tasks of the sandbox carry both languages). */
export function titleIn(task: Pick<LinkedTask, "title" | "metadata">, lang: string): string {
  const sample = taskSample(task.metadata)?.title
  const text = lang === "pl" ? sample?.pl || sample?.en : sample?.en || sample?.pl
  return (text || task.title).slice(0, 120)
}

/**
 * The line of one record from its linked tasks and the request's day
 * (`today`, YYYY-MM-DD in the request's time zone). Undefined when no task
 * is linked.
 */
export function recordSummary(type: RecordType, id: string, tasks: readonly LinkedTask[], today: string, lang: string): SummaryDraft | undefined {
  if (tasks.length === 0) return undefined
  const open = tasks.filter((t) => isOpen(t.status))
  const day = (t: LinkedTask) => utcDay(t.due_date)
  const overdue = open.filter((t) => {
    const d = day(t)
    return d !== null && d < today
  })
  const dueToday = open.filter((t) => day(t) === today)
  const review = open.filter((t) => normalizeStatus(t.status) === "review")
  const counts = {
    linked: tasks.length,
    open: open.length,
    overdue: overdue.length,
    due_today: dueToday.length,
    review: review.length,
    done: tasks.filter((t) => t.status === "done").length,
    rejected: tasks.filter((t) => t.status === "rejected").length,
  }
  const links = [{ kind: "admin" as const, href: recordHref(type, id) }]
  const widget = WIDGET_OF[type]
  const updatedAt = new Date(Math.max(...tasks.map((t) => time(t.updated_at))) || 0)
  /* The most urgent open task: earliest due day first, then priority, then the oldest change. */
  const urgent = [...open].sort(
    (a, b) =>
      (day(a) ?? "9999").localeCompare(day(b) ?? "9999") ||
      PRIORITY_RANK[normalizePriority(a.priority)] - PRIORITY_RANK[normalizePriority(b.priority)] ||
      time(a.updated_at) - time(b.updated_at),
  )
  const top = (pool: readonly LinkedTask[]) => {
    const first = urgent.find((t) => pool.includes(t))
    return first ? { key: "integration.record.top", params: { title: titleIn(first, lang) } } : undefined
  }
  const base = { counts, links, widget, updatedAt: updatedAt.getTime() > 0 ? updatedAt : null }

  if (overdue.length > 0) return { ...base, state: "failed", title: { key: "integration.record.overdue", params: { count: overdue.length } }, detail: top(overdue) }
  if (dueToday.length > 0) return { ...base, state: "attention", title: { key: "integration.record.dueToday", params: { count: dueToday.length } }, detail: top(dueToday) }
  if (review.length > 0) return { ...base, state: "attention", title: { key: "integration.record.review", params: { count: review.length } }, detail: top(review) }
  if (open.length > 0) return { ...base, state: "active", title: { key: "integration.record.open", params: { count: open.length } }, detail: top(open) }
  const latest = tasks.filter((t) => isClosed(t.status)).sort((a, b) => time(b.updated_at) - time(a.updated_at))[0]
  return {
    ...base,
    state: "ok",
    title: { key: "integration.record.allDone", params: { count: tasks.length } },
    ...(latest ? { detail: { key: "integration.record.latest", params: { title: titleIn(latest, lang) } } } : {}),
  }
}

/** The counts behind the board counters, from two grouped counts on the board of the person asking. */
export interface AttentionCounts {
  overdueOrders: number
  overdueProducts: number
  overdueCustomers: number
  unassigned: number
  mine: number
}

/** Board counters, each linking to the Tasks page with the same filter. */
export function tasksCounters(c: AttentionCounts): CounterDraft[] {
  return [
    { key: "overdue_orders", scope: "orders", count: c.overdueOrders, tone: "orange", link: { kind: "admin", href: "/tasks?quick=overdue&record_type=order" }, entity: "order" },
    { key: "overdue_products", scope: "products", count: c.overdueProducts, tone: "orange", link: { kind: "admin", href: "/tasks?quick=overdue&record_type=product" }, entity: "product" },
    { key: "overdue_customers", scope: "customers", count: c.overdueCustomers, tone: "orange", link: { kind: "admin", href: "/tasks?quick=overdue&record_type=customer" }, entity: "customer" },
    { key: "unassigned", scope: "integration", count: c.unassigned, tone: "blue", link: { kind: "admin", href: "/tasks?quick=unassigned" } },
    { key: "mine", scope: "integration", count: c.mine, tone: "blue", link: { kind: "admin", href: "/tasks?quick=mine" } },
  ]
}

/** The calendar day in an IANA time zone, YYYY-MM-DD (UTC when the zone is unknown). */
export function dayIn(tz: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
    const day = `${get("year")}-${get("month")}-${get("day")}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
  } catch {
    /* unknown zone */
  }
  return now.toISOString().slice(0, 10)
}
