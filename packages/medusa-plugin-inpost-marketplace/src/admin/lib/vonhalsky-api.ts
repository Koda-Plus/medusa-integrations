import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AttributesResponse,
  ClaimResolution,
  PromotionInput,
  PromotionMode,
  SyncPart,
  SyncReport,
  CaseDetailResponse,
  CaseDto,
  CaseFilter,
  CasesResponse,
  CategoriesResponse,
  CategoryMapResponse,
  CheckResponse,
  HintResponse,
  LogResponse,
  MarketplaceOrderDto,
  OfferDefaults,
  OfferDto,
  OfferFilter,
  OrderFilter,
  OrderOriginResponse,
  OrdersResponse,
  OffersResponse,
  StatsResponse,
  StatusResponse,
  VonHalskySettings,
} from "../../modules/vonhalsky/lib/contract"
import type { TrackingStatus } from "../../modules/vonhalsky/lib/constants"
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
  cases: (filter: CaseFilter, q: string, offset: number) => ["vonhalsky", "cases", filter, q, offset] as const,
  case: (id: string) => ["vonhalsky", "case", id] as const,
  stats: (days: number) => ["vonhalsky", "stats", days] as const,
  categories: (q: string, leaf: boolean) => ["vonhalsky", "categories", q, leaf] as const,
  categoryMap: ["vonhalsky", "category-map"] as const,
  attributes: (categoryId: string, fresh: boolean) => ["vonhalsky", "attributes", categoryId, fresh] as const,
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

export function useVonHalskyCases(filter: CaseFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<CasesResponse>({
    queryKey: vonHalskyKeys.cases(filter, q, offset),
    queryFn: () => vonHalskyFetch<CasesResponse>(`/admin/vonhalsky/cases?${params.toString()}`),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
  })
}

/** One case read live from the marketplace (the buyer contact is shown, never stored). */
export function useVonHalskyCase(id: string | null) {
  return useQuery<CaseDetailResponse>({
    queryKey: vonHalskyKeys.case(id ?? ""),
    queryFn: () => vonHalskyFetch<CaseDetailResponse>(`/admin/vonhalsky/cases/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id),
  })
}

export function useVonHalskyStats(days: number) {
  return useQuery<StatsResponse>({
    queryKey: vonHalskyKeys.stats(days),
    queryFn: () => vonHalskyFetch<StatsResponse>(`/admin/vonhalsky/stats?days=${days}`),
    placeholderData: (previous) => previous,
  })
}

/** The marketplace category tree as the last sync saved it; `q` finds a part of the path. */
export function useVonHalskyCategories(q: string, leaf: boolean, enabled = true) {
  const params = new URLSearchParams({ limit: "30" })
  if (q) params.set("q", q)
  if (leaf) params.set("leaf", "1")
  return useQuery<CategoriesResponse>({
    queryKey: vonHalskyKeys.categories(q, leaf),
    queryFn: () => vonHalskyFetch<CategoriesResponse>(`/admin/vonhalsky/categories?${params.toString()}`),
    placeholderData: (previous) => previous,
    enabled,
  })
}

export function useVonHalskyCategoryMap() {
  return useQuery<CategoryMapResponse>({
    queryKey: vonHalskyKeys.categoryMap,
    queryFn: () => vonHalskyFetch<CategoryMapResponse>("/admin/vonhalsky/categories/map"),
  })
}

/** The parameters of a marketplace leaf category (kept 7 days by the server; `fresh` reads them again). */
export function useVonHalskyAttributes(categoryId: string | null, fresh: boolean) {
  return useQuery<AttributesResponse>({
    queryKey: vonHalskyKeys.attributes(categoryId ?? "", fresh),
    queryFn: () => vonHalskyFetch<AttributesResponse>(`/admin/vonhalsky/categories/${encodeURIComponent(categoryId ?? "")}/attributes${fresh ? "?fresh=1" : ""}`),
    enabled: Boolean(categoryId),
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

const enc = encodeURIComponent

export type RefreshResult = { read: number; created: number; updated: number; blocked: number; closed: number; complete: boolean }
export type ListResult = { listed: number; skipped: Array<{ id: string; reason: string }>; offers: OfferDto[] }
export type ImportOutcome = { kind: "imported" | "already" | "held" | "busy"; order: MarketplaceOrderDto }

/* The parts of the sync in the order the panel shows them; the types are the server's (contract.ts). */
export type { SyncPart, SyncReport, PromotionMode, PromotionInput, ClaimResolution }
export const SYNC_PARTS: readonly SyncPart[] = ["commands", "offers", "push", "orders", "cases", "categories", "snapshot"]
export type AttributeValues = OfferDto["attributes"]

export type SettingsInput = {
  pricing?: { markupPercent: number }
  orders?: Partial<VonHalskySettings["orders"]>
  shipping?: VonHalskySettings["shipping"]
  /** Medusa category id to a marketplace leaf; merged by the server, null removes one. */
  categories?: Record<string, string | null>
  offer_defaults?: Partial<OfferDefaults>
}

export const useRefreshOffers = () => usePost<RefreshResult>(() => "/admin/vonhalsky/offers/refresh")
export const useListOffers = () => usePost<ListResult, string[]>(() => "/admin/vonhalsky/offers/list", (ids) => ({ ids }))
export const useUnlistOffers = () => usePost<{ closed: number }, string[]>(() => "/admin/vonhalsky/offers/unlist", (ids) => ({ ids }))
export const useReopenOffers = () => usePost<{ reopened: number }, string[]>(() => "/admin/vonhalsky/offers/reopen", (ids) => ({ ids }))
export const useSetPrice = () => usePost<{ offer: OfferDto }, { id: string; value: string | null }>((v) => `/admin/vonhalsky/offers/${enc(v.id)}/price`, (v) => ({ price_override: v.value }))
export const useHintOffer = () => usePost<HintResponse, string>((id) => `/admin/vonhalsky/offers/${enc(id)}/hint`)
export const useSetOfferCategory = () => usePost<{ updated: number }, { ids: string[]; categoryId: string | null }>(() => "/admin/vonhalsky/offers/category", (v) => v)
export const useSetOfferAttributes = () => usePost<OfferDto, { id: string; attributes: AttributeValues }>((v) => `/admin/vonhalsky/offers/${enc(v.id)}/attributes`, (v) => ({ attributes: v.attributes }))
export const useSetPromotion = () => usePost<{ sent: number; failed: number }, { ids: string[]; promotion: PromotionInput | null }>(() => "/admin/vonhalsky/offers/promotion", (v) => v)
export const useSetProgram = () => usePost<{ sent: number }, { ids: string[]; mode: "IN" | "OUT" }>(() => "/admin/vonhalsky/offers/program", (v) => v)
export const useSimulateOrder = () => usePost<ImportOutcome>(() => "/admin/vonhalsky/demo/simulate-order")
export const useSimulateCase = () => usePost<CaseDto, "return" | "claim">(() => "/admin/vonhalsky/demo/simulate-case", (kind) => ({ kind }))
export const useImportNow = () => usePost<{ imported: number; held: number; seen: number }>(() => "/admin/vonhalsky/orders/import")
export const useRetryOrder = () => usePost<ImportOutcome, string>((id) => `/admin/vonhalsky/orders/${enc(id)}/retry`)
export const useCheckTracking = () => usePost<{ outcome: TrackingStatus; order: MarketplaceOrderDto | null }, string>((id) => `/admin/vonhalsky/orders/${enc(id)}/tracking`)
export const useDemoShip = () => usePost<{ order: MarketplaceOrderDto }, string>((id) => `/admin/vonhalsky/orders/${enc(id)}/ship`)
export const useRefundOrder = () =>
  usePost<{ refundId: string | null; status: string | null }, { id: string; amount: string | null }>(
    (v) => `/admin/vonhalsky/orders/${enc(v.id)}/refund`,
    (v) => (v.amount === null ? {} : { amount: v.amount }),
  )
export const useAcceptReturn = () => usePost<CaseDto, { id: string; amount: string }>((v) => `/admin/vonhalsky/cases/${enc(v.id)}/accept`, (v) => ({ amount: v.amount }))
export const useRejectReturn = () => usePost<CaseDto, { id: string; reasonId: string }>((v) => `/admin/vonhalsky/cases/${enc(v.id)}/reject`, (v) => ({ reasonId: v.reasonId }))
export const useResolveClaim = () =>
  usePost<CaseDto, { id: string; how: ClaimResolution; description: string }>((v) => `/admin/vonhalsky/cases/${enc(v.id)}/resolve`, (v) => ({ how: v.how, description: v.description }))
export const useRetryRefund = () => usePost<CaseDto, string>((id) => `/admin/vonhalsky/cases/${enc(id)}/retry`)
export const useCheckConnection = () => usePost<CheckResponse>(() => "/admin/vonhalsky/check")
export const useSyncNow = () => usePost<{ report: SyncReport }>(() => "/admin/vonhalsky/sync")
export const useSyncCategories = () => usePost<{ count: number; leaves: number; removed: number }>(() => "/admin/vonhalsky/categories/sync")
export const useSaveSettings = () => usePost<VonHalskySettings, SettingsInput>(() => "/admin/vonhalsky/settings", (v) => v)
