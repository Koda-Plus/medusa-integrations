import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  OlxAdvertFilter,
  OlxAdvertsResponse,
  OlxAlertKind,
  OlxAlertsResponse,
  OlxPlanResponse,
  OlxProductAdvertsResponse,
  OlxPublicationsResponse,
  OlxRunsResponse,
  OlxStatusResponse,
  OlxSyncResponse,
  OlxThreadsResponse,
  OlxWriterKey,
  OlxWriterRunResponse,
} from "../../modules/olx/lib/contract"

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

export class OlxRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "OlxRequestError"
    this.status = status
  }
}

export async function olxFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    const message =
      json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : `HTTP ${res.status}`
    throw new OlxRequestError(res.status, message)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const olxKeys = {
  all: ["olx"] as const,
  status: ["olx", "status"] as const,
  adverts: (filter: OlxAdvertFilter, q: string, offset: number, limit: number) => ["olx", "adverts", filter, q, offset, limit] as const,
  runs: ["olx", "runs"] as const,
  product: (id: string) => ["olx", "product", id] as const,
  alerts: (kind: string, q: string, offset: number, limit: number) => ["olx", "alerts", kind, q, offset, limit] as const,
  plan: (writer: string, view: string, offset: number, limit: number) => ["olx", "plan", writer, view, offset, limit] as const,
  publications: (view: string, q: string, offset: number, limit: number) => ["olx", "publications", view, q, offset, limit] as const,
  threads: (filter: string, offset: number, limit: number) => ["olx", "threads", filter, offset, limit] as const,
}

function busy(s: OlxStatusResponse | undefined): boolean {
  if (!s) return false
  return s.running || s.stats.running || s.messages.running || s.writers.some((w) => w.running)
}

/** Status of the OLX page. Polls while something runs or a connection waits for consent. */
export function useOlxStatus(pollUntil: number) {
  return useQuery<OlxStatusResponse>({
    queryKey: olxKeys.status,
    queryFn: () => olxFetch<OlxStatusResponse>("/admin/olx"),
    refetchInterval: (query) => {
      const data = query.state.data
      if (busy(data) || Date.now() < pollUntil) return 2_000
      if (data?.connecting) return 4_000
      return 60_000
    },
  })
}

export function useOlxAdverts(filter: OlxAdvertFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<OlxAdvertsResponse>({
    queryKey: olxKeys.adverts(filter, q, offset, limit),
    queryFn: () => olxFetch<OlxAdvertsResponse>(`/admin/olx/adverts?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useOlxRuns() {
  return useQuery<OlxRunsResponse>({
    queryKey: olxKeys.runs,
    queryFn: () => olxFetch<OlxRunsResponse>("/admin/olx/runs?limit=8"),
  })
}

export function useOlxProductAdverts(productId: string) {
  return useQuery<OlxProductAdvertsResponse>({
    queryKey: olxKeys.product(productId),
    queryFn: () => olxFetch<OlxProductAdvertsResponse>(`/admin/olx/products/${encodeURIComponent(productId)}`),
    enabled: Boolean(productId),
  })
}

export function useOlxAlerts(kind: OlxAlertKind | "all", q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (kind !== "all") params.set("kind", kind)
  if (q) params.set("q", q)
  return useQuery<OlxAlertsResponse>({
    queryKey: olxKeys.alerts(kind, q, offset, limit),
    queryFn: () => olxFetch<OlxAlertsResponse>(`/admin/olx/alerts?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useOlxPlan(writer: "lifecycle" | "price", view: string, offset: number, limit: number, enabled = true) {
  const params = new URLSearchParams({ writer, view, limit: String(limit), offset: String(offset) })
  return useQuery<OlxPlanResponse>({
    queryKey: olxKeys.plan(writer, view, offset, limit),
    queryFn: () => olxFetch<OlxPlanResponse>(`/admin/olx/plan?${params.toString()}`),
    placeholderData: (previous) => previous,
    enabled,
  })
}

export function useOlxPublications(view: string, q: string, offset: number, limit: number, enabled = true) {
  const params = new URLSearchParams({ view, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<OlxPublicationsResponse>({
    queryKey: olxKeys.publications(view, q, offset, limit),
    queryFn: () => olxFetch<OlxPublicationsResponse>(`/admin/olx/publications?${params.toString()}`),
    placeholderData: (previous) => previous,
    enabled,
  })
}

export function useOlxThreads(filter: "unread" | "all", offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  return useQuery<OlxThreadsResponse>({
    queryKey: olxKeys.threads(filter, offset, limit),
    queryFn: () => olxFetch<OlxThreadsResponse>(`/admin/olx/threads?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

function usePost<TResult, TVars = void>(path: (vars: TVars) => string, body: (vars: TVars) => unknown = () => ({})) {
  const client = useQueryClient()
  return useMutation<TResult, unknown, TVars>({
    mutationFn: (vars: TVars) => olxFetch<TResult>(path(vars), { method: "POST", body: body(vars) }),
    onSuccess: (data) => {
      if (data && typeof data === "object" && "mode" in (data as object) && "writers" in (data as object)) {
        client.setQueryData(olxKeys.status, data)
      }
      void client.invalidateQueries({ queryKey: olxKeys.all })
    },
  })
}

export const useOlxSync = () => usePost<OlxSyncResponse>(() => "/admin/olx/sync")
export const useOlxConnect = () => usePost<OlxStatusResponse>(() => "/admin/olx/connect")
export const useOlxDisconnect = () => usePost<OlxStatusResponse>(() => "/admin/olx/disconnect")
export const useOlxStatsRefresh = () => usePost<{ started: boolean; alreadyRunning: boolean }>(() => "/admin/olx/stats/refresh")
export const useOlxThreadsSync = () => usePost<{ started: boolean; alreadyRunning: boolean }>(() => "/admin/olx/threads/sync")
export const useOlxDemoReset = () => usePost<OlxStatusResponse>(() => "/admin/olx/demo/reset")

export const useOlxArm = () =>
  usePost<OlxStatusResponse, { writer: OlxWriterKey; armed: boolean }>(
    (v) => `/admin/olx/writers/${v.writer}`,
    (v) => ({ armed: v.armed }),
  )

export const useOlxWriterRun = () =>
  usePost<OlxWriterRunResponse, { writer: OlxWriterKey; dryRun: boolean; overrideGuard?: boolean }>(
    (v) => `/admin/olx/writers/${v.writer}/run`,
    (v) => ({ dryRun: v.dryRun, overrideGuard: v.overrideGuard === true }),
  )

export const useOlxRelease = () =>
  usePost<OlxStatusResponse, { writer: OlxWriterKey; id: string }>((v) => `/admin/olx/writers/${v.writer}/items/${encodeURIComponent(v.id)}/release`)
