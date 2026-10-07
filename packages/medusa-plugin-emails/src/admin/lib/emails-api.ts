import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  MessageDetailResponse,
  MessageFilter,
  MessagesResponse,
  MessageWindow,
  PreviewResponse,
  PreviewSource,
  RetryResponse,
  SeedResponse,
  SettingsRequest,
  StatusResponse,
  TestRequest,
  TestResponse,
} from "../../modules/emails/lib/contract"
import { backendUrl, kitRequestInit } from "./emails-kit"

export { backendUrl }

export class EmailsRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "EmailsRequestError"
    this.status = status
  }
}

/**
 * Every request of the page and the order card: the backend URL, the
 * session cookie or the JWT of Medusa's admin, and on writes the JSON body
 * and the header the plugin's write guard asks for (all from the kit).
 */
export async function emailsFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(`${backendUrl()}${path}`, kitRequestInit({ method: init?.method ?? "GET", body: init?.body }))
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const message = json && typeof json === "object" && "message" in json && typeof (json as { message: unknown }).message === "string" ? String((json as { message: string }).message) : `HTTP ${res.status}`
    throw new EmailsRequestError(res.status, message)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function params(values: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== "" && v !== undefined && v !== null) p.set(k, String(v))
  return p.toString()
}

export const emailsKeys = {
  all: ["koda-emails"] as const,
  status: ["koda-emails", "status"] as const,
  messages: (filter: MessageFilter, q: string, template: string, orderId: string, customerId: string, since: string, offset: number, limit: number) =>
    ["koda-emails", "messages", filter, q, template, orderId, customerId, since, offset, limit] as const,
  message: (id: string) => ["koda-emails", "message", id] as const,
  preview: (template: string, locale: string, theme: string, source: PreviewSource) => ["koda-emails", "preview", template, locale, theme, source] as const,
}

/** The status of the page: read once a minute, and on "Refresh". Never polled from an order card. */
export function useEmailsStatus() {
  return useQuery<StatusResponse>({
    queryKey: emailsKeys.status,
    queryFn: () => emailsFetch<StatusResponse>("/admin/emails"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

/**
 * A page of the log. Every 5 seconds while one of its messages is being
 * sent, otherwise once a minute; a hidden tab is never polled.
 */
export function useEmailsMessages(input: {
  filter: MessageFilter
  q?: string
  template?: string
  orderId?: string
  customerId?: string
  since?: MessageWindow | ""
  offset?: number
  limit?: number
  enabled?: boolean
}) {
  const { filter, q = "", template = "", orderId = "", customerId = "", since = "", offset = 0, limit = 15, enabled = true } = input
  return useQuery<MessagesResponse>({
    queryKey: emailsKeys.messages(filter, q, template, orderId, customerId, since, offset, limit),
    queryFn: () => emailsFetch<MessagesResponse>(`/admin/emails/messages?${params({ filter, q, template, order_id: orderId, customer_id: customerId, since, offset, limit })}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => ((query.state.data as MessagesResponse | undefined)?.messages.some((m) => m.status === "sending") ? 5_000 : 60_000),
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    enabled,
  })
}

/** Demo mode: build the simulated outbox (the status says when it is stale). */
export function useEmailsSeed() {
  const client = useQueryClient()
  return useMutation<SeedResponse, Error, void>({
    mutationFn: () => emailsFetch<SeedResponse>("/admin/emails/demo/seed", { method: "POST", body: {} }),
    onSuccess: (data) => {
      client.setQueryData(emailsKeys.status, data.status)
      void client.invalidateQueries({ queryKey: emailsKeys.all, predicate: (q) => q.queryKey[1] === "messages" })
    },
  })
}

export function useEmailsMessage(id: string | null) {
  return useQuery<MessageDetailResponse>({
    queryKey: emailsKeys.message(id ?? ""),
    queryFn: () => emailsFetch<MessageDetailResponse>(`/admin/emails/messages/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id),
  })
}

export function useEmailsPreview(template: string | null, locale: string, theme: "light" | "dark", source: PreviewSource) {
  return useQuery<PreviewResponse>({
    queryKey: emailsKeys.preview(template ?? "", locale, theme, source),
    queryFn: () => emailsFetch<PreviewResponse>(`/admin/emails/preview?${params({ template, locale, theme, source })}`),
    enabled: Boolean(template),
    /* Switching the theme or the language keeps the e-mail on screen until the other one arrives. */
    placeholderData: (previous, query) => (query?.queryKey[2] === template ? previous : undefined),
    staleTime: 10_000,
  })
}

export function useEmailsTest() {
  const client = useQueryClient()
  return useMutation<TestResponse, Error, TestRequest>({
    mutationFn: (body) => emailsFetch<TestResponse>("/admin/emails/test", { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: emailsKeys.all, predicate: (q) => q.queryKey[1] !== "preview" }),
  })
}

export function useEmailsSettings() {
  const client = useQueryClient()
  return useMutation<StatusResponse, Error, SettingsRequest>({
    mutationFn: (body) => emailsFetch<StatusResponse>("/admin/emails/settings", { method: "POST", body }),
    onSuccess: (data) => {
      client.setQueryData(emailsKeys.status, data)
      void client.invalidateQueries({ queryKey: emailsKeys.all, predicate: (q) => q.queryKey[1] === "preview" })
    },
  })
}

export function useEmailsRetry() {
  const client = useQueryClient()
  return useMutation<RetryResponse, Error, string>({
    mutationFn: (id) => emailsFetch<RetryResponse>(`/admin/emails/messages/${encodeURIComponent(id)}/retry`, { method: "POST", body: {} }),
    onSettled: () => client.invalidateQueries({ queryKey: emailsKeys.all, predicate: (q) => q.queryKey[1] !== "preview" }),
  })
}
