import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  CheckResponse,
  DocumentFilter,
  DocumentResponse,
  DocumentsResponse,
  OrderDocumentsResponse,
  RunsResponse,
  StatusResponse,
  SyncResponse,
} from "../../modules/fakturownia/lib/contract"

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

export class FakturowniaRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "FakturowniaRequestError"
    this.status = status
  }
}

export async function fakturowniaFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
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
    const message = json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : `HTTP ${res.status}`
    throw new FakturowniaRequestError(res.status, message)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The PDF route of a document: streamed by the backend, the token never reaches the browser. */
export function pdfUrl(documentId: string): string {
  return `${backendUrl()}/admin/fakturownia/documents/${encodeURIComponent(documentId)}/pdf`
}

export const fakturowniaKeys = {
  all: ["fakturownia"] as const,
  status: ["fakturownia", "status"] as const,
  documents: (filter: DocumentFilter, q: string, offset: number, limit: number) => ["fakturownia", "documents", filter, q, offset, limit] as const,
  runs: ["fakturownia", "runs"] as const,
  order: (id: string) => ["fakturownia", "order", id] as const,
}

/** Status of the page. Polls while a job runs or right after an action. */
export function useFakturowniaStatus(pollUntil: number) {
  return useQuery<StatusResponse>({
    queryKey: fakturowniaKeys.status,
    queryFn: () => fakturowniaFetch<StatusResponse>("/admin/fakturownia"),
    refetchInterval: (query) => {
      const data = query.state.data
      if ((data?.running?.length ?? 0) > 0 || Date.now() < pollUntil) return 2_500
      return 30_000
    },
  })
}

function params(values: Record<string, string | number>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== "" && v !== undefined) p.set(k, String(v))
  return p.toString()
}

export function useFakturowniaDocuments(filter: DocumentFilter, q: string, offset: number, limit: number, poll: boolean) {
  return useQuery<DocumentsResponse>({
    queryKey: fakturowniaKeys.documents(filter, q, offset, limit),
    queryFn: () => fakturowniaFetch<DocumentsResponse>(`/admin/fakturownia/documents?${params({ filter, q, offset, limit })}`),
    placeholderData: (previous) => previous,
    refetchInterval: (query) => {
      const busy = (query.state.data?.documents ?? []).some((d) => d.status === "pending" || d.status === "issuing" || d.govState === "processing")
      return poll || busy ? 4_000 : 30_000
    },
  })
}

export function useFakturowniaRuns(poll: boolean) {
  return useQuery<RunsResponse>({
    queryKey: fakturowniaKeys.runs,
    queryFn: () => fakturowniaFetch<RunsResponse>("/admin/fakturownia/runs?limit=15"),
    refetchInterval: poll ? 4_000 : 30_000,
  })
}

/** The order widget. Polls while a document waits in the queue or its KSeF number is on its way. */
export function useFakturowniaOrder(orderId: string) {
  return useQuery<OrderDocumentsResponse>({
    queryKey: fakturowniaKeys.order(orderId),
    queryFn: () => fakturowniaFetch<OrderDocumentsResponse>(`/admin/fakturownia/orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
    refetchInterval: (query) => {
      const docs = query.state.data?.documents ?? []
      if (docs.some((d) => d.status === "pending" || d.status === "issuing")) return 3_000
      if (docs.some((d) => d.govState === "processing")) return 20_000
      return false
    },
  })
}

export function useFakturowniaSync() {
  const client = useQueryClient()
  return useMutation<SyncResponse, Error, SyncResponse["what"]>({
    mutationFn: (what) => fakturowniaFetch<SyncResponse>("/admin/fakturownia/sync", { method: "POST", body: { what } }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.status }),
  })
}

export function useFakturowniaCheck() {
  const client = useQueryClient()
  return useMutation<CheckResponse, Error, void>({
    mutationFn: () => fakturowniaFetch<CheckResponse>("/admin/fakturownia/check", { method: "POST", body: {} }),
    onSuccess: (data) => client.setQueryData(fakturowniaKeys.status, data.status),
  })
}

export type DocumentAction = "retry" | "issue-again" | "check"

/** "Retry", "Issue again" and "Check in Fakturownia" on one document. */
export function useFakturowniaDocumentAction() {
  const client = useQueryClient()
  return useMutation<DocumentResponse, Error, { id: string; action: DocumentAction }>({
    mutationFn: ({ id, action }) => fakturowniaFetch<DocumentResponse>(`/admin/fakturownia/documents/${encodeURIComponent(id)}/${action}`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
  })
}

/** "Mark as issued" with the number (and optionally the Fakturownia id) a person found. */
export function useFakturowniaMarkIssued() {
  const client = useQueryClient()
  return useMutation<DocumentResponse, Error, { id: string; number: string; fakturowniaId: string }>({
    mutationFn: ({ id, number, fakturowniaId }) =>
      fakturowniaFetch<DocumentResponse>(`/admin/fakturownia/documents/${encodeURIComponent(id)}/mark-issued`, {
        method: "POST",
        body: { number, fakturowniaId: fakturowniaId || undefined },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
  })
}

/** "Issue now" on the order page. The argument is the Medusa order id. */
export function useFakturowniaIssueOrder() {
  const client = useQueryClient()
  return useMutation<{ queued: string[] }, Error, string>({
    mutationFn: (orderId) => fakturowniaFetch<{ queued: string[] }>(`/admin/fakturownia/orders/${encodeURIComponent(orderId)}/issue`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
  })
}
