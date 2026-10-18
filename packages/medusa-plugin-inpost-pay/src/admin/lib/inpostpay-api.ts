import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { BasketFilter, BasketsResponse, InpostPaySettings, OrderInpostPayResponse, StatusResponse } from "../../modules/inpostpay/lib/contract"
import { backendUrl, kitRequestInit } from "./inpostpay-kit"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export class InpostPayRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "InpostPayRequestError"
    this.status = status
    this.code = code
  }
}

export async function inpostPayFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    throw new InpostPayRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const inpostPayKeys = {
  all: ["inpostpay"] as const,
  status: ["inpostpay", "status"] as const,
  baskets: (filter: BasketFilter, q: string, offset: number, limit: number) => ["inpostpay", "baskets", filter, q, offset, limit] as const,
  order: (id: string) => ["inpostpay", "order", id] as const,
}

export function useInpostPayStatus() {
  return useQuery<StatusResponse>({
    queryKey: inpostPayKeys.status,
    queryFn: () => inpostPayFetch<StatusResponse>("/admin/inpostpay"),
    refetchInterval: 30_000,
  })
}

export function useInpostPayBaskets(filter: BasketFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<BasketsResponse>({
    queryKey: inpostPayKeys.baskets(filter, q, offset, limit),
    queryFn: () => inpostPayFetch<BasketsResponse>(`/admin/inpostpay/baskets?${params.toString()}`),
    placeholderData: (previous) => previous,
    refetchInterval: 15_000,
  })
}

export function useInpostPayOrder(orderId: string) {
  return useQuery<OrderInpostPayResponse>({
    queryKey: inpostPayKeys.order(orderId),
    queryFn: () => inpostPayFetch<OrderInpostPayResponse>(`/admin/inpostpay/orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
  })
}

function usePost<TResult, TVars = void>(path: string, body: (vars: TVars) => unknown = () => ({})) {
  const client = useQueryClient()
  return useMutation<TResult, unknown, TVars>({
    mutationFn: (vars: TVars) => inpostPayFetch<TResult>(path, { method: "POST", body: body(vars) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: inpostPayKeys.all }),
  })
}

export const useInpostPaySettings = () => usePost<InpostPaySettings, Partial<InpostPaySettings>>("/admin/inpostpay/settings", (v) => v)
export const useInpostPaySeed = () => usePost<{ created: number }>("/admin/inpostpay/demo/seed")

export function useInpostPayCheck() {
  return useMutation<{ ok: boolean; mode: string; expires_in: number | null }, unknown, void>({
    mutationFn: () => inpostPayFetch("/admin/inpostpay/check"),
  })
}
