/**
 * Test doubles shared by the flow tests (not a test itself: the runner picks
 * up `*.test.ts` only).
 *
 *   memoryStores  the board, settings and sandbox stores with the SAME rules
 *                 as the SQL ones: every board store sees only its board,
 *                 comments, links and activity only for tasks of the board,
 *                 positions numbered per column, soft deletes
 *   setup         a fake Medusa container (module service, Query, the user
 *                 and API key modules, the event bus, the stores) around one
 *                 set of options
 *   recorder      a SqlRunner that records every statement with its bindings
 */
import { CLOSED_STATUSES, OPEN_STATUSES, SANDBOX_BOARD, STATUSES, URGENT_PRIORITIES, type Board } from "../src/modules/tasks/lib/constants.ts"
import { resolveOptions, type TasksPluginOptions } from "../src/modules/tasks/lib/options.ts"
import { nextPosition, planMove, positionChanges } from "../src/modules/tasks/lib/positions.ts"
import type { ActivityRow, CommentRow, LinkRow, SettingRow, TaskRow } from "../src/modules/tasks/lib/rows.ts"
import type { BoardStore, SandboxStore, SettingStore, SqlRunner, TaskQuery } from "../src/modules/tasks/lib/store.ts"
import { STORES_KEY, type Stores } from "../src/workflows/tasks/runtime.ts"
import { forgetProfiles } from "../src/workflows/tasks/context.ts"

export type Row = Record<string, any>

const time = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime())
const copy = <T extends Row>(r: T): T => {
  const out: Row = {}
  for (const [k, v] of Object.entries(r)) out[k] = v instanceof Date ? new Date(v.getTime()) : v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v
  return out as T
}
const statusOrder = (s: string) => Math.max(0, (STATUSES as readonly string[]).indexOf(s))
const byColumn = (a: TaskRow, b: TaskRow) => a.position - b.position || time(a.created_at) - time(b.created_at) || (a.id < b.id ? -1 : 1)

export interface Memory {
  tasks: Map<string, TaskRow>
  comments: Map<string, CommentRow>
  activity: Map<string, ActivityRow>
  links: Map<string, LinkRow>
  settings: Map<string, SettingRow>
  stores: Stores
  /** Every board store handed out, by board: the isolation tests check nobody asked for another one. */
  boardsAsked: Board[]
}

export function memoryStores(): Memory {
  const tasks = new Map<string, TaskRow>()
  const comments = new Map<string, CommentRow>()
  const activity = new Map<string, ActivityRow>()
  const links = new Map<string, LinkRow>()
  const settings = new Map<string, SettingRow>()
  const boardsAsked: Board[] = []

  const live = <T extends { deleted_at: unknown }>(r: T | undefined): r is T => Boolean(r) && !(r as T).deleted_at

  function boardStore(board: string): BoardStore {
    const onBoard = (r: { board: string; deleted_at: unknown } | undefined) => live(r) && r.board === board
    const task = (id: string) => {
      const t = tasks.get(id)
      return onBoard(t) ? (t as TaskRow) : null
    }
    const column = (status: string, except: string) => [...tasks.values()].filter((t) => onBoard(t) && t.status === status && t.id !== except).sort(byColumn)
    const renumber = (rows: TaskRow[]) => {
      for (const c of positionChanges(rows, rows.map((r) => r.id))) (tasks.get(c.id) as TaskRow).position = c.position
    }
    const addActivity = (rows: readonly Row[]) => {
      for (const a of rows) activity.set(a.id, { ...a, board, updated_at: a.created_at, deleted_at: null } as ActivityRow)
    }
    const matches = (t: TaskRow, q: TaskQuery) => {
      if (!onBoard(t)) return false
      if (q.statuses?.length && !q.statuses.includes(t.status)) return false
      if (q.priorities?.length && !q.priorities.includes(t.priority)) return false
      if (q.assigneeId && t.assignee_id !== q.assigneeId) return false
      if (q.assignee && (t.assignee ?? "").toLowerCase() !== q.assignee.toLowerCase()) return false
      if (q.unassigned && (t.assignee_id || (t.assignee ?? "").trim())) return false
      if (q.tag && !(Array.isArray(t.tags) && (t.tags as string[]).includes(q.tag))) return false
      if (q.like) {
        const needle = q.like.slice(1, -1).replace(/\\(.)/g, "$1").toLowerCase()
        if (![t.title, t.description ?? "", t.assignee ?? ""].some((s) => s.toLowerCase().includes(needle))) return false
      }
      if (q.link && ![...links.values()].some((l) => onBoard(l) && l.task_id === t.id && l.entity_type === q.link?.type && l.entity_id === q.link?.id)) return false
      return true
    }

    return {
      board,
      async boardTasks(openLimit, closedLimit) {
        const all = [...tasks.values()].filter((t) => onBoard(t))
        const open = all
          .filter((t) => !(CLOSED_STATUSES as readonly string[]).includes(t.status))
          .sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || byColumn(a, b))
          .slice(0, openLimit)
        const closed = CLOSED_STATUSES.flatMap((s) =>
          all
            .filter((t) => t.status === s)
            .sort((a, b) => time(b.completed_at ?? b.updated_at) - time(a.completed_at ?? a.updated_at) || (a.id < b.id ? 1 : -1))
            .slice(0, closedLimit),
        )
        return [...open, ...closed].map(copy)
      },
      async listTasks(q) {
        const rows = [...tasks.values()].filter((t) => matches(t, q)).sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || byColumn(a, b))
        return { rows: rows.slice(q.offset, q.offset + q.limit).map(copy), count: rows.length }
      },
      async statusCounts(dayStart) {
        const out = new Map<string, { status: string; count: number; overdue: number; urgent: number; unassigned: number }>()
        for (const t of tasks.values()) {
          if (!onBoard(t)) continue
          const r = out.get(t.status) ?? { status: t.status, count: 0, overdue: 0, urgent: 0, unassigned: 0 }
          const open = (OPEN_STATUSES as readonly string[]).includes(t.status)
          r.count += 1
          if (open && t.due_date && time(t.due_date) < dayStart.getTime()) r.overdue += 1
          if (open && (URGENT_PRIORITIES as readonly string[]).includes(t.priority)) r.urgent += 1
          if (open && !t.assignee_id && !(t.assignee ?? "").trim()) r.unassigned += 1
          out.set(t.status, r)
        }
        return [...out.values()]
      },
      async getTask(id) {
        const t = task(id)
        return t ? copy(t) : null
      },
      async commentCounts(ids) {
        const out = new Map<string, number>()
        for (const c of comments.values()) if (onBoard(c) && ids.includes(c.task_id)) out.set(c.task_id, (out.get(c.task_id) ?? 0) + 1)
        return out
      },
      async insertTask(t, newLinks, newActivity) {
        const position = typeof t.position === "number" ? t.position : nextPosition(column(t.status, t.id).map((r) => r.position))
        const row = { ...t, board, position, updated_at: t.updated_at ?? t.created_at, deleted_at: null } as unknown as TaskRow
        tasks.set(row.id, row)
        const linkRows = newLinks.map((l) => ({ ...l, board, task_id: row.id, updated_at: l.created_at, deleted_at: null }) as LinkRow)
        for (const l of linkRows) links.set(l.id, l)
        addActivity(newActivity)
        return { task: copy(row), links: linkRows.map(copy) }
      },
      async updateTask(id, plan, now) {
        const current = task(id)
        if (!current) return null
        const before = copy(current)
        const p = plan(copy(current))
        if (!p) return { before, after: before }
        const statusChanged = typeof p.patch.status === "string" && p.patch.status !== before.status
        if (Object.keys(p.patch).length > 0) {
          if (statusChanged) current.position = nextPosition(column(p.patch.status as string, id).map((r) => r.position))
          Object.assign(current, p.patch, { updated_at: now })
          if (statusChanged) renumber(column(before.status, id))
        }
        addActivity(p.activity)
        return { before, after: copy(current) }
      },
      async moveTask(id, target, plan, now) {
        const current = task(id)
        if (!current) return null
        const before = copy(current)
        const p = plan(copy(current))
        const dest = column(target.status, id)
        const order = planMove(
          dest.map((r) => r.id),
          id,
          { afterId: target.afterId, beforeId: target.beforeId },
        )
        for (const c of positionChanges(dest, order)) if (c.id !== id) (tasks.get(c.id) as TaskRow).position = c.position
        const statusChanged = target.status !== before.status
        Object.assign(current, p.patch, { status: target.status, position: order.indexOf(id) }, statusChanged ? { updated_at: now } : {})
        if (statusChanged) renumber(column(before.status, id))
        addActivity(p.activity)
        return { before, after: copy(current) }
      },
      async deleteTask(id, newActivity, now) {
        const current = task(id)
        if (!current) return null
        current.deleted_at = now
        current.updated_at = now
        for (const m of [comments, links, activity] as Array<Map<string, Row>>) for (const r of m.values()) if (r.task_id === id && r.board === board && !r.deleted_at) r.deleted_at = now
        addActivity(newActivity)
        renumber(column(current.status, id))
        return copy(current)
      },
      async listComments(taskId) {
        return [...comments.values()].filter((c) => onBoard(c) && c.task_id === taskId).sort((a, b) => time(a.created_at) - time(b.created_at)).map(copy)
      },
      async getComment(id) {
        const c = comments.get(id)
        return onBoard(c) ? copy(c as CommentRow) : null
      },
      async insertComment(c, newActivity) {
        if (!task(c.task_id)) return null
        const row = { ...c, board, edited_at: null, updated_at: c.created_at, deleted_at: null } as CommentRow
        comments.set(row.id, row)
        addActivity(newActivity)
        return copy(row)
      },
      async updateComment(id, body, now) {
        const c = comments.get(id)
        if (!onBoard(c)) return null
        const row = c as CommentRow
        row.body = body
        row.edited_at = now
        row.updated_at = now
        if (row.metadata && typeof row.metadata === "object") delete (row.metadata as Row).sample
        return copy(row)
      },
      async deleteComment(id, now) {
        const c = comments.get(id)
        if (!onBoard(c)) return null
        ;(c as CommentRow).deleted_at = now
        return copy(c as CommentRow)
      },
      async listActivity(taskId, limit) {
        return [...activity.values()]
          .filter((a) => onBoard(a) && a.task_id === taskId)
          .sort((a, b) => time(b.created_at) - time(a.created_at) || (a.id < b.id ? 1 : -1))
          .slice(0, limit)
          .map(copy)
      },
      async boardActivity(limit) {
        return [...activity.values()]
          .filter((a) => {
            if (!onBoard(a)) return false
            const t = tasks.get(a.task_id)
            return Boolean(t) && t?.board === board && (!t?.deleted_at || a.type === "task_deleted")
          })
          .sort((a, b) => time(b.created_at) - time(a.created_at) || (a.id < b.id ? 1 : -1))
          .slice(0, limit)
          .map((a) => ({ ...copy(a), task_title: tasks.get(a.task_id)?.title ?? null }))
      },
      async apiKeyActivity() {
        const rows = [...activity.values()].filter((a) => onBoard(a) && a.actor_type === "api-key")
        const last = rows.map((a) => time(a.created_at)).sort((a, b) => b - a)[0]
        return { count: rows.length, last: last ? new Date(last) : null }
      },
      async listLinks(taskIds) {
        return [...links.values()].filter((l) => onBoard(l) && taskIds.includes(l.task_id)).map(copy)
      },
      async insertLink(l, newActivity) {
        if (!task(l.task_id)) return null
        const existing = [...links.values()].find((x) => onBoard(x) && x.task_id === l.task_id && x.entity_type === l.entity_type && x.entity_id === l.entity_id)
        if (existing) return { link: copy(existing), created: false }
        const row = { ...l, board, updated_at: l.created_at, deleted_at: null } as LinkRow
        links.set(row.id, row)
        addActivity(newActivity)
        return { link: copy(row), created: true }
      },
      async deleteLink(taskId, linkId, newActivity, now) {
        const l = links.get(linkId)
        if (!onBoard(l) || (l as LinkRow).task_id !== taskId || !task(taskId)) return null
        ;(l as LinkRow).deleted_at = now
        addActivity(newActivity)
        return copy(l as LinkRow)
      },
      async tasksForEntity(type, entityId, limit) {
        const rows = [...tasks.values()]
          .filter((t) => onBoard(t) && [...links.values()].some((l) => onBoard(l) && l.task_id === t.id && l.entity_type === type && l.entity_id === entityId))
          .sort(
            (a, b) =>
              Number((CLOSED_STATUSES as readonly string[]).includes(a.status)) - Number((CLOSED_STATUSES as readonly string[]).includes(b.status)) ||
              time(b.updated_at) - time(a.updated_at),
          )
        return { rows: rows.slice(0, limit).map(copy), count: rows.length }
      },
    }
  }

  const settingStore: SettingStore = {
    async get(key) {
      const r = settings.get(key)
      return r ? copy(r) : null
    },
    async put(key, value, updatedBy, now) {
      const row = { id: `tset_${key}`, key, value: JSON.parse(JSON.stringify(value ?? null)), updated_by: updatedBy, created_at: now, updated_at: now, deleted_at: null }
      settings.set(key, row)
      return copy(row)
    },
  }

  const sandbox: SandboxStore = {
    async replace(seed, marker, now) {
      for (const m of [links, activity, comments, tasks] as Array<Map<string, Row>>) for (const [id, r] of [...m.entries()]) if (r.board === SANDBOX_BOARD) m.delete(id)
      for (const t of seed.tasks) tasks.set(t.id, { ...t, board: SANDBOX_BOARD, position: t.position ?? 0, updated_at: t.updated_at ?? t.created_at, deleted_at: null } as unknown as TaskRow)
      for (const c of seed.comments) comments.set(c.id, { ...c, board: SANDBOX_BOARD, edited_at: null, updated_at: c.created_at, deleted_at: null } as CommentRow)
      for (const a of seed.activity) activity.set(a.id, { ...a, board: SANDBOX_BOARD, updated_at: a.created_at, deleted_at: null } as ActivityRow)
      for (const l of seed.links) links.set(l.id, { ...l, board: SANDBOX_BOARD, updated_at: l.created_at, deleted_at: null } as LinkRow)
      settings.set(marker.key, { id: marker.id, key: marker.key, value: JSON.parse(JSON.stringify(marker.value)), updated_by: null, created_at: now, updated_at: now, deleted_at: null })
    },
    async countTasks() {
      return [...tasks.values()].filter((t) => t.board === SANDBOX_BOARD && !t.deleted_at).length
    },
  }

  return {
    tasks,
    comments,
    activity,
    links,
    settings,
    boardsAsked,
    stores: {
      board: (b) => {
        boardsAsked.push(b)
        return boardStore(b)
      },
      settings: settingStore,
      sandbox,
    },
  }
}

/* ------------------------------------------------------------------ */
/* A fake container                                                    */
/* ------------------------------------------------------------------ */

export const USERS = [
  { id: "user_team", email: "owner@store.example", first_name: "Olga", last_name: "Owner", avatar_url: "https://cdn.example/olga.png" },
  { id: "user_dev", email: "dev@agency.example", first_name: "Dan", last_name: "Dev", avatar_url: null },
  { id: "user_demo", email: "demo@store.example", first_name: "Demo", last_name: null, avatar_url: null },
  { id: "user_demo2", email: "demo2@store.example", first_name: null, last_name: null, avatar_url: null },
]

export const API_KEYS = [
  { id: "apk_team", title: "Deploy bot", created_by: "user_team" },
  { id: "apk_demo", title: "Demo key", created_by: "user_demo" },
  { id: "apk_orphan", title: "Old key", created_by: "user_gone" },
  { id: "apk_server", title: "Seed key", created_by: null },
]

export const RECORDS: Record<string, Array<Record<string, unknown>>> = {
  order: [{ id: "order_1", display_id: 1042, customer_id: "cus_1" }],
  product: [
    { id: "prod_1", title: "Linen shirt", status: "published" },
    { id: "prod_2", title: "Draft hat", status: "draft" },
  ],
  customer: [{ id: "cus_1", email: "anna@example.com", first_name: "Anna", last_name: "Nowak", company_name: null }],
}

export interface Event {
  name: string
  data: Record<string, any>
}

export interface Setup {
  container: { resolve<T = unknown>(key: string, options?: { allowUnregistered?: boolean }): T }
  memory: Memory
  events: Event[]
  failUsers: { on: boolean }
}

export const DEFAULT_OPTIONS: TasksPluginOptions = { sandboxAccounts: ["demo@store.example", "demo2@store.example"], agencyAccounts: ["@agency.example"] }

/** `extra.sql`: the real SQL stores on that runner instead of the in-memory ones (`pg-scenario.ts` runs the flows on a database). */
export function setup(options: TasksPluginOptions = DEFAULT_OPTIONS, extra: { sql?: SqlRunner } = {}): Setup {
  forgetProfiles()
  const memory = memoryStores()
  const events: Event[] = []
  const failUsers = { on: false }
  const resolved = resolveOptions(options)
  const pick = (rows: Array<Record<string, unknown>>, filters: Record<string, unknown>) =>
    rows.filter((r) =>
      Object.entries(filters).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : v === undefined || r[k] === v)),
    )
  const registry: Record<string, unknown> = {
    tasks: { getOptions: () => resolved, getLogger: () => ({ info() {}, warn() {}, error() {} }) },
    ...(extra.sql ? { __pg_connection__: extra.sql } : { [STORES_KEY]: memory.stores }),
    event_bus: {
      async emit(m: Event) {
        events.push(JSON.parse(JSON.stringify(m)))
      },
    },
    user: {
      async listUsers(filters: Record<string, unknown>) {
        if (failUsers.on) throw new Error("user module down")
        return pick(USERS, filters)
      },
    },
    api_key: {
      async listApiKeys(filters: Record<string, unknown>) {
        if (failUsers.on) throw new Error("api key module down")
        return pick(API_KEYS, filters)
      },
    },
    query: {
      async graph(args: { entity: string; filters?: Record<string, unknown> }) {
        return { data: pick(RECORDS[args.entity] ?? [], args.filters ?? {}) }
      },
    },
  }
  return {
    container: {
      resolve<T>(key: string, opts?: { allowUnregistered?: boolean }): T {
        if (key in registry) return registry[key] as T
        if (opts?.allowUnregistered) return undefined as T
        throw new Error(`Could not resolve ${key}`)
      },
    },
    memory,
    events,
    failUsers,
  }
}

/* ------------------------------------------------------------------ */
/* Recording SQL                                                       */
/* ------------------------------------------------------------------ */

export interface Recorded {
  sql: string
  bindings: unknown[]
}

/** A runner that records statements and answers `rows` from `answer` (default: one empty-ish row). */
export function recorder(answer: (sql: string, bindings: unknown[]) => Row[] = () => []): SqlRunner & { log: Recorded[] } {
  const log: Recorded[] = []
  const runner: SqlRunner & { log: Recorded[] } = {
    log,
    async raw(sql, bindings = []) {
      log.push({ sql, bindings: [...bindings] })
      return { rows: answer(sql, [...bindings]) }
    },
    async transaction(fn) {
      return fn(runner)
    },
  }
  return runner
}
