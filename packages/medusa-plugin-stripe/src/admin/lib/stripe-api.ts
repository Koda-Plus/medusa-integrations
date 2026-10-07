import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  MethodKey,
  PaymentFilter,
  StripeChecksResponse,
  StripeOrderResponse,
  StripeOverviewResponse,
  StripePaymentsResponse,
  StripeStatusResponse,
} from "../../modules/stripe/lib/contract"

import { backendUrl, kitRequestInit } from "./stripe-kit"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export class StripeRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "StripeRequestError"
    this.status = status
  }
}

/**
 * GET only: the plugin's routes only read. The kit adds the dashboard's auth
 * (the session cookie, or the JWT when the admin runs with JWT auth).
 */
export async function stripeFetch<T>(path: string): Promise<T> {
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
    throw new StripeRequestError(res.status, message)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const stripeKeys = {
  all: ["stripe"] as const,
  status: ["stripe", "status"] as const,
  overview: ["stripe", "overview"] as const,
  checks: ["stripe", "checks"] as const,
  payments: (filter: PaymentFilter, method: MethodKey | "all", q: string, offset: number, limit: number, at: string | null) => ["stripe", "payments", filter, method, q, offset, limit, at] as const,
  order: (id: string) => ["stripe", "order", id] as const,
}

/*
 * NO POLLING. Stripe counts read requests per account (about 500 per payment
 * over 30 days), so the page reads when it opens and when a person clicks
 * Refresh. The server keeps each read for `cacheSeconds` anyway.
 */
const quiet = { refetchOnWindowFocus: false, refetchOnReconnect: false, retry: 1 } as const

export function useStripeStatus() {
  return useQuery<StripeStatusResponse>({ queryKey: stripeKeys.status, queryFn: () => stripeFetch<StripeStatusResponse>("/admin/stripe"), staleTime: 60_000, ...quiet })
}

export function useStripeOverview(enabled = true) {
  return useQuery<StripeOverviewResponse>({
    queryKey: stripeKeys.overview,
    queryFn: () => stripeFetch<StripeOverviewResponse>("/admin/stripe/overview"),
    staleTime: 60_000,
    enabled,
    ...quiet,
  })
}

export function useStripeChecks(enabled = true) {
  return useQuery<StripeChecksResponse>({
    queryKey: stripeKeys.checks,
    queryFn: () => stripeFetch<StripeChecksResponse>("/admin/stripe/checks"),
    staleTime: 60_000,
    enabled,
    ...quiet,
  })
}

function params(values: Record<string, string | number>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== "" && v !== undefined) p.set(k, String(v))
  return p.toString()
}

/** A page of payments from the server's cached read; `at` (the read's time) refetches when the read changes. */
export function useStripePayments(filter: PaymentFilter, method: MethodKey | "all", q: string, offset: number, limit: number, at: string | null) {
  return useQuery<StripePaymentsResponse>({
    queryKey: stripeKeys.payments(filter, method, q, offset, limit, at),
    queryFn: () => stripeFetch<StripePaymentsResponse>(`/admin/stripe/payments?${params({ filter, method, q, offset, limit })}`),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    ...quiet,
  })
}

export function useStripeOrder(orderId: string) {
  return useQuery<StripeOrderResponse>({
    queryKey: stripeKeys.order(orderId),
    queryFn: () => stripeFetch<StripeOrderResponse>(`/admin/stripe/orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
    staleTime: 60_000,
    ...quiet,
  })
}

/**
 * The widget's Refresh: reads the order's payments from Stripe again (the
 * server honours it once the last read is 30 seconds old), then the order's
 * summary for hosts follows (same ["stripe"] key prefix).
 */
export function useStripeOrderRefresh(orderId: string) {
  const client = useQueryClient()
  return useMutation<StripeOrderResponse, Error, void>({
    mutationFn: () => stripeFetch<StripeOrderResponse>(`/admin/stripe/orders/${encodeURIComponent(orderId)}?fresh=1`),
    onSuccess: (data) => {
      client.setQueryData(stripeKeys.order(orderId), data)
      void client.invalidateQueries({ queryKey: ["stripe", "koda-integration"] })
    },
  })
}

/**
 * "Refresh": reads Stripe again (the server honours it once the last read
 * is 30 seconds old), then the overview and the checks. A mutation, though
 * it only reads, so the button can show its own spinner.
 */
export function useStripeRefresh() {
  const client = useQueryClient()
  return useMutation<{ overview: StripeOverviewResponse; checks: StripeChecksResponse }, Error, void>({
    mutationFn: async () => {
      const overview = await stripeFetch<StripeOverviewResponse>("/admin/stripe/overview?fresh=1")
      const checks = await stripeFetch<StripeChecksResponse>("/admin/stripe/checks?fresh=1")
      return { overview, checks }
    },
    onSuccess: (data) => {
      client.setQueryData(stripeKeys.overview, data.overview)
      client.setQueryData(stripeKeys.checks, data.checks)
      void client.invalidateQueries({ queryKey: ["stripe", "payments"] })
    },
  })
}
