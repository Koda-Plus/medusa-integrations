import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { LinkType } from "../../modules/tasks/lib/constants"
import type { ActivityResponse, BoardResponse, CommentDto, EntityTasksResponse, LinkDto, StatusResponse, TaskDto, TaskResponse } from "../../modules/tasks/lib/contract"
import { moveOnBoard, type MoveArgs } from "./tasks-rules"

import { backendUrl, kitRequestInit } from "./tasks-kit"

/* The backend the dashboard talks to, with its auth (session cookie or JWT): from the kit. */
export { backendUrl }

export class TasksRequestError extends Error {
  readonly status: number
  readonly code: string | null
  /** Field errors of a 400 (`errors: [{ field, code, message }]`). */
  readonly errors: Array<{ field?: string; code?: string; message?: string }>
  constructor(status: number, message: string, code: string | null, errors: Array<{ field?: string; code?: string; message?: string }> = []) {
    super(message)
    this.name = "TasksRequestError"
    this.status = status
    this.code = code
    this.errors = errors
  }
}

export async function tasksFetch<T>(path: string, init?: { method?: "GET" | "POST" | "DELETE"; body?: unknown }): Promise<T> {
  /* The kit adds the dashboard's auth (session cookie or JWT) and, on writes, the JSON body and the
     x-koda-request header the server's write guard asks for. */
  const res = await fetch(`${backendUrl()}${path}`, kitRequestInit({ method: init?.method ?? "GET", body: init?.body }))
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const body = json && typeof json === "object" ? (json as Record<string, unknown>) : null
    const message = body && typeof body.message === "string" ? body.message : `HTTP ${res.status}`
    const errors = Array.isArray(body?.errors) ? (body?.errors as Array<{ field?: string; code?: string; message?: string }>) : []
    throw new TasksRequestError(res.status, message, body && typeof body.code === "string" ? body.code : null, errors)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function errorCode(err: unknown): string | null {
  return err instanceof TasksRequestError ? err.code : null
}

/** The code of the first field error (`other_board`, `too_long`...), for a message in the admin's language. */
export function fieldErrorCode(err: unknown): string | null {
  return err instanceof TasksRequestError ? (err.errors[0]?.code ?? null) : null
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

/** The status of the page (people, options, counters). `enabled: false` until something needs it (a widget's "New task"). */
export function useTasksStatus(enabled = true) {
  return useQuery<StatusResponse>({
    queryKey: tasksKeys.status,
    queryFn: () => tasksFetch<StatusResponse>(`/admin/tasks?today=${localDay()}`),
    refetchInterval: enabled ? 60_000 : false,
    staleTime: 30_000,
    enabled,
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

/** The tasks of one record with their assignees' faces: the widget's only read, once a minute and on focus. */
export function useEntityTasks(type: LinkType, id: string) {
  return useQuery<EntityTasksResponse>({
    queryKey: tasksKeys.entity(type, id),
    queryFn: () => tasksFetch<EntityTasksResponse>(`/admin/tasks/${ENTITY_PATH[type]}/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
    staleTime: 30_000,
    refetchInterval: 60_000,
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

export type { MoveArgs }
export { moveOnBoard }

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

/**
 * The sample tasks of a sandbox account's board, asked once by the Tasks
 * page when the status says the board is stale. Reads never seed it.
 */
export function useEnsureSandbox() {
  const client = useQueryClient()
  return useMutation<{ seeded: boolean }, Error, void>({
    mutationFn: () => tasksFetch("/admin/tasks/sandbox/ensure", { method: "POST", body: {} }),
    onSuccess: (data) => {
      if (data.seeded) void client.invalidateQueries({ queryKey: tasksKeys.all })
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
