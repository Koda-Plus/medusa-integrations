import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { OfferState } from "../../modules/ceneo/lib/constants"
import type {
  ApiCheckResult,
  CategoryMapResponse,
  CeneoOrderDetailResponse,
  CeneoOrderLinkResponse,
  CpcResponse,
  CpcRunResult,
  CeneoOrdersResponse,
  KupTerazRunResult,
  WritersResponse,
  OrderSyncResult,
  CategorySyncResult,
  CeneoCategorySearchResponse,
  FeedBuildAnswer,
  OffersResponse,
  ProductCeneoResponse,
  StatusResponse,
} from "../../modules/ceneo/lib/contract"
import { backendUrl, kitFetch } from "./ceneo-kit"

/** The admin API of the plugin, with the dashboard's own auth (kit). */
export const ceneoFetch = kitFetch

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const ceneoKeys = {
  all: ["ceneo"] as const,
  status: ["ceneo", "status"] as const,
  offers: (state: OfferState | null, q: string, offset: number) => ["ceneo", "offers", state ?? "all", q, offset] as const,
  categoryMap: ["ceneo", "category-map"] as const,
  search: (q: string) => ["ceneo", "category-search", q] as const,
  product: (id: string) => ["ceneo", "product", id] as const,
  orders: (q: string, filter: OrderFilter, offset: number) => ["ceneo", "orders", q, filter, offset] as const,
  link: (medusaOrderId: string) => ["ceneo", "link", medusaOrderId] as const,
  cpc: (q: string, offset: number) => ["ceneo", "cpc", q, offset] as const,
  order: (id: string) => ["ceneo", "order", id] as const,
}

export const OFFERS_PAGE = 25

export function useCeneoOffers(state: OfferState | null, q: string, offset: number) {
  const params = new URLSearchParams({ limit: String(OFFERS_PAGE), offset: String(offset) })
  if (state) params.set("state", state)
  if (q) params.set("q", q)
  return useQuery<OffersResponse>({
    queryKey: ceneoKeys.offers(state, q, offset),
    queryFn: () => ceneoFetch<OffersResponse>(`/admin/ceneo/offers?${params.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

export function useCategoryMap() {
  return useQuery<CategoryMapResponse>({
    queryKey: ceneoKeys.categoryMap,
    queryFn: () => ceneoFetch<CategoryMapResponse>("/admin/ceneo/category-map"),
    staleTime: 30_000,
  })
}

export function useCeneoCategorySearch(q: string) {
  return useQuery<CeneoCategorySearchResponse>({
    queryKey: ceneoKeys.search(q),
    queryFn: () => ceneoFetch<CeneoCategorySearchResponse>(`/admin/ceneo/categories?${new URLSearchParams({ q, limit: "30" }).toString()}`),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  })
}

export function useProductCeneo(id: string) {
  return useQuery<ProductCeneoResponse>({
    queryKey: ceneoKeys.product(id),
    queryFn: () => ceneoFetch<ProductCeneoResponse>(`/admin/ceneo/products/${encodeURIComponent(id)}`),
    staleTime: 30_000,
  })
}

export function useSetCategoryMap() {
  const qc = useQueryClient()
  return useMutation<unknown, unknown, { category_id: string; ceneo_id: string | null }>({
    mutationFn: (body) => ceneoFetch("/admin/ceneo/category-map", { method: "POST", body }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

export function useSyncCategories() {
  const qc = useQueryClient()
  return useMutation<CategorySyncResult, unknown, void>({
    mutationFn: () => ceneoFetch<CategorySyncResult>("/admin/ceneo/categories/sync", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

export function useTakeOver() {
  const qc = useQueryClient()
  return useMutation<unknown, unknown, string>({
    mutationFn: (rowId) => ceneoFetch(`/admin/ceneo/offers/${encodeURIComponent(rowId)}/take-over`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

export function useCeneoStatus() {
  return useQuery<StatusResponse>({
    queryKey: ceneoKeys.status,
    queryFn: () => ceneoFetch<StatusResponse>("/admin/ceneo"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

/** Builds the feed now; the status refreshes after it. */
export function useBuildFeed() {
  const qc = useQueryClient()
  return useMutation<FeedBuildAnswer, unknown, void>({
    mutationFn: () => ceneoFetch<FeedBuildAnswer>("/admin/ceneo/feed", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

/** The absolute feed address to paste into Panel Ceneo: the backend the dashboard talks to, or this origin. */
export function feedUrl(path: string): string {
  const base = backendUrl() || (typeof window !== "undefined" ? window.location.origin : "")
  return `${base}${path}`
}

export const ORDERS_PAGE = 25
export type OrderFilter = "all" | "unmatched" | "held"

export function useCeneoOrders(q: string, filter: OrderFilter, offset: number) {
  const params = new URLSearchParams({ limit: String(ORDERS_PAGE), offset: String(offset) })
  if (q) params.set("q", q)
  if (filter === "unmatched") params.set("unmatched", "true")
  if (filter === "held") params.set("held", "true")
  return useQuery<CeneoOrdersResponse>({
    queryKey: ceneoKeys.orders(q, filter, offset),
    queryFn: () => ceneoFetch<CeneoOrdersResponse>(`/admin/ceneo/orders?${params.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

/** One order with the data read from Ceneo now; never cached long (personal data). */
export function useCeneoOrder(id: string) {
  return useQuery<CeneoOrderDetailResponse>({
    queryKey: ceneoKeys.order(id),
    queryFn: () => ceneoFetch<CeneoOrderDetailResponse>(`/admin/ceneo/orders/${encodeURIComponent(id)}`),
    staleTime: 0,
    gcTime: 60_000,
  })
}

export function useSyncOrders() {
  const qc = useQueryClient()
  return useMutation<OrderSyncResult, unknown, void>({
    mutationFn: () => ceneoFetch<OrderSyncResult>("/admin/ceneo/orders/sync", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

/** A read, run on click: a fresh token proves the key, then the limits. */
export function useApiCheck() {
  return useMutation<ApiCheckResult, unknown, void>({
    mutationFn: () => ceneoFetch<ApiCheckResult>("/admin/ceneo/api"),
  })
}

/** Import into Medusa and the writes to Ceneo, now. */
export function useRunImport() {
  const qc = useQueryClient()
  return useMutation<KupTerazRunResult, unknown, void>({
    mutationFn: () => ceneoFetch<KupTerazRunResult>("/admin/ceneo/orders/import", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

/** A held or failed import back to the queue. */
export function useRetryImport() {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, unknown, string>({
    mutationFn: (id) => ceneoFetch<{ ok: true }>(`/admin/ceneo/orders/${encodeURIComponent(id)}/retry`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

/** Arms or disarms a writer; a refusal comes back as an error with the reason. */
export function useSetWriter() {
  const qc = useQueryClient()
  return useMutation<WritersResponse, unknown, { key: string; armed: boolean }>({
    mutationFn: (body) => ceneoFetch<WritersResponse>("/admin/ceneo/writers", { method: "POST", body }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

/** The Kup Teraz order behind a Medusa order (the order page widget). */
export function useCeneoOrderLink(medusaOrderId: string) {
  return useQuery<CeneoOrderLinkResponse>({
    queryKey: ceneoKeys.link(medusaOrderId),
    queryFn: () => ceneoFetch<CeneoOrderLinkResponse>(`/admin/ceneo/medusa-orders/${encodeURIComponent(medusaOrderId)}`),
    staleTime: 15_000,
  })
}

export const CPC_PAGE = 25

/** Bid rows of the current mode, with the category rows. */
export function useCeneoCpc(q: string, offset: number) {
  const params = new URLSearchParams({ limit: String(CPC_PAGE), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<CpcResponse>({
    queryKey: ceneoKeys.cpc(q, offset),
    queryFn: () => ceneoFetch<CpcResponse>(`/admin/ceneo/cpc?${params.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

/** Targets in grosze and promotion texts; the plan is recomputed on the server. */
export function useSetTargets() {
  const qc = useQueryClient()
  return useMutation<{ updated: number }, unknown, { items: Array<{ kind: "product" | "category"; key: string; targetBid?: number | null; promoText?: string | null }> }>({
    mutationFn: (body) => ceneoFetch<{ updated: number }>("/admin/ceneo/cpc", { method: "POST", body }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

export function useRunCpc() {
  const qc = useQueryClient()
  return useMutation<CpcRunResult, unknown, void>({
    mutationFn: () => ceneoFetch<CpcRunResult>("/admin/ceneo/cpc/run", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}
