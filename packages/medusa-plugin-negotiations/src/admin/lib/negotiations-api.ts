import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  DraftRunResponse,
  ExpireResponse,
  PlanResponse,
  RunsResponse,
  StatusResponse,
  ThreadResponse,
  ThreadsResponse,
  WriterDto,
} from "../../modules/negotiations/lib/contract"
import type { WriterKey } from "../../modules/negotiations/lib/writers"

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

export class NegotiationsRequestError extends Error {
  readonly status: number
  readonly code: string | null
  readonly body: Record<string, unknown> | null
  constructor(status: number, message: string, code: string | null, body: Record<string, unknown> | null) {
    super(message)
    this.name = "NegotiationsRequestError"
    this.status = status
    this.code = code
    this.body = body
  }
}

export async function negotiationsFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    throw new NegotiationsRequestError(res.status, message, body && typeof body.code === "string" ? body.code : null, body)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function errorCode(err: unknown): string | null {
  return err instanceof NegotiationsRequestError ? err.code : null
}

function params(values: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== "" && v !== undefined && v !== null) p.set(k, String(v))
  return p.toString()
}

export const negotiationsKeys = {
  all: ["negotiations"] as const,
  status: ["negotiations", "status"] as const,
  threads: (filter: string, q: string, offset: number, limit: number, customerId?: string | null) => ["negotiations", "threads", filter, q, offset, limit, customerId ?? ""] as const,
  thread: (id: string) => ["negotiations", "thread", id] as const,
  product: (id: string) => ["negotiations", "product", id] as const,
  customer: (id: string) => ["negotiations", "customer", id] as const,
  waiting: ["negotiations", "waiting"] as const,
  oldest: ["negotiations", "oldest"] as const,
  runs: ["negotiations", "runs"] as const,
  plan: ["negotiations", "plan"] as const,
}

export function useNegotiationsStatus() {
  return useQuery<StatusResponse>({
    queryKey: negotiationsKeys.status,
    queryFn: () => negotiationsFetch<StatusResponse>("/admin/negotiations"),
    refetchInterval: 15_000,
  })
}

export function useNegotiationThreads(filter: string, q: string, offset: number, limit: number, customerId?: string | null) {
  return useQuery<ThreadsResponse>({
    queryKey: negotiationsKeys.threads(filter, q, offset, limit, customerId),
    queryFn: () => negotiationsFetch<ThreadsResponse>(`/admin/negotiations/threads?${params({ status: filter, q, offset, limit, customer_id: customerId })}`),
    placeholderData: (previous) => previous,
    refetchInterval: 15_000,
  })
}

/** One thread with its conversation. Polls while the drawer is open, so a customer's reply shows up. */
export function useNegotiationThread(id: string | null) {
  return useQuery<ThreadResponse>({
    queryKey: negotiationsKeys.thread(id ?? ""),
    queryFn: () => negotiationsFetch<ThreadResponse>(`/admin/negotiations/threads/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id),
    refetchInterval: 8_000,
  })
}

export function useProductNegotiations(productId: string) {
  return useQuery<ThreadsResponse & { mode: "demo" | "live" }>({
    queryKey: negotiationsKeys.product(productId),
    queryFn: () => negotiationsFetch(`/admin/negotiations/products/${encodeURIComponent(productId)}`),
    enabled: Boolean(productId),
    refetchInterval: 30_000,
  })
}

export function useCustomerNegotiations(customerId: string) {
  return useQuery<ThreadsResponse & { mode: "demo" | "live" }>({
    queryKey: negotiationsKeys.customer(customerId),
    queryFn: () => negotiationsFetch(`/admin/negotiations/customers/${encodeURIComponent(customerId)}`),
    enabled: Boolean(customerId),
    refetchInterval: 30_000,
  })
}

/** Threads waiting for the team, for the widget above the order list. */
export function useWaitingNegotiations() {
  return useQuery<ThreadsResponse>({
    queryKey: negotiationsKeys.waiting,
    queryFn: () => negotiationsFetch<ThreadsResponse>(`/admin/negotiations/threads?${params({ status: "waiting", limit: 5 })}`),
    refetchInterval: 30_000,
  })
}

/** The thread that has waited longest for the team, for "Answer the oldest". */
export function useOldestWaiting() {
  return useQuery<ThreadsResponse>({
    queryKey: negotiationsKeys.oldest,
    queryFn: () => negotiationsFetch<ThreadsResponse>(`/admin/negotiations/threads?${params({ status: "waiting", order: "oldest", limit: 1 })}`),
    refetchInterval: 15_000,
  })
}

export function useNegotiationRuns(enabled: boolean) {
  return useQuery<RunsResponse>({
    queryKey: negotiationsKeys.runs,
    queryFn: () => negotiationsFetch<RunsResponse>("/admin/negotiations/runs?limit=30"),
    enabled,
    refetchInterval: 30_000,
  })
}

export function useDraftPlan(enabled: boolean) {
  return useQuery<PlanResponse>({
    queryKey: negotiationsKeys.plan,
    queryFn: () => negotiationsFetch<PlanResponse>("/admin/negotiations/writers/plan"),
    enabled,
    refetchInterval: 30_000,
  })
}

export type ThreadMove = "messages" | "notes" | "counter" | "accept" | "reject" | "draft-order"

/** A team move on a thread; the answer is the thread after it. */
export function useThreadMove() {
  const client = useQueryClient()
  return useMutation<ThreadResponse, Error, { id: string; move: ThreadMove; body?: Record<string, unknown> }>({
    mutationFn: ({ id, move, body }) => negotiationsFetch<ThreadResponse>(`/admin/negotiations/threads/${encodeURIComponent(id)}/${move}`, { method: "POST", body: body ?? {} }),
    onSuccess: (data, variables) => {
      client.setQueryData(negotiationsKeys.thread(variables.id), data)
      void client.invalidateQueries({ queryKey: negotiationsKeys.all, predicate: (q) => q.queryKey[1] !== "thread" })
    },
  })
}

export function useExpireNow() {
  const client = useQueryClient()
  return useMutation<ExpireResponse, Error, void>({
    mutationFn: () => negotiationsFetch<ExpireResponse>("/admin/negotiations/expire", { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: negotiationsKeys.all }),
  })
}

export function useSetWriter() {
  const client = useQueryClient()
  return useMutation<{ writer: WriterDto }, Error, { writer: WriterKey; on: boolean }>({
    mutationFn: (body) => negotiationsFetch<{ writer: WriterDto }>("/admin/negotiations/writers", { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: negotiationsKeys.all }),
  })
}

export function useRunDraftOrders() {
  const client = useQueryClient()
  return useMutation<DraftRunResponse, Error, { dryRun: boolean }>({
    mutationFn: ({ dryRun }) => negotiationsFetch<DraftRunResponse>("/admin/negotiations/writers/run", { method: "POST", body: { dry_run: dryRun } }),
    onSuccess: (data) => {
      if (!data.dryRun) void client.invalidateQueries({ queryKey: negotiationsKeys.all })
    },
  })
}

export function useResetDemo() {
  const client = useQueryClient()
  return useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () => negotiationsFetch<{ ok: boolean }>("/admin/negotiations/demo/reset", { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: negotiationsKeys.all }),
  })
}
