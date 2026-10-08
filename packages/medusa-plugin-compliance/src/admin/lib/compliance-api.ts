import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DsrDto, ProductComplianceDto, ResponsiblePersonDto, StatusResponse } from "../../modules/compliance/lib/contract"

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

export class ComplianceRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "ComplianceRequestError"
    this.status = status
    this.code = code
  }
}

export async function complianceFetch<T>(path: string, init?: { method?: "GET" | "POST" | "DELETE"; body?: unknown }): Promise<T> {
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
    throw new ComplianceRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const complianceKeys = {
  all: ["compliance"] as const,
  status: ["compliance", "status"] as const,
}

export function useComplianceStatus() {
  return useQuery<StatusResponse>({
    queryKey: complianceKeys.status,
    queryFn: () => complianceFetch<StatusResponse>("/admin/compliance"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

function useRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: complianceKeys.all })
}

export function useCreateOperator() {
  const refresh = useRefresh()
  return useMutation<{ responsible_person: ResponsiblePersonDto }, Error, Record<string, unknown>>({
    mutationFn: (body) => complianceFetch("/admin/compliance/responsible-persons", { method: "POST", body }),
    onSuccess: refresh,
  })
}

export function useUpdateOperator() {
  const refresh = useRefresh()
  return useMutation<{ responsible_person: ResponsiblePersonDto }, Error, { id: string; body: Record<string, unknown> }>({
    mutationFn: ({ id, body }) => complianceFetch(`/admin/compliance/responsible-persons/${encodeURIComponent(id)}`, { method: "POST", body }),
    onSuccess: refresh,
  })
}

export function useDeleteOperator() {
  const refresh = useRefresh()
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (id) => complianceFetch(`/admin/compliance/responsible-persons/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: refresh,
  })
}

export function useSaveProduct() {
  const refresh = useRefresh()
  return useMutation<{ product: ProductComplianceDto }, Error, { id: string; body: Record<string, unknown> }>({
    mutationFn: ({ id, body }) => complianceFetch(`/admin/compliance/products/${encodeURIComponent(id)}`, { method: "POST", body }),
    onSuccess: refresh,
  })
}

export function useUpdateDsr() {
  const refresh = useRefresh()
  return useMutation<{ dsr: DsrDto }, Error, { id: string; body: Record<string, unknown> }>({
    mutationFn: ({ id, body }) => complianceFetch(`/admin/compliance/dsr/${encodeURIComponent(id)}`, { method: "POST", body }),
    onSuccess: refresh,
  })
}

export function useCapturePrices() {
  const refresh = useRefresh()
  return useMutation<{ captured: number }, Error, void>({
    mutationFn: () => complianceFetch("/admin/compliance/prices/capture", { method: "POST", body: {} }),
    onSuccess: refresh,
  })
}
