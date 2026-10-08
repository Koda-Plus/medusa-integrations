import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CheckDto, EntityDto, StatusResponse } from "../../modules/whitelist/lib/contract"

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

export class WhitelistRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null) {
    super(message)
    this.name = "WhitelistRequestError"
    this.status = status
    this.code = code
  }
}

export async function whitelistFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    throw new WhitelistRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const whitelistKeys = {
  all: ["whitelist"] as const,
  status: ["whitelist", "status"] as const,
}

export function useWhitelistStatus() {
  return useQuery<StatusResponse>({
    queryKey: whitelistKeys.status,
    queryFn: () => whitelistFetch<StatusResponse>("/admin/whitelist"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

function useRefresh() {
  const client = useQueryClient()
  return () => void client.invalidateQueries({ queryKey: whitelistKeys.all })
}

export interface CheckResult {
  entity: EntityDto
  check: CheckDto
}

export function useCheckNip() {
  const refresh = useRefresh()
  return useMutation<CheckResult, Error, string>({
    mutationFn: (nip) => whitelistFetch("/admin/whitelist/check", { method: "POST", body: { nip } }),
    onSuccess: refresh,
  })
}

export function useRecheckEntity() {
  const refresh = useRefresh()
  return useMutation<CheckResult, Error, string>({
    mutationFn: (id) => whitelistFetch(`/admin/whitelist/entities/${encodeURIComponent(id)}/check`, { method: "POST", body: {} }),
    onSuccess: refresh,
  })
}
