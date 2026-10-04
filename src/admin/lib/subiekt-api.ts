import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ActionResponse,
  DocumentsResponse,
  OrderSubiektResponse,
  RunsResponse,
  SubiektStatusResponse,
  TaskDto,
  TasksResponse,
} from "../../modules/subiekt/lib/contract"

declare const __BACKEND_URL__: string | undefined

/** Same origin by default; the admin build defines `__BACKEND_URL__` when the backend lives elsewhere. */
function backendUrl(): string {
  try {
    if (typeof __BACKEND_URL__ !== "undefined" && __BACKEND_URL__) return String(__BACKEND_URL__).replace(/\/+$/, "")
  } catch {
    /* not defined in this build */
  }
  return ""
}

export class SubiektRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "SubiektRequestError"
    this.status = status
  }
}

export async function subiektFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    const message = json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : `HTTP ${res.status}`
    throw new SubiektRequestError(res.status, message)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const subiektKeys = {
  all: ["subiekt"] as const,
  status: ["subiekt", "status"] as const,
  tasks: (filter: string, q: string, offset: number, limit: number) => ["subiekt", "tasks", filter, q, offset, limit] as const,
  documents: (kind: string, q: string, offset: number, limit: number) => ["subiekt", "documents", kind, q, offset, limit] as const,
  runs: ["subiekt", "runs"] as const,
  order: (id: string) => ["subiekt", "order", id] as const,
}

/** Status of the page. Polls while a job runs or right after an action. */
export function useSubiektStatus(pollUntil: number) {
  return useQuery<SubiektStatusResponse>({
    queryKey: subiektKeys.status,
    queryFn: () => subiektFetch<SubiektStatusResponse>("/admin/subiekt"),
    refetchInterval: (query) => {
      const data = query.state.data
      if ((data?.running?.length ?? 0) > 0 || Date.now() < pollUntil) return 3000
      return 30_000
    },
  })
}

export function useSubiektTasks(filter: string, q: string, offset: number, limit: number, poll: boolean) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<TasksResponse>({
    queryKey: subiektKeys.tasks(filter, q, offset, limit),
    queryFn: () => subiektFetch<TasksResponse>(`/admin/subiekt/tasks?${params.toString()}`),
    refetchInterval: poll ? 3000 : 30_000,
  })
}

export function useSubiektDocuments(kind: string, q: string, offset: number, limit: number, poll: boolean) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (kind && kind !== "all") params.set("kind", kind)
  if (q) params.set("q", q)
  return useQuery<DocumentsResponse>({
    queryKey: subiektKeys.documents(kind, q, offset, limit),
    queryFn: () => subiektFetch<DocumentsResponse>(`/admin/subiekt/documents?${params.toString()}`),
    refetchInterval: poll ? 3000 : 30_000,
  })
}

export function useSubiektRuns(poll: boolean) {
  return useQuery<RunsResponse>({
    queryKey: subiektKeys.runs,
    queryFn: () => subiektFetch<RunsResponse>("/admin/subiekt/runs?limit=15"),
    refetchInterval: poll ? 3000 : 30_000,
  })
}

export function useSubiektOrder(orderId: string) {
  return useQuery<OrderSubiektResponse>({
    queryKey: subiektKeys.order(orderId),
    queryFn: () => subiektFetch<OrderSubiektResponse>(`/admin/subiekt/orders/${encodeURIComponent(orderId)}`),
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? []
      return tasks.some((t) => t.status === "pending" || t.status === "running") ? 3000 : 30_000
    },
  })
}

export function useSubiektSync() {
  const client = useQueryClient()
  return useMutation<ActionResponse, Error, "stock" | "events" | "tasks">({
    mutationFn: (what) => subiektFetch<ActionResponse>("/admin/subiekt/sync", { method: "POST", body: { what } }),
    onSuccess: () => client.invalidateQueries({ queryKey: subiektKeys.status }),
  })
}

export function useSubiektCheck() {
  const client = useQueryClient()
  return useMutation<{ result: { ok: boolean; error: string | null } | null; status: SubiektStatusResponse }, Error, void>({
    mutationFn: () => subiektFetch("/admin/subiekt/check", { method: "POST", body: {} }),
    onSuccess: (data) => client.setQueryData(subiektKeys.status, data.status),
  })
}

export function useSubiektRetry() {
  const client = useQueryClient()
  return useMutation<{ task: TaskDto }, Error, string>({
    mutationFn: (id) => subiektFetch(`/admin/subiekt/tasks/${encodeURIComponent(id)}/retry`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: subiektKeys.all }),
  })
}

export function useSubiektSendOrder(orderId: string) {
  const client = useQueryClient()
  return useMutation<{ task: TaskDto }, Error, void>({
    mutationFn: () => subiektFetch(`/admin/subiekt/orders/${encodeURIComponent(orderId)}/send`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: subiektKeys.order(orderId) }),
  })
}
