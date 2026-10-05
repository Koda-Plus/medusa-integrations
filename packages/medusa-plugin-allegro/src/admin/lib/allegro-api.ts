import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AllegroConnectPollResponse,
  AllegroOfferFilter,
  AllegroOffersResponse,
  AllegroOrderFilter,
  AllegroOrdersResponse,
  AllegroProductOffersResponse,
  AllegroRunsResponse,
  AllegroStatusResponse,
  AllegroSyncResponse,
} from "../../modules/allegro/lib/contract"

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

export class AllegroRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "AllegroRequestError"
    this.status = status
  }
}

export async function allegroFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    throw new AllegroRequestError(res.status, message)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const allegroKeys = {
  all: ["allegro"] as const,
  status: ["allegro", "status"] as const,
  offers: (filter: AllegroOfferFilter, q: string, offset: number, limit: number) =>
    ["allegro", "offers", filter, q, offset, limit] as const,
  orders: (filter: AllegroOrderFilter, q: string, offset: number, limit: number) =>
    ["allegro", "orders", filter, q, offset, limit] as const,
  runs: ["allegro", "runs"] as const,
  product: (id: string) => ["allegro", "product", id] as const,
}

/** Status of the Allegro page. Polls while a sync runs. */
export function useAllegroStatus(pollUntil: number) {
  return useQuery<AllegroStatusResponse>({
    queryKey: allegroKeys.status,
    queryFn: () => allegroFetch<AllegroStatusResponse>("/admin/allegro"),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.running.offers || data?.running.orders || Date.now() < pollUntil) return 2_000
      return false
    },
  })
}

export function useAllegroOffers(filter: AllegroOfferFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<AllegroOffersResponse>({
    queryKey: allegroKeys.offers(filter, q, offset, limit),
    queryFn: () => allegroFetch<AllegroOffersResponse>(`/admin/allegro/offers?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useAllegroOrders(filter: AllegroOrderFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<AllegroOrdersResponse>({
    queryKey: allegroKeys.orders(filter, q, offset, limit),
    queryFn: () => allegroFetch<AllegroOrdersResponse>(`/admin/allegro/orders?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useAllegroRuns() {
  return useQuery<AllegroRunsResponse>({
    queryKey: allegroKeys.runs,
    queryFn: () => allegroFetch<AllegroRunsResponse>("/admin/allegro/runs?limit=10"),
  })
}

export function useAllegroProductOffers(productId: string) {
  return useQuery<AllegroProductOffersResponse>({
    queryKey: allegroKeys.product(productId),
    queryFn: () => allegroFetch<AllegroProductOffersResponse>(`/admin/allegro/products/${encodeURIComponent(productId)}`),
    enabled: Boolean(productId),
  })
}

export function useAllegroSync() {
  const client = useQueryClient()
  return useMutation<AllegroSyncResponse, unknown, "offers" | "orders" | "all">({
    mutationFn: (what) => allegroFetch<AllegroSyncResponse>("/admin/allegro/sync", { method: "POST", body: { what } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.status })
    },
  })
}

function usePost<T>(path: string) {
  const client = useQueryClient()
  return useMutation<T, unknown, void>({
    mutationFn: () => allegroFetch<T>(path, { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.status })
    },
  })
}

export const useAllegroConnect = () => usePost<AllegroStatusResponse>("/admin/allegro/connect")
export const useAllegroDisconnect = () => usePost<AllegroStatusResponse>("/admin/allegro/disconnect")

/** One poll of the device login; the page decides when to call it again. */
export function pollAllegroConnect(): Promise<AllegroConnectPollResponse> {
  return allegroFetch<AllegroConnectPollResponse>("/admin/allegro/connect/poll", { method: "POST", body: {} })
}
