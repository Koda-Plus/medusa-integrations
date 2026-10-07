import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { LinkType } from "../../modules/tasks/lib/constants"
import type { ActivityResponse, BoardResponse, CommentDto, EntityTasksResponse, LinkDto, StatusResponse, TaskDto, TaskResponse } from "../../modules/tasks/lib/contract"
import { planMove } from "../../modules/tasks/lib/positions"

declare const __BACKEND_URL__: string | undefined

/** Same origin by default; the admin build defines `__BACKEND_URL__` when the backend lives elsewhere. */
export function backendUrl(): string {
  try {
    if (typeof __BACKEND_URL__ !== "undefined" && __BACKEND_URL__) return String(__BACKEND_URL__).replace(/\/+$/, "")
  } catch {
    /* not defined in this build */
  }
  return ""
}

export class TasksRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "TasksRequestError"
    this.status = status
    this.code = code
  }
}

export async function tasksFetch<T>(path: string, init?: { method?: "GET" | "POST" | "DELETE"; body?: unknown }): Promise<T> {
  const hasBody = init?.body !== undefined
  const res = await fetch(`${backendUrl()}${path}`, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: { Accept: "application/json", ...(hasBody ? { "Content-Type": "application/json" } : {}) },
    body: hasBody ? JSON.stringify(init?.body) : undefined,
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const body = json && typeof json === "object" ? (json as Record<string, unknown>) : null
    const message = body && "message" in body ? String(body.message) : `HTTP ${res.status}`
    throw new TasksRequestError(res.status, message, body && typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function errorCode(err: unknown): string | null {
  return err instanceof TasksRequestError ? err.code : null
}

/** The admin's own calendar day, so "overdue" means the same on the server and on screen. */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export const tasksKeys = {
  all: ["tasks"] as const,
  status: ["tasks", "status"] as const,
  board: ["tasks", "board"] as const,
  task: (id: string) => ["tasks", "task", id] as const,
  activity: ["tasks", "activity"] as const,
  entity: (type: LinkType, id: string) => ["tasks", "entity", type, id] as const,
  search: (type: LinkType, q: string) => ["tasks", "search", type, q] as const,
}

const ENTITY_PATH: Record<LinkType, string> = { order: "orders", product: "products", customer: "customers" }

export function useTasksStatus() {
  return useQuery<StatusResponse>({
    queryKey: tasksKeys.status,
    queryFn: () => tasksFetch<StatusResponse>(`/admin/tasks?today=${localDay()}`),
    refetchInterval: 30_000,
  })
}

/** The whole board. Polls so the team sees each other's moves; paused while a card is dragged. */
export function useBoard(paused: boolean) {
  return useQuery<BoardResponse>({
    queryKey: tasksKeys.board,
    queryFn: () => tasksFetch<BoardResponse>(`/admin/tasks/tasks?view=board&today=${localDay()}`),
    refetchInterval: paused ? false : 20_000,
  })
}

export function useTask(id: string | null) {
  return useQuery<TaskResponse>({
    queryKey: tasksKeys.task(id ?? ""),
    queryFn: () => tasksFetch<TaskResponse>(`/admin/tasks/tasks/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
    retry: (count, err) => !(err instanceof TasksRequestError && err.status === 404) && count < 2,
  })
}

export function useBoardActivity() {
  return useQuery<ActivityResponse>({
    queryKey: tasksKeys.activity,
    queryFn: () => tasksFetch<ActivityResponse>("/admin/tasks/activity?limit=12"),
    refetchInterval: 30_000,
  })
}

export function useEntityTasks(type: LinkType, id: string) {
  return useQuery<EntityTasksResponse>({
    queryKey: tasksKeys.entity(type, id),
    queryFn: () => tasksFetch<EntityTasksResponse>(`/admin/tasks/${ENTITY_PATH[type]}/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
    refetchInterval: 30_000,
  })
}

/** After a change: everything of the plugin but the open task, which the mutation already answered with. */
function useRefresh() {
  const client = useQueryClient()
  return (taskId?: string) => {
    void client.invalidateQueries({ queryKey: tasksKeys.all, predicate: (q) => !(q.queryKey[1] === "task" && q.queryKey[2] === taskId) })
  }
}

export function useCreateTask() {
  const refresh = useRefresh()
  return useMutation<{ task: TaskDto }, Error, Record<string, unknown>>({
    mutationFn: (body) => tasksFetch("/admin/tasks/tasks", { method: "POST", body }),
    onSuccess: () => refresh(),
  })
}

export function useUpdateTask(id: string) {
  const client = useQueryClient()
  const refresh = useRefresh()
  return useMutation<{ task: TaskDto }, Error, Record<string, unknown>>({
    mutationFn: (body) => tasksFetch(`/admin/tasks/tasks/${encodeURIComponent(id)}`, { method: "POST", body }),
    onSuccess: (data) => {
      client.setQueryData<TaskResponse>(tasksKeys.task(id), (old) => (old ? { task: { ...old.task, ...data.task } } : old))
      refresh(id)
      void client.invalidateQueries({ queryKey: tasksKeys.task(id) })
    },
  })
}

export interface MoveArgs {
  id: string
  status: TaskDto["status"]
  before_id: string | null
  after_id: string | null
}

const CLOSED = new Set(["done", "rejected"])

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
  const dest = planMove(column(m.status), m.id, { afterId: m.after_id, beforeId: m.before_id })
  const left = from === m.status ? [] : column(from)
  const position = new Map<string, number>()
  dest.forEach((id, i) => position.set(id, i))
  left.forEach((id, i) => position.set(id, i))
  const tasks = board.tasks.map((t) => {
    const p = position.get(t.id)
    if (t.id === m.id) {
      const completed = CLOSED.has(m.status) ? (CLOSED.has(from) ? t.completed_at : new Date().toISOString()) : null
      return { ...t, status: m.status, position: p ?? 0, completed_at: completed }
    }
    return p === undefined ? t : { ...t, position: p }
  })
  return { ...board, tasks }
}

/** Drag and drop: the card moves at once, the server confirms, a refusal puts it back. */
export function useMoveTask() {
  const client = useQueryClient()
  const refresh = useRefresh()
  return useMutation<{ task: TaskDto }, Error, MoveArgs, { previous?: BoardResponse }>({
    mutationFn: (m) => tasksFetch(`/admin/tasks/tasks/${encodeURIComponent(m.id)}/move`, { method: "POST", body: { status: m.status, before_id: m.before_id, after_id: m.after_id } }),
    onMutate: async (m) => {
      await client.cancelQueries({ queryKey: tasksKeys.board })
      const previous = client.getQueryData<BoardResponse>(tasksKeys.board)
      if (previous) client.setQueryData<BoardResponse>(tasksKeys.board, moveOnBoard(previous, m))
      return { previous }
    },
    onError: (_err, _m, ctx) => {
      if (ctx?.previous) client.setQueryData(tasksKeys.board, ctx.previous)
    },
    onSettled: (_data, _err, m) => {
      refresh()
      void client.invalidateQueries({ queryKey: tasksKeys.task(m.id) })
    },
  })
}

export function useDeleteTask() {
  const refresh = useRefresh()
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (id) => tasksFetch(`/admin/tasks/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => refresh(),
  })
}

export function useAddComment(taskId: string) {
  const client = useQueryClient()
  const refresh = useRefresh()
  return useMutation<{ comment: CommentDto }, Error, { body: string }>({
    mutationFn: (body) => tasksFetch(`/admin/tasks/tasks/${encodeURIComponent(taskId)}/comments`, { method: "POST", body }),
    onSuccess: () => {
      refresh(taskId)
      void client.invalidateQueries({ queryKey: tasksKeys.task(taskId) })
    },
  })
}

export function useEditComment(taskId: string) {
  const client = useQueryClient()
  return useMutation<{ comment: CommentDto }, Error, { id: string; body: string }>({
    mutationFn: ({ id, body }) => tasksFetch(`/admin/tasks/comments/${encodeURIComponent(id)}`, { method: "POST", body: { body } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: tasksKeys.task(taskId) }),
  })
}

export function useDeleteComment(taskId: string) {
  const client = useQueryClient()
  const refresh = useRefresh()
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (id) => tasksFetch(`/admin/tasks/comments/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh(taskId)
      void client.invalidateQueries({ queryKey: tasksKeys.task(taskId) })
    },
  })
}

export function useAddLink(taskId: string) {
  const client = useQueryClient()
  const refresh = useRefresh()
  return useMutation<{ link: LinkDto; created: boolean }, Error, { type: LinkType; id: string }>({
    mutationFn: (body) => tasksFetch(`/admin/tasks/tasks/${encodeURIComponent(taskId)}/links`, { method: "POST", body }),
    onSuccess: () => {
      refresh(taskId)
      void client.invalidateQueries({ queryKey: tasksKeys.task(taskId) })
    },
  })
}

export function useRemoveLink(taskId: string) {
  const client = useQueryClient()
  const refresh = useRefresh()
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (linkId) => tasksFetch(`/admin/tasks/tasks/${encodeURIComponent(taskId)}/links/${encodeURIComponent(linkId)}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh(taskId)
      void client.invalidateQueries({ queryKey: tasksKeys.task(taskId) })
    },
  })
}

export function useResetSandbox() {
  const client = useQueryClient()
  return useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () => tasksFetch("/admin/tasks/sandbox/reset", { method: "POST", body: {} }),
    onSuccess: () => void client.invalidateQueries({ queryKey: tasksKeys.all }),
  })
}

/* ------------------------------------------------------------------ */
/* Records to link: Medusa's own admin routes                          */
/* ------------------------------------------------------------------ */

export interface FoundRecord {
  id: string
  label: string
  sub: string | null
}

type Raw = Record<string, unknown>
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

function recordOf(type: LinkType, r: Raw): FoundRecord | null {
  const id = s(r.id)
  if (!id) return null
  if (type === "order") return { id, label: r.display_id !== undefined && r.display_id !== null ? `#${String(r.display_id)}` : id, sub: s(r.email) }
  if (type === "product") return { id, label: s(r.title) ?? id, sub: s(r.handle) }
  const name = [s(r.first_name), s(r.last_name)].filter(Boolean).join(" ")
  return { id, label: s(r.company_name) ?? (name || null) ?? s(r.email) ?? id, sub: s(r.email) }
}

const SEARCH: Record<LinkType, { path: string; key: string; fields: string }> = {
  order: { path: "/admin/orders", key: "orders", fields: "id,display_id,email" },
  product: { path: "/admin/products", key: "products", fields: "id,title,handle" },
  customer: { path: "/admin/customers", key: "customers", fields: "id,email,first_name,last_name,company_name" },
}

/** Orders, products or customers for the link picker; a pasted id is looked up directly. */
export function useRecordSearch(type: LinkType, q: string, enabled: boolean) {
  return useQuery<FoundRecord[]>({
    queryKey: tasksKeys.search(type, q),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const cfg = SEARCH[type]
      const term = q.trim()
      const prefix = type === "order" ? "order_" : type === "product" ? "prod_" : "cus_"
      if (term.startsWith(prefix)) {
        const one = await tasksFetch<Raw>(`${cfg.path}/${encodeURIComponent(term)}?fields=${cfg.fields}`).catch(() => null)
        const r = one?.[type] as Raw | undefined
        const rec = r ? recordOf(type, r) : null
        return rec ? [rec] : []
      }
      const params = new URLSearchParams({ limit: "6", fields: cfg.fields })
      if (term) params.set("q", term.replace(/^#/, ""))
      const res = await tasksFetch<Raw>(`${cfg.path}?${params.toString()}`)
      const rows = Array.isArray(res[cfg.key]) ? (res[cfg.key] as Raw[]) : []
      return rows.map((r) => recordOf(type, r)).filter((r): r is FoundRecord => r !== null)
    },
  })
}
