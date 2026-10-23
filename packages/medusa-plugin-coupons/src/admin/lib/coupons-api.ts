import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  CreateResponse,
  CustomerCouponsResponse,
  CustomerHit,
  DetailResponse,
  ListResponse,
  LookupsResponse,
  OrderCouponsResponse,
  PoolProductsResponse,
  ProductCouponsResponse,
  CouponPatch,
  UpdateResponse,
  DuplicateInput,
  WizardInput,
  CodeMailInput,
  CodeMailPreviewResponse,
  CodeMailResponse,
  CodeMailSendResponse,
  DeleteResponse,
} from "../../modules/coupons/lib/contract"
import { kitFetch } from "./coupons-kit"

/** An error of the plugin's routes, with the creator's error keys when there are any. */
export class CouponsRequestError extends Error {
  readonly status: number
  readonly errors: string[]
  constructor(status: number, message: string, errors: string[]) {
    super(message)
    this.name = "CouponsRequestError"
    this.status = status
    this.errors = errors
  }
}

/* The kit's fetch: backend URL, session or JWT, the write header; its error keeps the body, which holds the creator's error keys. */
async function call<T>(path: string, init?: { method?: "GET" | "POST" | "DELETE"; body?: unknown }): Promise<T> {
  try {
    return await kitFetch<T>(path, init)
  } catch (err) {
    const e = err as { status?: number; message?: string; body?: unknown; json?: unknown }
    const body = (e.body ?? e.json ?? {}) as { errors?: unknown }
    throw new CouponsRequestError(Number(e.status ?? 0), e.message ?? String(err), Array.isArray(body.errors) ? (body.errors as string[]) : [])
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const KEY = ["koda-coupons"] as const

export function useCoupons() {
  return useQuery({ queryKey: [...KEY, "list"], queryFn: () => call<ListResponse>("/admin/coupons"), placeholderData: keepPreviousData })
}

export function useCoupon(id: string | null) {
  return useQuery({ queryKey: [...KEY, "detail", id], queryFn: () => call<DetailResponse>(`/admin/coupons/${id}`), enabled: Boolean(id) })
}

export function useLookups(enabled: boolean) {
  return useQuery({ queryKey: [...KEY, "lookups"], queryFn: () => call<LookupsResponse>("/admin/coupons/lookups"), enabled, staleTime: 60_000 })
}

/** The products of each picked pool (one row per variant), by pool id; a pool still loading is missing from the map. */
export function usePoolProducts(poolIds: readonly string[], enabled: boolean) {
  const results = useQueries({
    queries: poolIds.map((id) => ({
      queryKey: [...KEY, "pool-products", id],
      queryFn: () => call<PoolProductsResponse>(`/admin/coupons/lookups/pool-products?pool=${encodeURIComponent(id)}`),
      enabled,
      staleTime: 60_000,
    })),
  })
  const byPool: Record<string, PoolProductsResponse> = {}
  results.forEach((r, i) => {
    if (r.data) byPool[poolIds[i]] = r.data
  })
  return { byPool, loading: results.some((r) => r.isLoading) }
}

export function useCustomerSearch(q: string) {
  const term = q.trim()
  return useQuery({
    queryKey: [...KEY, "customers", term],
    queryFn: () => call<{ customers: CustomerHit[] }>(`/admin/coupons/lookups/customers?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: 30_000,
  })
}

export function useCreateCoupon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WizardInput) => call<CreateResponse>("/admin/coupons", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateCoupon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: CouponPatch }) => call<UpdateResponse>(`/admin/coupons/${v.id}`, { method: "POST", body: { patch: v.patch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDuplicateCoupon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string } & DuplicateInput) => call<CreateResponse>(`/admin/coupons/${v.id}/duplicate`, { method: "POST", body: { code: v.code, patch: v.patch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useSetStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; status: "active" | "inactive" }) => call<{ coupon: unknown }>(`/admin/coupons/${v.id}`, { method: "POST", body: { status: v.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useOrderCoupons(id: string | undefined) {
  return useQuery({ queryKey: [...KEY, "order", id], queryFn: () => call<OrderCouponsResponse>(`/admin/coupons/for/order/${id}`), enabled: Boolean(id) })
}

export function useCustomerCoupons(id: string | undefined) {
  return useQuery({ queryKey: [...KEY, "customer", id], queryFn: () => call<CustomerCouponsResponse>(`/admin/coupons/for/customer/${id}`), enabled: Boolean(id) })
}

export function useProductCoupons(id: string | undefined) {
  return useQuery({ queryKey: [...KEY, "product", id], queryFn: () => call<ProductCouponsResponse>(`/admin/coupons/for/product/${id}`), enabled: Boolean(id) })
}

/** Deletes a coupon nobody used; the server answers 409 (errors ["used"]) otherwise. */
export function useDeleteCoupon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => call<DeleteResponse>(`/admin/coupons/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

/** Who is on the coupon and who got its code by e-mail. */
export function useCodeMail(id: string | null) {
  return useQuery({ queryKey: [...KEY, "code-mail", id], queryFn: () => call<CodeMailResponse>(`/admin/coupons/${id}/code-mail`), enabled: Boolean(id) })
}

/** The e-mail rendered by the store for the first person; sends nothing. */
export function usePreviewCodeMail() {
  return useMutation({
    mutationFn: (v: { id: string } & CodeMailInput) => call<CodeMailPreviewResponse>(`/admin/coupons/${v.id}/code-mail/preview`, { method: "POST", body: { customerIds: v.customerIds, message: v.message } }),
  })
}

export function useSendCodeMail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string } & CodeMailInput) => call<CodeMailSendResponse>(`/admin/coupons/${v.id}/code-mail`, { method: "POST", body: { customerIds: v.customerIds, message: v.message } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
