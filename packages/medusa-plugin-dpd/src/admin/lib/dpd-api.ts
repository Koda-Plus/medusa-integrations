import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import type {
  ActionResponse,
  AvailabilityResponse,
  BoxesRequest,
  CreateDispatchRequest,
  CreateRequest,
  DemoResetResponse,
  DemoSeedResponse,
  DispatchFilter,
  DispatchPlanResponse,
  DispatchResponse,
  DispatchState,
  DispatchesResponse,
  GroupAvailabilityRequest,
  LabelRequest,
  OrderDpdResponse,
  PlanResponse,
  PointsResponse,
  SetPointRequest,
  ShipmentFilter,
  ShipmentResponse,
  ShipmentsResponse,
  StatusResponse,
  WithdrawResponse,
  WriterRequest,
  WritersResponse,
} from "../../modules/dpd/lib/contract"

import { backendUrl, kitRequestInit } from "./dpd-kit"
import { DpdRequestError, dispatchLeftClaim, fetchLabelFile, isClaimedDispatch, parseJson, pointsQuery, requestError } from "./dpd-logic"

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
  /** A point search of the admin, by its query (zip, city, cod). */
  points: (q: Record<string, string>) => ["dpd", "points", q] as const,
  /** A page of the handover list. */
  dispatches: (q: { filter: DispatchFilter; offset: number; limit: number }) => ["dpd", "dispatches", q] as const,
  dispatch: (id: string) => ["dpd", "dispatch", id] as const,
  /** ids sorted, so the same selection in another order reuses the query. */
  dispatchPlan: (ids: readonly string[]) => ["dpd", "dispatchPlan", [...ids].sort()] as const,
}

/**
 * The courier hours of a handover or of a group of a plan. Outside
 * dpdKeys.all on purpose: every action invalidates dpdKeys.all, and reading
 * the hours again is a call to DPD.
 */
export const availabilityKey = (target: `dispatch:${string}` | `group:${string}`) => ["dpd-availability", target] as const

export const dispatchPath = (id: string, action?: string) => `/admin/dpd/dispatches/${encodeURIComponent(id)}${action ? `/${action}` : ""}`

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

/** Backend URL of a stored handover protocol: the newest, or one document of the protocols list. */
export function protocolUrl(id: string, opts: { download: boolean; document?: string }): string {
  const params = new URLSearchParams()
  if (opts.download) params.set("download", "1")
  if (opts.document) params.set("document", opts.document)
  const query = params.toString()
  return `${backendUrl()}${dispatchPath(id, "protocol")}${query ? `?${query}` : ""}`
}

/**
 * Opens a stored protocol in a new tab, or saves it, the same way as a label
 * (openLabel): the tab first, while the click still allows it, then the PDF
 * with the dashboard's auth, opened from memory. A refusal closes the tab
 * and goes to the caller; a blocked tab falls back to saving the file.
 */
export async function openProtocol(id: string, opts: { download: boolean; document?: string }): Promise<void> {
  const tab = opts.download ? null : window.open("", "_blank")
  try {
    const { blob, fileName } = await fetchLabelFile((url, init) => fetch(url, init), protocolUrl(id, opts), kitRequestInit({ headers: { Accept: "application/pdf, application/json" } }), `dpd-protocol-${id.replace(/[^\w-]/g, "_")}.pdf`)
    const url = URL.createObjectURL(blob)
    if (tab && !tab.closed) {
      tab.opener = null
      tab.location.href = url
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

/**
 * The DPD Pickup points a parcel can go to near a postal code (and city),
 * from the source of the mode (MyPudo, the test or the sample catalog). Runs
 * only with a five digit postal code; the panel has no map, so no search by
 * coordinates. A search is kept 5 minutes (the route caches it longer).
 */
export function useDpdPoints(q: { zip?: string; city?: string; cod?: boolean } | null): UseQueryResult<PointsResponse, Error> {
  const query = pointsQuery(q)
  return useQuery<PointsResponse, Error>({
    queryKey: dpdKeys.points(query ?? {}),
    queryFn: () => dpdFetch<PointsResponse>(`/admin/dpd/points?${new URLSearchParams(query ?? {}).toString()}`),
    enabled: query !== null,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/**
 * Change the Pickup point of a shipment before it is created. The answer is
 * the fresh plan with the new point, put straight into its query (like the
 * boxes), so the drawer shows it without reading the point again. Every
 * answer refreshes the lists, the shipment and the order card; a 409 (the
 * row moved on) also reads the plan again. A refused point (422) changes
 * nothing.
 */
export function useDpdSetPoint(id: string): UseMutationResult<PlanResponse, Error, SetPointRequest> {
  const client = useQueryClient()
  return useMutation<PlanResponse, Error, SetPointRequest>({
    mutationFn: (body) => dpdFetch<PlanResponse>(shipmentPath(id, "point"), { method: "POST", body }),
    onSuccess: (data) => client.setQueryData(dpdKeys.plan(id), data),
    onError: (err) => {
      if (err instanceof DpdRequestError && err.status === 409) void client.invalidateQueries({ queryKey: dpdKeys.plan(id) })
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: [...dpdKeys.all, "shipments"] })
      void client.invalidateQueries({ queryKey: dpdKeys.shipment(id) })
      void client.invalidateQueries({ queryKey: [...dpdKeys.all, "order"] })
    },
  })
}

/* ------------------------------------------------------------------ */
/* Handovers to the courier                                            */
/* ------------------------------------------------------------------ */

/** A page of the handover list; the previous page stays on screen while the next one loads. */
export function useDpdDispatches(q: { filter: DispatchFilter; offset: number; limit: number }): UseQueryResult<DispatchesResponse, Error> {
  const params = new URLSearchParams({ filter: q.filter, offset: String(q.offset), limit: String(q.limit) })
  return useQuery<DispatchesResponse, Error>({
    queryKey: dpdKeys.dispatches(q),
    queryFn: () => dpdFetch<DispatchesResponse>(`/admin/dpd/dispatches?${params.toString()}`),
    placeholderData: (previous) => previous,
  })
}

/**
 * One handover with its history; read every 3 s while a request works on it
 * (printing, ordering, changing). Only this view polls, so once the poll sees
 * the work end everything under dpdKeys.all is read again, once: the list,
 * the shipments and the tile would else keep the claimed state. A fetch
 * already running (the onSettled of the request) is reused, not restarted.
 */
export function useDpdDispatch(id: string | null): UseQueryResult<DispatchResponse, Error> {
  const client = useQueryClient()
  const q = useQuery<DispatchResponse, Error>({
    queryKey: dpdKeys.dispatch(id ?? ""),
    queryFn: () => dpdFetch<DispatchResponse>(dispatchPath(id ?? "")),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const state = query.state.data?.dispatch.state
      return state && isClaimedDispatch(state) ? 3000 : false
    },
  })
  const state = q.data?.dispatch.state ?? null
  const seen = useRef<{ id: string | null; state: DispatchState | null }>({ id, state })
  useEffect(() => {
    const before = seen.current
    seen.current = { id, state }
    if (before.id === id && dispatchLeftClaim(before.state, state)) void client.invalidateQueries({ queryKey: dpdKeys.all }, { cancelRefetch: false })
  }, [client, id, state])
  return q
}

/**
 * The plan of a handover for the selected shipments, read now (a read, like
 * useDpdPlan): never cached, so a create always follows a fresh read. null
 * turns it off, also once the handover exists.
 */
export function useDpdDispatchPlan(ids: readonly string[] | null): UseQueryResult<DispatchPlanResponse, Error> {
  return useQuery<DispatchPlanResponse, Error>({
    queryKey: dpdKeys.dispatchPlan(ids ?? []),
    queryFn: () => dpdFetch<DispatchPlanResponse>("/admin/dpd/dispatch-plan", { method: "POST", body: { shipmentIds: ids ?? [] } }),
    enabled: ids !== null && ids.length > 0,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

/** The courier hours of a handover, while the courier form is open. Kept a minute; never retried by itself. */
export function useDpdDispatchAvailability(id: string | null, enabled: boolean): UseQueryResult<AvailabilityResponse, Error> {
  return useQuery<AvailabilityResponse, Error>({
    queryKey: availabilityKey(`dispatch:${id ?? ""}`),
    queryFn: () => dpdFetch<AvailabilityResponse>(dispatchPath(id ?? "", "availability")),
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
    retry: false,
  })
}

/** The courier hours of one group of a plan, before the handover exists (13.1a). Same rules as for a handover. */
export function useDpdGroupAvailability(input: GroupAvailabilityRequest | null): UseQueryResult<AvailabilityResponse, Error> {
  const ids = input ? [...input.shipmentIds].sort() : []
  return useQuery<AvailabilityResponse, Error>({
    queryKey: availabilityKey(`group:${input?.groupKey ?? ""}:${ids.join(",")}`),
    queryFn: () => dpdFetch<AvailabilityResponse>("/admin/dpd/courier-availability", { method: "POST", body: { shipmentIds: ids, groupKey: input?.groupKey ?? "" } }),
    enabled: input !== null && ids.length > 0 && Boolean(input.groupKey),
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * Create a handover from the plan that was read (its hash). The answer is the
 * new handover, put straight into its query; every answer, a refusal too,
 * invalidates what the page shows.
 */
export function useDpdCreateDispatch(): UseMutationResult<DispatchResponse, Error, CreateDispatchRequest> {
  const client = useQueryClient()
  return useMutation<DispatchResponse, Error, CreateDispatchRequest>({
    mutationFn: (body) => dpdFetch<DispatchResponse>("/admin/dpd/dispatches", { method: "POST", body }),
    onSuccess: (data) => client.setQueryData(dpdKeys.dispatch(data.dispatch.id), data),
    onSettled: () => void client.invalidateQueries({ queryKey: dpdKeys.all }),
  })
}

/**
 * A POST on one record whose id the hook already knows: the variables are the
 * body. Every answer, a refusal too, invalidates what the page shows.
 */
function useBoundAction<TBody, TResult>(path: string) {
  const client = useQueryClient()
  return useMutation<TResult, Error, TBody>({
    mutationFn: (body) => dpdFetch<TResult>(path, { method: "POST", body: body ?? {} }),
    onSettled: () => void client.invalidateQueries({ queryKey: dpdKeys.all }),
  })
}

/** The actions of a handover, each a POST on .../dispatches/:id/<action>. */
export type DispatchActionPath = "print" | "order" | "reschedule" | "cancel-courier" | "resolve" | "cancel"

/**
 * One step of a run on a handover the same drawer has just created: its id
 * is known only after the create, so it comes with the step. Same rules as
 * useDpdDispatchAction.
 */
export function useDpdDispatchStep(): UseMutationResult<DispatchResponse, Error, { id: string; action: DispatchActionPath; body?: object }> {
  const client = useQueryClient()
  return useMutation<DispatchResponse, Error, { id: string; action: DispatchActionPath; body?: object }>({
    mutationFn: ({ id, action, body }) => dpdFetch<DispatchResponse>(dispatchPath(id, action), { method: "POST", body: body ?? {} }),
    onSettled: () => void client.invalidateQueries({ queryKey: dpdKeys.all }),
  })
}

export function useDpdDispatchAction<TBody>(id: string, action: DispatchActionPath): UseMutationResult<DispatchResponse, Error, TBody> {
  return useBoundAction<TBody, DispatchResponse>(dispatchPath(id, action))
}
/** Mark a shipment "do not send" (DS15). */
export function useDpdExclude(id: string): UseMutationResult<ActionResponse, Error, Record<string, never>> {
  return useBoundAction<Record<string, never>, ActionResponse>(shipmentPath(id, "exclude"))
}
/** Back to the shipments to send. */
export function useDpdRestore(id: string): UseMutationResult<ActionResponse, Error, Record<string, never>> {
  return useBoundAction<Record<string, never>, ActionResponse>(shipmentPath(id, "restore"))
}
/** Take a shipment out of its handover (DS12). */
export function useDpdWithdraw(id: string): UseMutationResult<WithdrawResponse, Error, Record<string, never>> {
  return useBoundAction<Record<string, never>, WithdrawResponse>(shipmentPath(id, "withdraw"))
}

/** Demo mode only: the sample rows, built once on the first visit (reads never write). */
export const useDpdDemoSeed = () => usePost<DemoSeedResponse>("/admin/dpd/demo/seed")
/** Demo mode only: removes the demo rows and keys; the page builds the sample rows again right after. */
export const useDpdDemoReset = () => usePost<DemoResetResponse>("/admin/dpd/demo/reset")
