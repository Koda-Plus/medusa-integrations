import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ActionResponse,
  CheckResult,
  OrderInpostResponse,
  ParcelDetailResponse,
  ParcelEventDto,
  ParcelFilter,
  ParcelSize,
  ParcelsResponse,
  PlanResponse,
  PointsResponse,
  StatusResponse,
  WriterKey,
} from "../../modules/inpost/lib/contract"

import { backendUrl, kitRequestInit } from "./inpost-kit"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export class InpostRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "InpostRequestError"
    this.status = status
    this.code = code
  }
}

export async function inpostFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    throw new InpostRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The label PDF of a shipment, through the backend (the ShipX token never reaches the browser). */
export function labelUrl(id: string, size?: "A6" | "A4", download = false): string {
  const params = new URLSearchParams()
  if (size) params.set("size", size)
  if (download) params.set("download", "1")
  const q = params.toString()
  return `${backendUrl()}/admin/inpost/parcels/${encodeURIComponent(id)}/label${q ? `?${q}` : ""}`
}

export const inpostKeys = {
  all: ["inpost"] as const,
  status: ["inpost", "status"] as const,
  parcels: (filter: ParcelFilter, q: string, offset: number, limit: number) => ["inpost", "parcels", filter, q, offset, limit] as const,
  parcel: (id: string) => ["inpost", "parcel", id] as const,
  plan: (id: string) => ["inpost", "plan", id] as const,
  order: (id: string) => ["inpost", "order", id] as const,
  events: (kind: string, offset: number) => ["inpost", "events", kind, offset] as const,
  points: (q: string) => ["inpost", "points", q] as const,
}

export function useInpostStatus(pollUntil: number) {
  return useQuery<StatusResponse>({
    queryKey: inpostKeys.status,
    queryFn: () => inpostFetch<StatusResponse>("/admin/inpost"),
    refetchInterval: (query) => (query.state.data?.running || Date.now() < pollUntil ? 3_000 : 60_000),
  })
}

export function useInpostParcels(filter: ParcelFilter, q: string, offset: number, limit: number, poll = false) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<ParcelsResponse>({
    queryKey: inpostKeys.parcels(filter, q, offset, limit),
    queryFn: () => inpostFetch<ParcelsResponse>(`/admin/inpost/parcels?${params.toString()}`),
    placeholderData: (previous) => previous,
    refetchInterval: poll ? 5_000 : false,
  })
}

export function useInpostParcel(id: string | null) {
  return useQuery<ParcelDetailResponse>({
    queryKey: inpostKeys.parcel(id ?? ""),
    queryFn: () => inpostFetch<ParcelDetailResponse>(`/admin/inpost/parcels/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id),
  })
}

export function useInpostPlan(id: string | null) {
  return useQuery<PlanResponse>({
    queryKey: inpostKeys.plan(id ?? ""),
    queryFn: () => inpostFetch<PlanResponse>(`/admin/inpost/parcels/${encodeURIComponent(id ?? "")}/plan`),
    enabled: Boolean(id),
    staleTime: 0,
    gcTime: 0,
  })
}

export function useInpostOrder(orderId: string) {
  return useQuery<OrderInpostResponse>({
    queryKey: inpostKeys.order(orderId),
    queryFn: () => inpostFetch<OrderInpostResponse>(`/admin/inpost/orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
  })
}

export function useInpostEvents(kind: string, offset: number, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (kind && kind !== "all") params.set("kind", kind)
  return useQuery<{ events: ParcelEventDto[]; count: number }>({
    queryKey: inpostKeys.events(kind, offset),
    queryFn: () => inpostFetch<{ events: ParcelEventDto[]; count: number }>(`/admin/inpost/events?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useInpostPoints(q: string) {
  return useQuery<PointsResponse>({
    queryKey: inpostKeys.points(q),
    queryFn: () => inpostFetch<PointsResponse>(`/admin/inpost/points?${new URLSearchParams({ q, limit: "12" }).toString()}`),
    enabled: q.trim().length >= 2,
    retry: false,
  })
}

function usePost<TResult, TVars = void>(path: (vars: TVars) => string, body: (vars: TVars) => unknown = () => ({})) {
  const client = useQueryClient()
  return useMutation<TResult, unknown, TVars>({
    mutationFn: (vars: TVars) => inpostFetch<TResult>(path(vars), { method: "POST", body: body(vars) }),
    onSuccess: (data) => {
      if (data && typeof data === "object" && "mode" in (data as object) && "writers" in (data as object) && "counts" in (data as object)) {
        client.setQueryData(inpostKeys.status, data)
      }
      void client.invalidateQueries({ queryKey: inpostKeys.all })
    },
  })
}

const parcelPath = (id: string, action: string) => `/admin/inpost/parcels/${encodeURIComponent(id)}/${action}`

export const useInpostSync = () => usePost<{ started: boolean; alreadyRunning: boolean }>(() => "/admin/inpost/sync")
export const useInpostCheck = () => usePost<{ result: CheckResult }>(() => "/admin/inpost/check")
export const useInpostDemoReset = () => usePost<StatusResponse>(() => "/admin/inpost/demo/reset")
export const useInpostWriter = () => usePost<StatusResponse, { writer: WriterKey; on: boolean }>(() => "/admin/inpost/writers", (v) => v)
export const useInpostSettings = () => usePost<StatusResponse, Record<string, unknown>>(() => "/admin/inpost/settings", (v) => v)
export const useInpostPickup = () => usePost<{ dispatchOrderId: string | null; parcels: number }, { ids?: string[] }>(() => "/admin/inpost/pickup", (v) => v)

export const useInpostCreate = () => usePost<ActionResponse, { id: string; planHash: string }>((v) => parcelPath(v.id, "create"), (v) => ({ planHash: v.planHash }))
export const useInpostCancel = () => usePost<ActionResponse, { id: string }>((v) => parcelPath(v.id, "cancel"))
export const useInpostBuy = () => usePost<ActionResponse, { id: string }>((v) => parcelPath(v.id, "buy"))
export const useInpostRefresh = () => usePost<ActionResponse, { id: string }>((v) => parcelPath(v.id, "refresh"))
export const useInpostRetry = () => usePost<ActionResponse, { id: string }>((v) => parcelPath(v.id, "retry"))
export const useInpostLookup = () => usePost<ActionResponse, { id: string }>((v) => parcelPath(v.id, "lookup"))
export const useInpostSkip = () => usePost<ActionResponse, { id: string }>((v) => parcelPath(v.id, "skip"))
export const useInpostLink = () => usePost<ActionResponse, { id: string; shipmentId: string }>((v) => parcelPath(v.id, "link"), (v) => ({ shipmentId: v.shipmentId }))
export const useInpostLocker = () => usePost<ActionResponse, { id: string; code: string }>((v) => parcelPath(v.id, "locker"), (v) => ({ code: v.code }))
export const useInpostSize = () => usePost<ActionResponse, { id: string; size: ParcelSize }>((v) => parcelPath(v.id, "size"), (v) => ({ size: v.size }))
