import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { LogResponse, MarketplaceOrderDto, OfferDto, OfferFilter, OrderFilter, OrderOriginResponse, OrdersResponse, OffersResponse, StatusResponse, VonHalskySettings } from "../../modules/vonhalsky/lib/contract"
import { backendUrl, kitRequestInit } from "./vonhalsky-kit"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export class VonHalskyRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "VonHalskyRequestError"
    this.status = status
    this.code = code
  }
}

export async function vonHalskyFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  /* The kit adds the dashboard's auth and, on writes, the JSON body and the x-koda-request header the write guard asks for. */
  const res = await fetch(`${backendUrl()}${path}`, kitRequestInit({ method: init?.method ?? "GET", body: init?.body }))
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const body = (json && typeof json === "object" ? json : {}) as { message?: unknown; code?: unknown }
    throw new VonHalskyRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const vonHalskyKeys = {
  all: ["vonhalsky"] as const,
  status: ["vonhalsky", "status"] as const,
  offers: (filter: OfferFilter, q: string, offset: number) => ["vonhalsky", "offers", filter, q, offset] as const,
  orders: (filter: OrderFilter, q: string, offset: number) => ["vonhalsky", "orders", filter, q, offset] as const,
  log: (area: string, outcome: string) => ["vonhalsky", "log", area, outcome] as const,
  origin: (id: string) => ["vonhalsky", "origin", id] as const,
}

export function useVonHalskyStatus() {
  return useQuery<StatusResponse>({
    queryKey: vonHalskyKeys.status,
    queryFn: () => vonHalskyFetch<StatusResponse>("/admin/vonhalsky"),
    refetchInterval: 30_000,
  })
}

export function useVonHalskyOffers(filter: OfferFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<OffersResponse>({
    queryKey: vonHalskyKeys.offers(filter, q, offset),
    queryFn: () => vonHalskyFetch<OffersResponse>(`/admin/vonhalsky/offers?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useVonHalskyOrders(filter: OrderFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<OrdersResponse>({
    queryKey: vonHalskyKeys.orders(filter, q, offset),
    queryFn: () => vonHalskyFetch<OrdersResponse>(`/admin/vonhalsky/orders?${params.toString()}`),
    placeholderData: (previous) => previous,
    refetchInterval: 20_000,
  })
}

export function useVonHalskyLog(area: string, outcome: string) {
  const params = new URLSearchParams({ limit: "100" })
  if (area) params.set("area", area)
  if (outcome) params.set("outcome", outcome)
  return useQuery<LogResponse>({
    queryKey: vonHalskyKeys.log(area, outcome),
    queryFn: () => vonHalskyFetch<LogResponse>(`/admin/vonhalsky/log?${params.toString()}`),
    refetchInterval: 30_000,
  })
}

export function useVonHalskyOrigin(orderId: string) {
  return useQuery<OrderOriginResponse>({
    queryKey: vonHalskyKeys.origin(orderId),
    queryFn: () => vonHalskyFetch<OrderOriginResponse>(`/admin/vonhalsky/medusa-orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
  })
}

function usePost<TResult, TVars = void>(path: (vars: TVars) => string, body: (vars: TVars) => unknown = () => ({})) {
  const client = useQueryClient()
  return useMutation<TResult, unknown, TVars>({
    mutationFn: (vars: TVars) => vonHalskyFetch<TResult>(path(vars), { method: "POST", body: body(vars) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: vonHalskyKeys.all }),
  })
}

export type RefreshResult = { read: number; created: number; updated: number; blocked: number; closed: number; complete: boolean }
export type ListResult = { listed: number; skipped: Array<{ id: string; reason: string }>; offers: OfferDto[] }
export type ImportOutcome = { kind: "imported" | "already" | "held" | "busy"; order: MarketplaceOrderDto }

export const useRefreshOffers = () => usePost<RefreshResult>(() => "/admin/vonhalsky/offers/refresh")
export const useListOffers = () => usePost<ListResult, string[]>(() => "/admin/vonhalsky/offers/list", (ids) => ({ ids }))
export const useUnlistOffers = () => usePost<{ closed: number }, string[]>(() => "/admin/vonhalsky/offers/unlist", (ids) => ({ ids }))
export const useReopenOffers = () => usePost<{ reopened: number }, string[]>(() => "/admin/vonhalsky/offers/reopen", (ids) => ({ ids }))
export const useSetPrice = () => usePost<{ offer: OfferDto }, { id: string; value: string | null }>((v) => `/admin/vonhalsky/offers/${encodeURIComponent(v.id)}/price`, (v) => ({ price_override: v.value }))
export const useSimulateOrder = () => usePost<ImportOutcome>(() => "/admin/vonhalsky/demo/simulate-order")
export const useImportNow = () => usePost<{ imported: number; held: number; seen: number }>(() => "/admin/vonhalsky/orders/import")
export const useRetryOrder = () => usePost<ImportOutcome, string>((id) => `/admin/vonhalsky/orders/${encodeURIComponent(id)}/retry`)
export const useResendTracking = () => usePost<{ outcome: string; order: MarketplaceOrderDto | null }, string>((id) => `/admin/vonhalsky/orders/${encodeURIComponent(id)}/tracking`)
export const useDemoShip = () => usePost<{ order: MarketplaceOrderDto }, string>((id) => `/admin/vonhalsky/orders/${encodeURIComponent(id)}/ship`)
export const useSaveSettings = () =>
  usePost<VonHalskySettings, { pricing?: { markupPercent: number }; orders?: Partial<VonHalskySettings["orders"]>; shipping?: VonHalskySettings["shipping"] }>(
    () => "/admin/vonhalsky/settings",
    (v) => v,
  )
