import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { FeedBuildResult, StatusResponse } from "../../modules/ceneo/lib/contract"
import { backendUrl, kitFetch } from "./ceneo-kit"

/** The admin API of the plugin, with the dashboard's own auth (kit). */
export const ceneoFetch = kitFetch

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const ceneoKeys = {
  all: ["ceneo"] as const,
  status: ["ceneo", "status"] as const,
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
  return useMutation<FeedBuildResult, unknown, void>({
    mutationFn: () => ceneoFetch<FeedBuildResult>("/admin/ceneo/feed", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ceneoKeys.all }),
  })
}

/** The absolute feed address to paste into Panel Ceneo: the backend the dashboard talks to, or this origin. */
export function feedUrl(path: string): string {
  const base = backendUrl() || (typeof window !== "undefined" ? window.location.origin : "")
  return `${base}${path}`
}
