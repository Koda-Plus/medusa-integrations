import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { StatusResponse } from "../../modules/loyalty/lib/contract"

declare const __BACKEND_URL__: string | undefined

/** Same origin by default; the admin build defines `__BACKEND_URL__` when the backend lives elsewhere. */
export function backendUrl(): string {
  try {
    if (typeof __BACKEND_URL__ !== "undefined" && __BACKEND_URL__) return String(__BACKEND_URL__).replace(/\/+$/, "")
  } catch {
    /* not defined in this build */
  }
  return ""
}

export class LoyaltyRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "LoyaltyRequestError"
    this.status = status
    this.code = code
  }
}

export async function loyaltyFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    const body = (json && typeof json === "object" ? json : {}) as { message?: unknown; code?: unknown }
    throw new LoyaltyRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const loyaltyKeys = {
  all: ["loyalty"] as const,
  status: ["loyalty", "status"] as const,
}

export function useLoyaltyStatus() {
  return useQuery<StatusResponse>({
    queryKey: loyaltyKeys.status,
    queryFn: () => loyaltyFetch<StatusResponse>("/admin/loyalty"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

function useRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: loyaltyKeys.all })
}

export function useAdjust() {
  const refresh = useRefresh()
  return useMutation<{ balance: number }, Error, Record<string, unknown>>({
    mutationFn: (body) => loyaltyFetch("/admin/loyalty/adjust", { method: "POST", body }),
    onSuccess: refresh,
  })
}

/* ------------------------------------------------------------------ */
/* Customer search (Medusa's own admin routes)                         */
/* ------------------------------------------------------------------ */

export interface FoundCustomer {
  id: string
  label: string
  sub: string | null
}

export function useCustomerSearch(q: string, enabled: boolean) {
  return useQuery<FoundCustomer[]>({
    queryKey: ["loyalty", "customers", q],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "6", fields: "id,email,company_name" })
      if (q) params.set("q", q)
      const res = await loyaltyFetch<{ customers?: Array<{ id: string; email?: string | null; company_name?: string | null }> }>(`/admin/customers?${params.toString()}`)
      return (res.customers ?? [])
        .map((c) => ({ id: c.id, label: c.company_name ?? c.email ?? c.id, sub: c.company_name ? (c.email ?? null) : null }))
        .filter((c): c is FoundCustomer => Boolean(c.label))
    },
  })
}
