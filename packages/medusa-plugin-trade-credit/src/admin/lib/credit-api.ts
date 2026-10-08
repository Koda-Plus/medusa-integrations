import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { LimitDto, StatusResponse } from "../../modules/credit/lib/contract"

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

export class CreditRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "CreditRequestError"
    this.status = status
    this.code = code
  }
}

export async function creditFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    throw new CreditRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const creditKeys = {
  all: ["credit"] as const,
  status: ["credit", "status"] as const,
}

export function useCreditStatus() {
  return useQuery<StatusResponse>({
    queryKey: creditKeys.status,
    queryFn: () => creditFetch<StatusResponse>("/admin/credit"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

function useRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: creditKeys.all })
}

export function useSetLimit() {
  const refresh = useRefresh()
  return useMutation<{ limit: LimitDto }, Error, Record<string, unknown>>({
    mutationFn: (body) => creditFetch("/admin/credit/limits", { method: "POST", body }),
    onSuccess: refresh,
  })
}

export function useUpdateLimit() {
  const refresh = useRefresh()
  return useMutation<{ limit: LimitDto }, Error, { id: string; body: Record<string, unknown> }>({
    mutationFn: ({ id, body }) => creditFetch(`/admin/credit/limits/${encodeURIComponent(id)}`, { method: "POST", body }),
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
    queryKey: ["credit", "customers", q],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "6", fields: "id,email,company_name" })
      if (q) params.set("q", q)
      const res = await creditFetch<{ customers?: Array<{ id: string; email?: string | null; company_name?: string | null }> }>(`/admin/customers?${params.toString()}`)
      return (res.customers ?? [])
        .map((c) => ({ id: c.id, label: c.company_name ?? c.email ?? c.id, sub: c.company_name ? (c.email ?? null) : null }))
        .filter((c): c is FoundCustomer => Boolean(c.label))
    },
  })
}
