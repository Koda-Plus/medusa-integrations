import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  OlxAdvertFilter,
  OlxAdvertsResponse,
  OlxProductAdvertsResponse,
  OlxRunsResponse,
  OlxStatusResponse,
  OlxSyncResponse,
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
  adverts: (filter: OlxAdvertFilter, q: string, offset: number, limit: number) =>
    ["olx", "adverts", filter, q, offset, limit] as const,
  runs: ["olx", "runs"] as const,
  product: (id: string) => ["olx", "product", id] as const,
}

/** Status of the OLX page. Polls while a sync runs or a connection waits for consent. */
export function useOlxStatus(pollUntil: number) {
  return useQuery<OlxStatusResponse>({
    queryKey: olxKeys.status,
    queryFn: () => olxFetch<OlxStatusResponse>("/admin/olx"),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.running || Date.now() < pollUntil) return 2_000
      if (data?.connecting) return 4_000
      return false
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

function usePost<T>(path: string) {
  const client = useQueryClient()
  return useMutation<T, unknown, void>({
    mutationFn: () => olxFetch<T>(path, { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: olxKeys.status })
    },
  })
}

export const useOlxSync = () => usePost<OlxSyncResponse>("/admin/olx/sync")
export const useOlxConnect = () => usePost<OlxStatusResponse>("/admin/olx/connect")
export const useOlxDisconnect = () => usePost<OlxStatusResponse>("/admin/olx/disconnect")
