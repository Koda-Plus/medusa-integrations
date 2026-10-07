import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ActionResponse,
  CheckResponse,
  CorrectionsResponse,
  DocumentDetailResponse,
  DocumentFilter,
  DocumentResponse,
  DocumentsResponse,
  EmailRequest,
  EmailsResponse,
  OrderDocumentsResponse,
  PlanFilter,
  PlanResponse,
  RemindersResponse,
  RunsResponse,
  StatusResponse,
  SummaryResponse,
  SyncResponse,
  WriterKey,
  WritersDto,
} from "../../modules/fakturownia/lib/contract"

import { backendUrl, kitRequestInit } from "./fakturownia-kit"
import { POLL_DUE_MS, pollInterval } from "../../modules/fakturownia/lib/poll"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export class FakturowniaRequestError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.name = "FakturowniaRequestError"
    this.status = status
    this.code = code
  }
}

async function failure(res: Response): Promise<FakturowniaRequestError> {
  const text = await res.text().catch(() => "")
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  const body = (json && typeof json === "object" ? json : {}) as { message?: unknown; code?: unknown }
  return new FakturowniaRequestError(res.status, typeof body.message === "string" ? body.message : `HTTP ${res.status}`, typeof body.code === "string" ? body.code : null)
}

/**
 * Every call of the admin to the plugin's routes. The kit adds the
 * dashboard's auth (the session cookie, or the bearer token of an admin
 * built with JWT) and, on writes, the JSON body and the `x-koda-request`
 * header the server's write guard asks for.
 */
export async function fakturowniaFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(`${backendUrl()}${path}`, kitRequestInit({ method: init?.method ?? "GET", body: init?.body }))
  if (!res.ok) throw await failure(res)
  const text = await res.text()
  try {
    return (text ? JSON.parse(text) : null) as T
  } catch {
    return null as T
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The PDF route of a document: streamed by the backend, the token never reaches the browser. */
export function pdfPath(documentId: string): string {
  return `/admin/fakturownia/documents/${encodeURIComponent(documentId)}/pdf`
}

/** The UPO or the KSeF XML of an accepted document, fetched by the backend. */
export function ksefFilePath(documentId: string, file: "upo" | "xml"): string {
  return `/admin/fakturownia/documents/${encodeURIComponent(documentId)}/ksef-file?file=${file}`
}

/** The file name the server gave (`filename*` first, then `filename`). */
export function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      /* the plain name below */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition)
  return plain ? plain[1].trim() : null
}

/**
 * A file the backend streams (the PDF, the UPO, the KSeF XML), fetched with
 * the dashboard's auth as a blob. A plain link would carry only the session
 * cookie, so an admin signed in with a token (JWT) would get 401.
 */
async function fetchFile(path: string): Promise<{ blob: Blob; name: string | null }> {
  const res = await fetch(`${backendUrl()}${path}`, kitRequestInit({ method: "GET", headers: { Accept: "application/pdf, application/xml, */*" } }))
  if (!res.ok) throw await failure(res)
  return { blob: await res.blob(), name: fileNameOf(res.headers.get("content-disposition")) }
}

/** Saves a file the backend streams under the name it gave. */
export async function saveFile(path: string, fallbackName: string): Promise<void> {
  const { blob, name } = await fetchFile(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name ?? fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Opens a PDF the backend streams in a new tab. The tab is opened at once
 * (inside the click, so the browser allows it) and gets the file when it
 * arrives; when the browser blocks it anyway, the file is saved instead.
 */
export async function openFile(path: string, fallbackName: string): Promise<void> {
  const tab = window.open("about:blank", "_blank")
  try {
    const { blob, name } = await fetchFile(path)
    const url = URL.createObjectURL(blob)
    if (tab) tab.location.href = url
    else {
      const a = document.createElement("a")
      a.href = url
      a.download = name ?? fallbackName
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
  } catch (err) {
    tab?.close()
    throw err
  }
}

export const fakturowniaKeys = {
  all: ["fakturownia"] as const,
  status: ["fakturownia", "status"] as const,
  documents: (filter: DocumentFilter, q: string, offset: number, limit: number, customer = "") => ["fakturownia", "documents", filter, q, offset, limit, customer] as const,
  runs: ["fakturownia", "runs"] as const,
  order: (id: string) => ["fakturownia", "order", id] as const,
  document: (id: string) => ["fakturownia", "document", id] as const,
  corrections: (filter: PlanFilter, q: string, offset: number) => ["fakturownia", "corrections", filter, q, offset] as const,
  emails: (offset: number) => ["fakturownia", "emails", offset] as const,
  reminders: ["fakturownia", "reminders"] as const,
  summary: ["fakturownia", "summary"] as const,
}

/** Status of the page. Polls while a job runs or right after an action. */
export function useFakturowniaStatus(pollUntil: number) {
  return useQuery<StatusResponse>({
    queryKey: fakturowniaKeys.status,
    queryFn: () => fakturowniaFetch<StatusResponse>("/admin/fakturownia"),
    refetchInterval: (query) => {
      const data = query.state.data
      if ((data?.running?.length ?? 0) > 0 || Date.now() < pollUntil) return 2_500
      return 60_000
    },
  })
}

function params(values: Record<string, string | number>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== "" && v !== undefined) p.set(k, String(v))
  return p.toString()
}

export function useFakturowniaDocuments(filter: DocumentFilter, q: string, offset: number, limit: number, poll: boolean, customer = "") {
  return useQuery<DocumentsResponse>({
    queryKey: fakturowniaKeys.documents(filter, q, offset, limit, customer),
    queryFn: () => fakturowniaFetch<DocumentsResponse>(`/admin/fakturownia/documents?${params({ filter, q, offset, limit, customer_id: customer })}`),
    placeholderData: (previous) => previous,
    /* `lib/poll.ts`: fast only while something is being issued; a finished run refreshes the lists anyway. */
    refetchInterval: (query) => (poll ? 4_000 : pollInterval(query.state.data?.documents ?? [])),
  })
}

export function useFakturowniaRuns(poll: boolean) {
  return useQuery<RunsResponse>({
    queryKey: fakturowniaKeys.runs,
    queryFn: () => fakturowniaFetch<RunsResponse>("/admin/fakturownia/runs?limit=15"),
    refetchInterval: poll ? 4_000 : 30_000,
  })
}

/** The order card. Asks again only while something moves by itself (`lib/poll.ts`). */
export function useFakturowniaOrder(orderId: string) {
  return useQuery<OrderDocumentsResponse>({
    queryKey: fakturowniaKeys.order(orderId),
    queryFn: () => fakturowniaFetch<OrderDocumentsResponse>(`/admin/fakturownia/orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
    refetchInterval: (query) => pollInterval(query.state.data?.documents ?? []),
  })
}

export function useFakturowniaSync() {
  const client = useQueryClient()
  return useMutation<SyncResponse, Error, SyncResponse["what"]>({
    mutationFn: (what) => fakturowniaFetch<SyncResponse>("/admin/fakturownia/sync", { method: "POST", body: { what } }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.status }),
  })
}

/** Demo mode, first visit: the sample documents (`POST /admin/fakturownia/demo/seed`, idempotent). */
export function useFakturowniaDemoSeed() {
  const client = useQueryClient()
  return useMutation<StatusResponse, Error, void>({
    mutationFn: () => fakturowniaFetch<StatusResponse>("/admin/fakturownia/demo/seed", { method: "POST", body: {} }),
    onSuccess: (data) => {
      client.setQueryData(fakturowniaKeys.status, data)
      void client.invalidateQueries({ queryKey: fakturowniaKeys.all, predicate: (q) => q.queryKey[1] !== "status" })
    },
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

/* ---- 0.2.0 ---------------------------------------------------------- */

/** One document with its KSeF and e-mail history, corrections and plans (the drawer). */
export function useFakturowniaDocument(id: string | null) {
  return useQuery<DocumentDetailResponse>({
    queryKey: fakturowniaKeys.document(id ?? ""),
    queryFn: () => fakturowniaFetch<DocumentDetailResponse>(`/admin/fakturownia/documents/${encodeURIComponent(id ?? "")}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data
      return data ? pollInterval([data.document, ...data.corrections]) : false
    },
  })
}

export function useFakturowniaCorrections(filter: PlanFilter, q: string, offset: number, limit: number, poll: boolean) {
  return useQuery<CorrectionsResponse>({
    queryKey: fakturowniaKeys.corrections(filter, q, offset),
    queryFn: () => fakturowniaFetch<CorrectionsResponse>(`/admin/fakturownia/corrections?${params({ filter, q, offset, limit })}`),
    placeholderData: (previous) => previous,
    /* An approved plan moves only while its correction is being issued; one waiting for the writer waits for a person. */
    refetchInterval: (query) => {
      const busy = (query.state.data?.plans ?? []).some((p) => p.status === "approved" && (p.correction?.status === "issuing" || (p.correction?.status === "pending" && p.correction.errorCode !== "waiting_for_writer")))
      return poll ? 5_000 : busy ? POLL_DUE_MS : false
    },
  })
}

export function useFakturowniaEmails(offset: number, limit: number) {
  return useQuery<EmailsResponse>({
    queryKey: fakturowniaKeys.emails(offset),
    queryFn: () => fakturowniaFetch<EmailsResponse>(`/admin/fakturownia/emails?${params({ offset, limit })}`),
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
  })
}

export function useFakturowniaReminders() {
  return useQuery<RemindersResponse>({
    queryKey: fakturowniaKeys.reminders,
    queryFn: () => fakturowniaFetch<RemindersResponse>("/admin/fakturownia/reminders"),
    refetchInterval: 60_000,
  })
}

export function useFakturowniaSummary() {
  return useQuery<SummaryResponse>({
    queryKey: fakturowniaKeys.summary,
    queryFn: () => fakturowniaFetch<SummaryResponse>("/admin/fakturownia/summary"),
    refetchInterval: 120_000,
  })
}

/** Turns a writer on or off; the answer is every writer, with who flipped it. */
export function useFakturowniaWriter() {
  const client = useQueryClient()
  return useMutation<{ writers: WritersDto }, Error, { writer: WriterKey; on: boolean }>({
    mutationFn: (body) => fakturowniaFetch<{ writers: WritersDto }>("/admin/fakturownia/writers", { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
  })
}

export type PlanAction = "approve" | "dismiss" | "done"

/** Approve (with the revision seen and the reason), dismiss or mark done a correction plan. */
export function useFakturowniaPlanAction() {
  const client = useQueryClient()
  return useMutation<PlanResponse, Error, { id: string; action: PlanAction; revision?: number; reason?: string; note?: string }>({
    mutationFn: ({ id, action, ...body }) => fakturowniaFetch<PlanResponse>(`/admin/fakturownia/corrections/${encodeURIComponent(id)}/${action}`, { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
  })
}

/** "Check for corrections" on the order page. */
export function useFakturowniaCheckOrderCorrections() {
  const client = useQueryClient()
  return useMutation<{ outcome: string; reason: string | null }, Error, string>({
    mutationFn: (orderId) => fakturowniaFetch<{ outcome: string; reason: string | null }>(`/admin/fakturownia/orders/${encodeURIComponent(orderId)}/corrections`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
  })
}

/** E-mail a document (or a reminder). */
export function useFakturowniaEmail() {
  const client = useQueryClient()
  return useMutation<ActionResponse, Error, { id: string } & EmailRequest>({
    mutationFn: ({ id, ...body }) => fakturowniaFetch<ActionResponse>(`/admin/fakturownia/documents/${encodeURIComponent(id)}/email`, { method: "POST", body }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
  })
}

/** "Send to KSeF again". */
export function useFakturowniaKsefResend() {
  const client = useQueryClient()
  return useMutation<ActionResponse, Error, string>({
    mutationFn: (id) => fakturowniaFetch<ActionResponse>(`/admin/fakturownia/documents/${encodeURIComponent(id)}/ksef-resend`, { method: "POST", body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: fakturowniaKeys.all }),
  })
}
