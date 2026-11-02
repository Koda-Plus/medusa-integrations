import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  ActionResponse,
  BoxesRequest,
  CreateRequest,
  DemoResetResponse,
  DemoSeedResponse,
  LabelRequest,
  OrderDpdResponse,
  PlanResponse,
  ShipmentFilter,
  ShipmentResponse,
  ShipmentsResponse,
  StatusResponse,
  WriterRequest,
  WritersResponse,
} from "../../modules/dpd/lib/contract"

import { backendUrl, kitRequestInit } from "./dpd-kit"
import { DpdRequestError, fetchLabelFile, parseJson, requestError } from "./dpd-logic"

/* The backend the dashboard talks to, with its auth (session or JWT): from the kit. */
export { backendUrl }

export { DpdRequestError }

export async function dpdFetch<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  /* The kit adds the dashboard's auth (session cookie or JWT) and, on writes, the JSON body and the
     x-koda-request header the server's write guard asks for. */
  const res = await fetch(`${backendUrl()}${path}`, kitRequestInit({ method: init?.method ?? "GET", body: init?.body }))
  const text = await res.text()
  if (!res.ok) throw requestError(res.status, text)
  return parseJson(text) as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const dpdKeys = {
  all: ["dpd"] as const,
  status: ["dpd", "status"] as const,
  shipments: (filter: ShipmentFilter, q: string, offset: number, limit: number) => ["dpd", "shipments", filter, q, offset, limit] as const,
  order: (id: string) => ["dpd", "order", id] as const,
  shipment: (id: string) => ["dpd", "shipment", id] as const,
  plan: (id: string) => ["dpd", "plan", id] as const,
}

const shipmentPath = (id: string, action?: string) => `/admin/dpd/shipments/${encodeURIComponent(id)}${action ? `/${action}` : ""}`

/** Backend URL of the label PDF of a shipment; the browser never sees DPD credentials, only the admin session. */
export function labelUrl(id: string, download = false): string {
  return `${backendUrl()}${shipmentPath(id, "label")}${download ? "?download=1" : ""}`
}

/** Saves a blob URL under a file name through a temporary link, then lets the URL go. */
function saveFile(url: string, fileName: string): void {
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Opens the stored label in a new tab, or saves it. The PDF is fetched with
 * the dashboard's auth: a bare URL in a new tab carries the session cookie
 * but never the JWT, so a JWT admin would get 401. The tab is opened before
 * the fetch, while the click still allows it; after a refusal (no_label,
 * also for a label removed after its retention) it closes and the error
 * goes to the caller. A blocked tab falls back to saving the file.
 */
export async function openLabel(id: string, download: boolean): Promise<void> {
  const tab = download ? null : window.open("", "_blank")
  try {
    const { blob, fileName } = await fetchLabelFile((url, init) => fetch(url, init), labelUrl(id, download), kitRequestInit({ headers: { Accept: "application/pdf, application/json" } }), `dpd-label-${id.replace(/[^\w-]/g, "_")}.pdf`)
    const url = URL.createObjectURL(blob)
    if (tab && !tab.closed) {
      tab.opener = null
      tab.location.href = url
      /* The tab needs the URL while it loads the PDF; a minute is plenty. */
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } else {
      saveFile(url, fileName)
    }
  } catch (err) {
    tab?.close()
    throw err
  }
}

/** One shipment with its documents and history (no label data). */
export function useDpdShipment(id: string | null) {
  return useQuery<ShipmentResponse>({
    queryKey: dpdKeys.shipment(id ?? ""),
    queryFn: () => dpdFetch<ShipmentResponse>(shipmentPath(id ?? "")),
    enabled: Boolean(id),
  })
}

/** The plan of a shipment, read live from the order: never cached, so a confirm always follows a fresh read. */
export function useDpdPlan(id: string | null) {
  return useQuery<PlanResponse>({
    queryKey: dpdKeys.plan(id ?? ""),
    queryFn: () => dpdFetch<PlanResponse>(shipmentPath(id ?? "", "plan")),
    enabled: Boolean(id),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

export function useDpdStatus() {
  return useQuery<StatusResponse>({
    queryKey: dpdKeys.status,
    queryFn: () => dpdFetch<StatusResponse>("/admin/dpd"),
    refetchInterval: 60_000,
  })
}

export function useDpdShipments(filter: ShipmentFilter, q: string, offset: number, limit: number) {
  const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) })
  if (q) params.set("q", q)
  return useQuery<ShipmentsResponse>({
    queryKey: dpdKeys.shipments(filter, q, offset, limit),
    queryFn: () => dpdFetch<ShipmentsResponse>(`/admin/dpd/shipments?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

export function useDpdOrder(orderId: string) {
  return useQuery<OrderDpdResponse>({
    queryKey: dpdKeys.order(orderId),
    queryFn: () => dpdFetch<OrderDpdResponse>(`/admin/dpd/orders/${encodeURIComponent(orderId)}`),
    enabled: Boolean(orderId),
  })
}

/** Arm or disarm one writer; the answer carries every writer, so the page header and Settings change at once. */
export function useDpdWriter() {
  const client = useQueryClient()
  return useMutation<WritersResponse, unknown, WriterRequest>({
    mutationFn: (body) => dpdFetch<WritersResponse>("/admin/dpd/writers", { method: "POST", body }),
    onSuccess: (data) => {
      client.setQueryData<StatusResponse>(dpdKeys.status, (old) => (old ? { ...old, writers: data.writers } : old))
      void client.invalidateQueries({ queryKey: dpdKeys.all })
    },
  })
}

function usePost<TResult>(path: string) {
  const client = useQueryClient()
  return useMutation<TResult, unknown, void>({
    mutationFn: () => dpdFetch<TResult>(path, { method: "POST", body: {} }),
    onSettled: () => void client.invalidateQueries({ queryKey: dpdKeys.all }),
  })
}

/**
 * A POST on one shipment (`/admin/dpd/shipments/:id/<action>`): the variables
 * carry the id and the body. Every answer, a refusal too (busy, wrong_state,
 * plan_changed say the row moved on), invalidates what the page shows.
 */
function useAction<TBody extends object, TResult>(path: (id: string) => string) {
  const client = useQueryClient()
  return useMutation<TResult, unknown, { id: string } & TBody>({
    mutationFn: ({ id, ...body }) => dpdFetch<TResult>(path(id), { method: "POST", body }),
    onSettled: () => void client.invalidateQueries({ queryKey: dpdKeys.all }),
  })
}

/** Create in DPD and get the label, for the plan that was read (its hash). */
export const useDpdCreate = () => useAction<CreateRequest, ActionResponse>((id) => shipmentPath(id, "create"))
/** Get the label of a shipment that has its waybills but no label yet. */
export const useDpdFetchLabel = () => useAction<LabelRequest, ActionResponse>((id) => shipmentPath(id, "label"))
/** Look up a shipment with no clear answer in DPD, by its reference. */
export const useDpdLookup = () => useAction<Record<never, never>, ActionResponse>((id) => shipmentPath(id, "lookup"))
/** Mark a shipment as shipped outside Medusa. */
export const useDpdSkip = () => useAction<Record<never, never>, ActionResponse>((id) => shipmentPath(id, "skip"))
/** Accept the waybills DPD gave for a shipment that does not match. */
export const useDpdAccept = () => useAction<Record<never, never>, ActionResponse>((id) => shipmentPath(id, "accept"))

/** Set the boxes by hand (null: back to automatic); the answer is the fresh plan, put straight into its query. */
export function useDpdBoxes() {
  const client = useQueryClient()
  return useMutation<PlanResponse, unknown, { id: string } & BoxesRequest>({
    mutationFn: ({ id, ...body }) => dpdFetch<PlanResponse>(shipmentPath(id, "boxes"), { method: "POST", body }),
    onSuccess: (data, vars) => client.setQueryData(dpdKeys.plan(vars.id), data),
    onSettled: () => void client.invalidateQueries({ queryKey: dpdKeys.all }),
  })
}

/** Demo mode only: the sample rows, built once on the first visit (reads never write). */
export const useDpdDemoSeed = () => usePost<DemoSeedResponse>("/admin/dpd/demo/seed")
/** Demo mode only: removes the demo rows and keys; the page builds the sample rows again right after. */
export const useDpdDemoReset = () => usePost<DemoResetResponse>("/admin/dpd/demo/reset")
