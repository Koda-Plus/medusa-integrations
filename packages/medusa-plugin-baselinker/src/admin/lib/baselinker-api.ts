import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ArmResponse,
  CardFilter,
  CardsResponse,
  CheckResponse,
  DemoPrepareResponse,
  ImportDto,
  ImportFilter,
  ImportsResponse,
  InvoiceDto,
  InvoiceRowStatus,
  InvoicesResponse,
  OrderByMedusaResponse,
  OrderFilter,
  OrdersResponse,
  PlanFilter,
  PlanKind,
  PlansResponse,
  ProductCardsResponse,
  ReleaseResponse,
  ReturnsResponse,
  RunningResponse,
  RunsResponse,
  SendResponse,
  StatusResponse,
  StockResponse,
  SyncResponse,
  SyncWhat,
  WriterKey,
} from "../../modules/baselinker/lib/contract"

import { backendUrl, kitRequestInit } from "./baselinker-kit"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export class BaseLinkerRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "BaseLinkerRequestError"
    this.status = status
  }
}

export async function baselinkerFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    const message = json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : `HTTP ${res.status}`
    throw new BaseLinkerRequestError(res.status, message)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const baselinkerKeys = {
  all: ["baselinker"] as const,
  status: ["baselinker", "status"] as const,
  cards: (filter: CardFilter, q: string, offset: number, limit: number) => ["baselinker", "cards", filter, q, offset, limit] as const,
  stock: (q: string, offset: number, limit: number) => ["baselinker", "stock", q, offset, limit] as const,
  orders: (filter: OrderFilter, q: string, offset: number, limit: number) => ["baselinker", "orders", filter, q, offset, limit] as const,
  runs: ["baselinker", "runs"] as const,
  running: ["baselinker", "running"] as const,
  order: (id: string) => ["baselinker", "order", id] as const,
  product: (id: string) => ["baselinker", "product", id] as const,
  plans: (kind: PlanKind, filter: PlanFilter, q: string, offset: number, limit: number) => ["baselinker", "plans", kind, filter, q, offset, limit] as const,
  imports: (filter: ImportFilter, q: string, offset: number, limit: number) => ["baselinker", "imports", filter, q, offset, limit] as const,
  returns: (q: string, offset: number, limit: number) => ["baselinker", "returns", q, offset, limit] as const,
  invoices: (filter: string, offset: number, limit: number) => ["baselinker", "invoices", filter, offset, limit] as const,
}

function hidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden"
}

/**
 * Status of the page: the full read every 30 seconds (never while the tab is
 * hidden). While a job runs, or right after an action, the light
 * `/running` read is polled instead (`useBaseLinkerRunning`), and the full
 * status is read again when what runs changes.
 */
export function useBaseLinkerStatus() {
  return useQuery<StatusResponse>({
    queryKey: baselinkerKeys.status,
    queryFn: () => baselinkerFetch<StatusResponse>("/admin/baselinker"),
    refetchInterval: () => (hidden() ? false : 30_000),
  })
}

/**
 * What runs right now in any process: two small reads every 3 seconds while
 * the status says something runs, while the answer says so, or until
 * `pollUntil` (right after an action). Never while the tab is hidden.
 */
export function useBaseLinkerRunning(statusRunning: boolean, pollUntil: number) {
  return useQuery<RunningResponse>({
    queryKey: baselinkerKeys.running,
    queryFn: () => baselinkerFetch<RunningResponse>("/admin/baselinker/running"),
    enabled: statusRunning || pollUntil > Date.now(),
    refetchInterval: (query) => {
      if (hidden()) return false
      const runningNow = (query.state.data?.running.length ?? 0) > 0
      return runningNow || statusRunning || Date.now() < pollUntil ? 3_000 : false
    },
  })
}

/** Demo mode: builds the simulated snapshot now instead of waiting for the demo job. */
export function useBaseLinkerDemoPrepare() {
  const client = useQueryClient()
  return useMutation<DemoPrepareResponse, Error, void>({
    mutationFn: () => baselinkerFetch<DemoPrepareResponse>("/admin/baselinker/demo/prepare", { method: "POST", body: {} }),
    onSuccess: (data) => {
      client.setQueryData(baselinkerKeys.status, data.status)
      void client.invalidateQueries({ queryKey: baselinkerKeys.all, predicate: (q) => q.queryKey[1] !== "status" })
    },
  })
}

function params(values: Record<string, string | number>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== "" && v !== undefined) p.set(k, String(v))
  return p.toString()
}

export function useBaseLinkerCards(filter: CardFilter, q: string, offset: number, limit: number) {
  return useQuery<CardsResponse>({
    queryKey: baselinkerKeys.cards(filter, q, offset, limit),
    queryFn: () => baselinkerFetch<CardsResponse>(`/admin/baselinker/products?${params({ filter, q, offset, limit })}`),
    placeholderData: (previous) => previous,
  })
}

export function useBaseLinkerStock(q: string, offset: number, limit: number) {
  return useQuery<StockResponse>({
    queryKey: baselinkerKeys.stock(q, offset, limit),
    queryFn: () => baselinkerFetch<StockResponse>(`/admin/baselinker/stock?${params({ q, offset, limit })}`),
    placeholderData: (previous) => previous,
  })
}

export function useBaseLinkerOrders(filter: OrderFilter, q: string, offset: number, limit: number, poll: boolean) {
  return useQuery<OrdersResponse>({
    queryKey: baselinkerKeys.orders(filter, q, offset, limit),
    queryFn: () => baselinkerFetch<OrdersResponse>(`/admin/baselinker/orders?${params({ filter, q, offset, limit })}`),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => {
      const pending = (query.state.data?.orders ?? []).some((o) => o.status === "pending")
      return poll || pending ? 4_000 : 30_000
    },
  })
}

export function useBaseLinkerRuns(poll: boolean) {
  return useQuery<RunsResponse>({
    queryKey: baselinkerKeys.runs,
    queryFn: () => baselinkerFetch<RunsResponse>("/admin/baselinker/runs?limit=15"),
    refetchInterval: poll ? 4_000 : 30_000,
  })
}

/**
 * How soon the order widget asks again: every 3 seconds only during the
 * first two minutes of a send, then around the next attempt (from 30
 * seconds to 5 minutes, the queue backs off up to hours), never once the
 * row is done, and never while the tab is hidden.
 */
export function orderPollInterval(data: OrderByMedusaResponse | undefined, now = Date.now()): number | false {
  const row = data?.order
  if (!row) return false
  if (row.status === "pending") {
    const created = row.createdAt ? new Date(row.createdAt).getTime() : now
    if (row.attempts <= 1 && now - created < 2 * 60_000) return 3_000
    const next = row.nextAttemptAt ? new Date(row.nextAttemptAt).getTime() - now : 30_000
    return Math.min(5 * 60_000, Math.max(30_000, Number.isFinite(next) ? next + 5_000 : 30_000))
  }
  if (data?.mode === "demo" && row.status === "sent" && !row.trackingNumber) return 30_000
  return false
}

/** The order widget. Polls while the order waits in the queue or travels through the simulated warehouse. */
export function useBaseLinkerOrder(orderId: string) {
  return useQuery<OrderByMedusaResponse>({
    queryKey: baselinkerKeys.order(orderId),
    queryFn: () => baselinkerFetch<OrderByMedusaResponse>(`/admin/baselinker/orders/by-medusa/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
    refetchInterval: (query) => (hidden() ? false : orderPollInterval(query.state.data)),
  })
}

export function useBaseLinkerProductCards(productId: string) {
  return useQuery<ProductCardsResponse>({
    queryKey: baselinkerKeys.product(productId),
    queryFn: () => baselinkerFetch<ProductCardsResponse>(`/admin/baselinker/products/by-medusa/${encodeURIComponent(productId)}`),
    enabled: Boolean(productId),
  })
}

export function useBaseLinkerSync() {
  const client = useQueryClient()
  return useMutation<SyncResponse, Error, SyncWhat>({
    mutationFn: (what) => baselinkerFetch<SyncResponse>("/admin/baselinker/sync", { method: "POST", body: { what } }),
    onSuccess: () => client.invalidateQueries({ queryKey: baselinkerKeys.status }),
  })
}

/* ---- 0.2 ------------------------------------------------------------ */

export function useBaseLinkerPlans(kind: PlanKind, filter: PlanFilter, q: string, offset: number, limit: number, enabled = true) {
  return useQuery<PlansResponse>({
    queryKey: baselinkerKeys.plans(kind, filter, q, offset, limit),
    queryFn: () => baselinkerFetch<PlansResponse>(`/admin/baselinker/plans?${params({ kind, filter, q, offset, limit })}`),
    placeholderData: (previous) => previous,
    enabled,
  })
}

export function useBaseLinkerImports(filter: ImportFilter, q: string, offset: number, limit: number, poll: boolean) {
  return useQuery<ImportsResponse>({
    queryKey: baselinkerKeys.imports(filter, q, offset, limit),
    queryFn: () => baselinkerFetch<ImportsResponse>(`/admin/baselinker/imports?${params({ filter, q, offset, limit })}`),
    placeholderData: (previous) => previous,
    refetchInterval: poll ? 4_000 : 30_000,
  })
}

export function useBaseLinkerReturns(q: string, offset: number, limit: number) {
  return useQuery<ReturnsResponse>({
    queryKey: baselinkerKeys.returns(q, offset, limit),
    queryFn: () => baselinkerFetch<ReturnsResponse>(`/admin/baselinker/returns?${params({ q, offset, limit })}`),
    placeholderData: (previous) => previous,
  })
}

export function useBaseLinkerInvoices(filter: InvoiceRowStatus | "all", offset: number, limit: number) {
  return useQuery<InvoicesResponse>({
    queryKey: baselinkerKeys.invoices(filter, offset, limit),
    queryFn: () => baselinkerFetch<InvoicesResponse>(`/admin/baselinker/invoices?${params({ filter, offset, limit })}`),
    placeholderData: (previous) => previous,
  })
}

/** Arm or disarm one writer; the answer carries the whole status, so the page updates at once. */
export function useBaseLinkerArm() {
  const client = useQueryClient()
  return useMutation<ArmResponse, Error, { key: WriterKey; armed: boolean }>({
    mutationFn: ({ key, armed }) => baselinkerFetch<ArmResponse>(`/admin/baselinker/writers/${key}`, { method: "POST", body: { armed } }),
    onSuccess: (data) => {
      client.setQueryData(baselinkerKeys.status, data.status)
      void client.invalidateQueries({ queryKey: baselinkerKeys.all, predicate: (q) => q.queryKey[1] !== "status" })
    },
  })
}

/** Demo mode only: look at the other direction of the simulation. */
export function useBaseLinkerDirections() {
  const client = useQueryClient()
  return useMutation<StatusResponse, Error, { catalog?: "medusa" | "baselinker"; stock?: "baselinker" | "medusa" }>({
    mutationFn: (body) => baselinkerFetch<StatusResponse>("/admin/baselinker/directions", { method: "POST", body }),
    onSuccess: (data) => client.setQueryData(baselinkerKeys.status, data),
  })
}

export function useBaseLinkerRelease() {
  const client = useQueryClient()
  return useMutation<ReleaseResponse, Error, string>({
    mutationFn: (id) => baselinkerFetch<ReleaseResponse>(`/admin/baselinker/quarantine/${encodeURIComponent(id)}/release`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: baselinkerKeys.all }),
  })
}

export function useBaseLinkerImportNow() {
  const client = useQueryClient()
  return useMutation<{ import: ImportDto }, Error, string>({
    mutationFn: (id) => baselinkerFetch<{ import: ImportDto }>(`/admin/baselinker/imports/${encodeURIComponent(id)}/import`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: baselinkerKeys.all }),
  })
}

export function useBaseLinkerInvoiceRetry() {
  const client = useQueryClient()
  return useMutation<{ invoice: InvoiceDto }, Error, string>({
    mutationFn: (id) => baselinkerFetch<{ invoice: InvoiceDto }>(`/admin/baselinker/invoices/${encodeURIComponent(id)}/retry`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: baselinkerKeys.all }),
  })
}

export function useBaseLinkerCheck() {
  const client = useQueryClient()
  return useMutation<CheckResponse, Error, void>({
    mutationFn: () => baselinkerFetch<CheckResponse>("/admin/baselinker/check", { method: "POST", body: {} }),
    onSuccess: (data) => client.setQueryData(baselinkerKeys.status, data.status),
  })
}

/** "Send to BaseLinker now" and "Send again". The argument is the Medusa order id. */
export function useBaseLinkerSend() {
  const client = useQueryClient()
  return useMutation<SendResponse, Error, string>({
    mutationFn: (orderId) => baselinkerFetch<SendResponse>(`/admin/baselinker/orders/${encodeURIComponent(orderId)}/send`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: baselinkerKeys.all }),
  })
}
