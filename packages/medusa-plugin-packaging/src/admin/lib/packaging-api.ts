import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { StatusResponse } from "../../modules/packaging/lib/contract"

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

export class PackagingRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "PackagingRequestError"
    this.status = status
    this.code = code
  }
}

export async function packagingFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    throw new PackagingRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const packagingKeys = {
  all: ["packaging"] as const,
  status: ["packaging", "status"] as const,
}

export function usePackagingStatus() {
  return useQuery<StatusResponse>({
    queryKey: packagingKeys.status,
    queryFn: () => packagingFetch<StatusResponse>("/admin/packaging"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

function useRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: packagingKeys.all })
}

export interface SaveInput {
  moq: number
  step: number
  units: Array<{ name: string; pieces: number; ean: string | null; sscc_prefix: string | null }>
}

export function useSavePackaging() {
  const refresh = useRefresh()
  return useMutation<{ ok: boolean }, Error, { id: string; body: SaveInput }>({
    mutationFn: ({ id, body }) => packagingFetch(`/admin/packaging/products/${encodeURIComponent(id)}`, { method: "POST", body }),
    onSuccess: refresh,
  })
}

export interface SsccResult {
  sscc: string
  formatted: string
  payload: string
  prefix: string
}

export function useSscc(serial: string, enabled: boolean) {
  return useQuery<SsccResult>({
    queryKey: ["packaging", "sscc", serial],
    enabled,
    queryFn: () => packagingFetch<SsccResult>(`/admin/packaging/sscc?serial=${encodeURIComponent(serial)}`),
  })
}
