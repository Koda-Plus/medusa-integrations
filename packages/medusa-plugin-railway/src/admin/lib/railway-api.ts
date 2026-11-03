import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DeploymentsResponse, LogKind, LogsResponse, MetricRange, MetricsResponse, OverviewResponse, StatusResponse, VariablesResponse } from "../../modules/railway/lib/contract"
import { backendUrl, kitRequestInit } from "./railway-kit"

export class RailwayRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "RailwayRequestError"
    this.status = status
  }
}

/** GET only: the plugin's routes only read. The kit adds the dashboard's auth (session cookie or JWT). */
export async function railwayFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${backendUrl()}${path}`, kitRequestInit({ method: "GET" }))
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const message = json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : `HTTP ${res.status}`
    throw new RailwayRequestError(res.status, message)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const railwayKeys = {
  all: ["railway"] as const,
  status: ["railway", "status"] as const,
  overview: ["railway", "overview"] as const,
  deployments: (id: string) => ["railway", "deployments", id] as const,
  logs: (id: string, kind: LogKind, minutes: number, errorsOnly: boolean, q: string) => ["railway", "logs", id, kind, minutes, errorsOnly, q] as const,
  metrics: (id: string, range: MetricRange) => ["railway", "metrics", id, range] as const,
  variables: (id: string) => ["railway", "variables", id] as const,
}

/*
 * NO POLLING. Railway counts requests per account (1 000 an hour on Hobby),
 * so the page reads when it opens and when a person clicks Refresh. The
 * server keeps each read for `cacheSeconds` anyway.
 */
const quiet = { refetchOnWindowFocus: false, refetchOnReconnect: false, retry: 0, staleTime: 60_000 } as const

export function useRailwayStatus() {
  return useQuery<StatusResponse>({ queryKey: railwayKeys.status, queryFn: () => railwayFetch<StatusResponse>("/admin/railway"), ...quiet })
}

export function useRailwayOverview(enabled: boolean) {
  return useQuery<OverviewResponse>({ queryKey: railwayKeys.overview, queryFn: () => railwayFetch<OverviewResponse>("/admin/railway/overview"), enabled, ...quiet })
}

export function useRailwayDeployments(serviceId: string | null) {
  return useQuery<DeploymentsResponse>({
    queryKey: railwayKeys.deployments(serviceId ?? ""),
    queryFn: () => railwayFetch<DeploymentsResponse>(`/admin/railway/services/${encodeURIComponent(serviceId ?? "")}/deployments`),
    enabled: Boolean(serviceId),
    ...quiet,
  })
}

export function useRailwayLogs(deploymentId: string | null, kind: LogKind, minutes: number, errorsOnly: boolean, q: string) {
  const p = new URLSearchParams({ kind, minutes: String(minutes), errors: errorsOnly ? "1" : "0" })
  if (q) p.set("q", q)
  return useQuery<LogsResponse>({
    queryKey: railwayKeys.logs(deploymentId ?? "", kind, minutes, errorsOnly, q),
    queryFn: () => railwayFetch<LogsResponse>(`/admin/railway/deployments/${encodeURIComponent(deploymentId ?? "")}/logs?${p.toString()}`),
    enabled: Boolean(deploymentId),
    placeholderData: (previous) => previous,
    ...quiet,
    staleTime: 20_000,
  })
}

export function useRailwayMetrics(serviceId: string | null, range: MetricRange) {
  return useQuery<MetricsResponse>({
    queryKey: railwayKeys.metrics(serviceId ?? "", range),
    queryFn: () => railwayFetch<MetricsResponse>(`/admin/railway/services/${encodeURIComponent(serviceId ?? "")}/metrics?range=${range}`),
    enabled: Boolean(serviceId),
    placeholderData: (previous) => previous,
    ...quiet,
  })
}

export function useRailwayVariables(serviceId: string | null) {
  return useQuery<VariablesResponse>({
    queryKey: railwayKeys.variables(serviceId ?? ""),
    queryFn: () => railwayFetch<VariablesResponse>(`/admin/railway/services/${encodeURIComponent(serviceId ?? "")}/variables`),
    enabled: Boolean(serviceId),
    ...quiet,
  })
}

/**
 * "Refresh": reads the overview again (the server honours it once the last
 * read is 15 seconds old), then drops the other cached answers so the open
 * section reads again too. A mutation, though it only reads, so the button
 * can show its own spinner.
 */
export function useRailwayRefresh() {
  const client = useQueryClient()
  return useMutation<OverviewResponse, Error, void>({
    mutationFn: () => railwayFetch<OverviewResponse>("/admin/railway/overview?fresh=1"),
    onSuccess: (data) => {
      client.setQueryData(railwayKeys.overview, data)
      void client.invalidateQueries({ queryKey: railwayKeys.status })
      for (const key of ["deployments", "logs", "metrics", "variables"]) void client.invalidateQueries({ queryKey: ["railway", key] })
    },
  })
}
