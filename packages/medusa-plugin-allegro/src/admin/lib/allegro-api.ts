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
  offers: (filter: AllegroOfferFilter, q: string, offset: number, limit: number) => ["allegro", "offers", filter, q, offset, limit] as const,
  orders: (filter: AllegroOrderFilter, q: string, offset: number, limit: number) => ["allegro", "orders", filter, q, offset, limit] as const,
  runs: ["allegro", "runs"] as const,
  product: (id: string) => ["allegro", "product", id] as const,
  plan: (kind: AllegroPlanKind, filter: string, q: string, offset: number, limit: number) => ["allegro", "plan", kind, filter, q, offset, limit] as const,
  imports: (filter: AllegroImportFilter, q: string, offset: number, limit: number) => ["allegro", "imports", filter, q, offset, limit] as const,
  outbox: (writer: "shipping" | "invoices", status: string, offset: number, limit: number) => ["allegro", "outbox", writer, status, offset, limit] as const,
  issues: (filter: AllegroIssueFilter, offset: number, limit: number) => ["allegro", "issues", filter, offset, limit] as const,
}

function anyRunning(data: AllegroStatusResponse | undefined): boolean {
  return Boolean(data && Object.values(data.running).some(Boolean))
}

/** Status of the Allegro page. Polls while something runs, and for a while after a click. */
export function useAllegroStatus(pollUntil: number) {
  return useQuery<AllegroStatusResponse>({
    queryKey: allegroKeys.status,
    queryFn: () => allegroFetch<AllegroStatusResponse>("/admin/allegro"),
    refetchInterval: (query) => (anyRunning(query.state.data) || Date.now() < pollUntil ? 2_000 : false),
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
