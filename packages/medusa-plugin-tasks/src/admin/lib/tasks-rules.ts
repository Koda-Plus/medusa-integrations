import { isLinkType, type LinkType } from "../../modules/tasks/lib/constants"
import { isOverdue } from "../../modules/tasks/lib/dates"
import { personKey } from "../../modules/tasks/lib/people"
import { planMove } from "../../modules/tasks/lib/positions"
import type { BoardResponse, TaskDto } from "../../modules/tasks/lib/contract"

/*
 * Pure rules of the admin (no React, no fetch), tested with `node --test`:
 * the filters and their URL (deep links), the board after a move, the due
 * date the drawer sends, the photos it shows.
 */

/* ------------------------------------------------------------------ */
/* Filters, kept in the URL                                            */
/* ------------------------------------------------------------------ */

export const QUICK_FILTERS = ["none", "overdue", "due_today", "urgent", "unassigned", "mine", "open", "review"] as const
export type QuickFilter = (typeof QUICK_FILTERS)[number]

export interface BoardFilters {
  q: string
  /** `all`, `none` (unassigned), `me`, `user:<id>` or `text:<name>`. */
  assignee: string
  tag: string
  priority: string
  quick: QuickFilter
  /** `order:<id>`, `product:<id>` or `customer:<id>`: tasks linked to that record. */
  record: string | null
  /** Tasks linked to any record of the type. */
  recordType: LinkType | null
}

export const NO_FILTERS: BoardFilters = { q: "", assignee: "all", tag: "all", priority: "all", quick: "none", record: null, recordType: null }

export function filtered(f: BoardFilters): boolean {
  return f.q.trim() !== "" || f.assignee !== "all" || f.tag !== "all" || f.priority !== "all" || f.quick !== "none" || f.record !== null || f.recordType !== null
}

const PRIORITY_VALUES = ["low", "medium", "high", "urgent"]
const RECORD = /^(order|product|customer):[A-Za-z0-9_-]{1,100}$/

/**
 * The filters a URL names: `quick` (overdue, due_today, urgent, unassigned,
 * mine, open, review), `assignee` (me, none, user:<id>, text:<name>), `tag`,
 * `priority`, `q`, `record` (order:<id>...) and `record_type`. Anything
 * unknown is ignored.
 */
export function filtersFromParams(params: URLSearchParams): BoardFilters {
  const quick = params.get("quick") ?? ""
  const assignee = (params.get("assignee") ?? "").trim().slice(0, 120)
  const priority = params.get("priority") ?? ""
  const record = params.get("record") ?? ""
  const recordType = params.get("record_type") ?? ""
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    assignee: assignee === "me" || assignee === "none" || /^(user|text):.+/.test(assignee) ? assignee : "all",
    tag: (params.get("tag") ?? "").trim().slice(0, 32) || "all",
    priority: PRIORITY_VALUES.includes(priority) ? priority : "all",
    quick: (QUICK_FILTERS as readonly string[]).includes(quick) ? (quick as QuickFilter) : "none",
    record: RECORD.test(record) ? record : null,
    recordType: isLinkType(recordType) ? recordType : null,
  }
}

/** The URL of the filters, keeping every other parameter (`task`, `view`, `new`...). */
export function filtersToParams(f: BoardFilters, base: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base)
  const set = (k: string, v: string | null, empty: string | null = null) => (v === null || v === empty || v === "" ? p.delete(k) : p.set(k, v))
  set("q", f.q)
  set("assignee", f.assignee, "all")
  set("tag", f.tag, "all")
  set("priority", f.priority, "all")
  set("quick", f.quick, "none")
  set("record", f.record)
  set("record_type", f.recordType)
  return p
}

export function assigneeKey(t: Pick<TaskDto, "assignee" | "assignee_id">): string {
  if (t.assignee_id) return `user:${t.assignee_id}`
  const name = personKey(t.assignee ?? "")
  return name ? `text:${name}` : "none"
}

const isOpenTask = (t: Pick<TaskDto, "status">) => t.status !== "done" && t.status !== "rejected"
const unassignedTask = (t: Pick<TaskDto, "assignee" | "assignee_id">) => !t.assignee_id && !(t.assignee ?? "").trim()
const sampleTitle = (t: Pick<TaskDto, "title" | "sample">, lang: string) => {
  const s = t.sample?.title
  return (lang.toLowerCase().startsWith("pl") ? s?.pl || s?.en : s?.en || s?.pl) || t.title
}

/** The tasks the filters keep. `viewerId` is the admin user asking (`me`, `mine`). */
export function applyFilters(tasks: TaskDto[], f: BoardFilters, today: string, lang: string, viewerId: string | null = null): TaskDto[] {
  const q = f.q.trim().toLowerCase()
  const assignee = f.assignee === "me" ? (viewerId ? `user:${viewerId}` : "user:") : f.assignee
  const [recordType, recordId] = f.record ? [f.record.slice(0, f.record.indexOf(":")), f.record.slice(f.record.indexOf(":") + 1)] : [null, null]
  return tasks.filter((t) => {
    if (f.quick === "overdue" && !isOverdue(t, today)) return false
    if (f.quick === "due_today" && !(isOpenTask(t) && (t.due_date ?? "").slice(0, 10) === today)) return false
    if (f.quick === "urgent" && !(isOpenTask(t) && (t.priority === "urgent" || t.priority === "high"))) return false
    if (f.quick === "unassigned" && !(isOpenTask(t) && unassignedTask(t))) return false
    if (f.quick === "mine" && !(isOpenTask(t) && viewerId !== null && t.assignee_id === viewerId)) return false
    if (f.quick === "open" && !isOpenTask(t)) return false
    if (f.quick === "review" && t.status !== "review") return false
    if (assignee !== "all" && assigneeKey(t) !== assignee) return false
    if (f.tag !== "all" && !t.tags.some((tag) => tag.toLowerCase() === f.tag.toLowerCase())) return false
    if (f.priority !== "all" && t.priority !== f.priority) return false
    if (recordType && !t.links.some((l) => l.type === recordType && l.entity_id === recordId)) return false
    if (f.recordType && !t.links.some((l) => l.type === f.recordType)) return false
    if (q) {
      const hay = `${sampleTitle(t, lang)} ${t.title} ${t.description ?? ""} ${t.assignee ?? ""} ${t.tags.join(" ")} ${t.links.map((l) => l.label ?? "").join(" ")}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export interface MoveArgs {
  id: string
  status: TaskDto["status"]
  before_id: string | null
  after_id: string | null
}

const CLOSED = new Set<string>(["done", "rejected"])

/** The board after a move, the way the server will order it: the card placed, both columns numbered again. */
export function moveOnBoard(board: BoardResponse, m: MoveArgs): BoardResponse {
  const moving = board.tasks.find((t) => t.id === m.id)
  if (!moving) return board
  const from = moving.status
  const column = (status: string) =>
    board.tasks
      .filter((t) => t.status === status && t.id !== m.id)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((t) => t.id)
  /* Closed columns are ordered by when tasks closed: nothing to number there. */
  const dest = CLOSED.has(m.status) ? [] : planMove(column(m.status), m.id, { afterId: m.after_id, beforeId: m.before_id })
  const left = from === m.status || CLOSED.has(from) ? [] : column(from)
  const position = new Map<string, number>()
  dest.forEach((id, i) => position.set(id, i))
  left.forEach((id, i) => position.set(id, i))
  const tasks = board.tasks.map((t) => {
    const p = position.get(t.id)
    if (t.id === m.id) {
      const completed = CLOSED.has(m.status) ? (CLOSED.has(from) ? t.completed_at : new Date().toISOString()) : null
      return { ...t, status: m.status, position: p ?? 0, completed_at: completed, updated_at: new Date().toISOString() }
    }
    return p === undefined ? t : { ...t, position: p }
  })
  return { ...board, tasks }
}


/** A whole date with a year the server takes (2000 to 2100). Typing a year passes through 0002, 0020 and 0202. */
export function completeDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= 2000 && year <= 2100
}

/** A photo the admin shows: https or an image data URI, nothing else (an avatar_url is any text an admin typed). */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null
  const u = url.trim()
  if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return u
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(u)) return u
  return null
}

/**
 * The dictionary keys that say what went wrong, most precise first: the
 * field's own code (`errors.fields.other_board`), then the refusal's
 * (`errors.sandbox_busy`). The admin shows the first one it has.
 */
export function errorKeys(code: string | null, fieldCode: string | null): string[] {
  const keys: string[] = []
  if (fieldCode && /^[a-z_]{1,40}$/.test(fieldCode)) keys.push(`errors.fields.${fieldCode}`)
  if (code && /^[a-z_]{1,40}$/.test(code)) keys.push(`errors.${code}`)
  return keys
}
