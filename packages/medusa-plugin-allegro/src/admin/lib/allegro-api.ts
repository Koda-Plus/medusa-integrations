import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AllegroActionResponse,
  AllegroConnectPollResponse,
  AllegroImportFilter,
  AllegroImportRunResponse,
  AllegroImportWindowResponse,
  AllegroImportsResponse,
  AllegroIssueFilter,
  AllegroIssuesResponse,
  AllegroOfferFilter,
  AllegroOffersResponse,
  AllegroOrderCardResponse,
  AllegroOrderFilter,
  AllegroOrdersResponse,
  AllegroOutboxResponse,
  AllegroPlanKind,
  AllegroPlanResponse,
  AllegroPlanRunResponse,
  AllegroProductOffersResponse,
  AllegroRunsResponse,
  AllegroStatusResponse,
  AllegroSyncResponse,
  AllegroWriterKey,
  AllegroWriterToggleResponse,
} from "../../modules/allegro/lib/contract"

import { backendUrl, kitRequestInit } from "./allegro-kit"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export class AllegroRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.name = "AllegroRequestError"
    this.status = status
    this.code = code
  }
}

export async function allegroFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    throw new AllegroRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const allegroKeys = {
  all: ["allegro"] as const,
  status: ["allegro", "status"] as const,
  offers: (filter: AllegroOfferFilter, q: string, offset: number, limit: number) => ["allegro", "offers", filter, q, offset, limit] as const,
  orders: (filter: AllegroOrderFilter, q: string, offset: number, limit: number) => ["allegro", "orders", filter, q, offset, limit] as const,
  runs: ["allegro", "runs"] as const,
  product: (id: string) => ["allegro", "product", id] as const,
  order: (id: string) => ["allegro", "order", id] as const,
  plan: (kind: AllegroPlanKind, filter: string, q: string, offset: number, limit: number) => ["allegro", "plan", kind, filter, q, offset, limit] as const,
  imports: (filter: AllegroImportFilter, q: string, offset: number, limit: number) => ["allegro", "imports", filter, q, offset, limit] as const,
  outbox: (writer: "shipping" | "invoices", status: string, offset: number, limit: number) => ["allegro", "outbox", writer, status, offset, limit] as const,
  issues: (filter: AllegroIssueFilter, offset: number, limit: number) => ["allegro", "issues", filter, offset, limit] as const,
}

function anyRunning(data: AllegroStatusResponse | undefined): boolean {
  return Boolean(data && Object.values(data.running).some(Boolean))
}

/** Demo data still being prepared (by the job or "Prepare now"). */
function seeding(data: AllegroStatusResponse | undefined): boolean {
  return Boolean(data?.demoSeed && data.demoSeed.missing.length > 0)
}

/**
 * Status of the Allegro page. Every 5 s while something runs, for a while
 * after a click and while the demo data is prepared; never in a hidden tab
 * (React Query pauses intervals there).
 */
export function useAllegroStatus(pollUntil: number) {
  return useQuery<AllegroStatusResponse>({
    queryKey: allegroKeys.status,
    queryFn: () => allegroFetch<AllegroStatusResponse>("/admin/allegro"),
    refetchInterval: (query) => (anyRunning(query.state.data) || seeding(query.state.data) || Date.now() < pollUntil ? 5_000 : false),
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
    queryFn: () => allegroFetch<AllegroRunsResponse>("/admin/allegro/runs?limit=15"),
  })
}

export function useAllegroProductOffers(productId: string) {
  return useQuery<AllegroProductOffersResponse>({
    queryKey: allegroKeys.product(productId),
    queryFn: () => allegroFetch<AllegroProductOffersResponse>(`/admin/allegro/products/${encodeURIComponent(productId)}`),
    enabled: Boolean(productId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
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
/** Demo mode: prepare the sample data now (202, the status polls until it is there). */
export const useAllegroDemoSeed = () => usePost<{ started: boolean }>("/admin/allegro/demo/seed")
export const useAllegroDisconnect = () => usePost<AllegroStatusResponse>("/admin/allegro/disconnect")

/** One poll of the device login; the page decides when to call it again. */
export function pollAllegroConnect(): Promise<AllegroConnectPollResponse> {
  return allegroFetch<AllegroConnectPollResponse>("/admin/allegro/connect/poll", { method: "POST", body: {} })
}

/* ---- writers ------------------------------------------------------------ */

export function useAllegroWriterToggle() {
  const client = useQueryClient()
  return useMutation<AllegroWriterToggleResponse, unknown, { key: AllegroWriterKey; armed: boolean }>({
    mutationFn: ({ key, armed }) => allegroFetch<AllegroWriterToggleResponse>(`/admin/allegro/writers/${key}`, { method: "POST", body: { armed } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

/* ---- plans -------------------------------------------------------------- */

export function useAllegroPlan(kind: AllegroPlanKind, filter: string, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ kind, filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<AllegroPlanResponse>({
    queryKey: allegroKeys.plan(kind, filter, q, offset, limit),
    queryFn: () => allegroFetch<AllegroPlanResponse>(`/admin/allegro/plans?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useAllegroPlanRun() {
  const client = useQueryClient()
  return useMutation<AllegroPlanRunResponse, unknown, { kind: AllegroPlanKind; mode: "plan" | "apply" }>({
    mutationFn: (body) => allegroFetch<AllegroPlanRunResponse>("/admin/allegro/plans", { method: "POST", body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

export function useAllegroPlanRelease() {
  const client = useQueryClient()
  return useMutation<AllegroActionResponse, unknown, string>({
    mutationFn: (id) => allegroFetch<AllegroActionResponse>(`/admin/allegro/plans/${encodeURIComponent(id)}/release`, { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

/* ---- imports ------------------------------------------------------------ */

export function useAllegroImports(filter: AllegroImportFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<AllegroImportsResponse>({
    queryKey: allegroKeys.imports(filter, q, offset, limit),
    queryFn: () => allegroFetch<AllegroImportsResponse>(`/admin/allegro/imports?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useAllegroImportRun() {
  const client = useQueryClient()
  return useMutation<AllegroImportRunResponse, unknown, "plan" | "apply">({
    mutationFn: (mode) => allegroFetch<AllegroImportRunResponse>("/admin/allegro/imports", { method: "POST", body: { mode } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

export function useAllegroImportWindow() {
  const client = useQueryClient()
  return useMutation<AllegroImportWindowResponse, unknown, { from: string; to: string }>({
    mutationFn: (body) => allegroFetch<AllegroImportWindowResponse>("/admin/allegro/imports/window", { method: "POST", body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

export function useAllegroImportRetry() {
  const client = useQueryClient()
  return useMutation<AllegroActionResponse, unknown, string>({
    mutationFn: (id) => allegroFetch<AllegroActionResponse>(`/admin/allegro/imports/${encodeURIComponent(id)}/retry`, { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

/* ---- outbox ------------------------------------------------------------- */

export function useAllegroOutbox(writer: "shipping" | "invoices", status: string, offset: number, limit: number) {
  const params = new URLSearchParams({ writer, status, limit: String(limit), offset: String(offset) })
  return useQuery<AllegroOutboxResponse>({
    queryKey: allegroKeys.outbox(writer, status, offset, limit),
    queryFn: () => allegroFetch<AllegroOutboxResponse>(`/admin/allegro/outbox?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useAllegroOutboxRun() {
  const client = useQueryClient()
  return useMutation<AllegroActionResponse, unknown, "shipping" | "invoices">({
    mutationFn: (writer) => allegroFetch<AllegroActionResponse>("/admin/allegro/outbox", { method: "POST", body: { writer } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

export function useAllegroOutboxRetry() {
  const client = useQueryClient()
  return useMutation<AllegroActionResponse, unknown, string>({
    mutationFn: (id) => allegroFetch<AllegroActionResponse>(`/admin/allegro/outbox/${encodeURIComponent(id)}/retry`, { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

/* ---- the order card ----------------------------------------------------- */

/** What Allegro knows about one Medusa order (import, parcels, invoices, issues). */
export function useAllegroOrderCard(orderId: string) {
  return useQuery<AllegroOrderCardResponse>({
    queryKey: allegroKeys.order(orderId),
    queryFn: () => allegroFetch<AllegroOrderCardResponse>(`/admin/allegro/medusa-orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

/** A person checked an order that needed attention. */
export function useAllegroImportHandled() {
  const client = useQueryClient()
  return useMutation<AllegroActionResponse, unknown, string>({
    mutationFn: (id) => allegroFetch<AllegroActionResponse>(`/admin/allegro/imports/${encodeURIComponent(id)}/handled`, { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.all })
    },
  })
}

/* ---- customer issues ---------------------------------------------------- */

export function useAllegroIssues(filter: AllegroIssueFilter, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  return useQuery<AllegroIssuesResponse>({
    queryKey: allegroKeys.issues(filter, offset, limit),
    queryFn: () => allegroFetch<AllegroIssuesResponse>(`/admin/allegro/issues?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useAllegroIssuesSync() {
  const client = useQueryClient()
  return useMutation<AllegroActionResponse, unknown, void>({
    mutationFn: () => allegroFetch<AllegroActionResponse>("/admin/allegro/issues", { method: "POST", body: {} }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: allegroKeys.status })
    },
  })
}
