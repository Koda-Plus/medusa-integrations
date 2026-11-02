import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  DemoResetResponse,
  DemoSeedResponse,
  OrderDpdResponse,
  ShipmentFilter,
  ShipmentsResponse,
  StatusResponse,
  WriterRequest,
  WritersResponse,
} from "../../modules/dpd/lib/contract"

import { backendUrl, kitRequestInit } from "./dpd-kit"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export class DpdRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "DpdRequestError"
    this.status = status
    this.code = code
  }
}

export async function dpdFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    const body = (json && typeof json === "object" ? json : {}) as { message?: unknown; code?: unknown }
    throw new DpdRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const dpdKeys = {
  all: ["dpd"] as const,
  status: ["dpd", "status"] as const,
  shipments: (filter: ShipmentFilter, q: string, offset: number, limit: number) => ["dpd", "shipments", filter, q, offset, limit] as const,
  order: (id: string) => ["dpd", "order", id] as const,
}

export function useDpdStatus() {
  return useQuery<StatusResponse>({
    queryKey: dpdKeys.status,
    queryFn: () => dpdFetch<StatusResponse>("/admin/dpd"),
    refetchInterval: 60_000,
  })
}

export function useDpdShipments(filter: ShipmentFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<ShipmentsResponse>({
    queryKey: dpdKeys.shipments(filter, q, offset, limit),
    queryFn: () => dpdFetch<ShipmentsResponse>(`/admin/dpd/shipments?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useDpdOrder(orderId: string) {
  return useQuery<OrderDpdResponse>({
    queryKey: dpdKeys.order(orderId),
    queryFn: () => dpdFetch<OrderDpdResponse>(`/admin/dpd/orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
  })
}

/** Arm or disarm one writer; the answer carries every writer, so the page header and Settings change at once. */
export function useDpdWriter() {
  const client = useQueryClient()
  return useMutation<WritersResponse, unknown, WriterRequest>({
    mutationFn: (body) => dpdFetch<WritersResponse>("/admin/dpd/writers", { method: "POST", body }),
    onSuccess: (data) => {
      client.setQueryData<StatusResponse>(dpdKeys.status, (old) => (old ? { ...old, writers: data.writers } : old))
      void client.invalidateQueries({ queryKey: dpdKeys.all })
    },
  })
}

function usePost<TResult>(path: string) {
  const client = useQueryClient()
  return useMutation<TResult, unknown, void>({
    mutationFn: () => dpdFetch<TResult>(path, { method: "POST", body: {} }),
    onSuccess: () => void client.invalidateQueries({ queryKey: dpdKeys.all }),
  })
}

/** Demo mode only: the sample rows, built once on the first visit (reads never write). */
export const useDpdDemoSeed = () => usePost<DemoSeedResponse>("/admin/dpd/demo/seed")
/** Demo mode only: removes the demo rows and keys; the page builds the sample rows again right after. */
export const useDpdDemoReset = () => usePost<DemoResetResponse>("/admin/dpd/demo/reset")
