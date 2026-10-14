import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  CreateResponse,
  CustomerCouponsResponse,
  CustomerHit,
  DetailResponse,
  ListResponse,
  LookupsResponse,
  OrderCouponsResponse,
  ProductCouponsResponse,
  WizardInput,
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
async function call<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
