/**
 * THE PARTNER API CALLS BEYOND THE ADVERT LIST, each one documented in
 * docs/olx-api-notes.md. Every call takes a fresh access token from the
 * connection, retries once after a 401 with a refreshed token, and notes the
 * IP block so the other jobs of the process wait.
 *
 * Reads (scope `read`):
 *   GET /adverts/{id}                     one advert, all fields
 *   GET /adverts?external_id=             the lookup before every create
 *   GET /adverts/{id}/statistics          views, phone views, observers
 *   GET /threads?offset&limit             message threads
 *   GET /categories/{id}                  photos limit, leaf flag
 *   GET /categories/{id}/attributes       what a category requires
 *
 * Writes (scope `write`, and only for the writer armed for the call):
 *   POST /adverts/{id}/commands           activate, deactivate, finish
 *   PUT  /adverts/{id}                    the whole advert, new price
 *   POST /adverts                         a new advert
 */

import type OlxModuleService from "../service"
import type { AdvertSnapshot, FoundAdvert } from "./apply"
import { noteIpBlock } from "./block"
import { OlxApiError } from "./client"
import { BLOCK_PAUSE_MS, PAGE_SIZE, THREADS_MAX_PAGES, THREADS_PAGE_SIZE } from "./constants"
import { accessToken, clientFor } from "./connection"
import { OlxUnknownResultError } from "./errors"
import type { LifecycleCommand } from "./lifecycle"
import { advertData, advertPrice, advertStatus } from "./pricing"
import type { WriteKind } from "./security"
import { parseThreads, type OlxThreadInput } from "./threads"

function note(err: unknown): void {
  if (err instanceof OlxApiError && err.blocked) noteIpBlock(Date.now(), BLOCK_PAUSE_MS)
}

/** Runs `fn` with an access token; after a 401 once more with a refreshed one. */
export async function withToken<T>(svc: OlxModuleService, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await accessToken(svc))
  } catch (err) {
    note(err)
    if (err instanceof OlxApiError && err.status === 401) {
      try {
        return await fn(await accessToken(svc, true))
      } catch (err2) {
        note(err2)
        throw err2
      }
    }
    throw err
  }
}

function snapshotOf(raw: unknown): AdvertSnapshot {
  return { status: advertStatus(raw), price: advertPrice(raw), raw }
}

/** One advert with all its fields, or null when OLX says 404. */
export async function readAdvert(svc: OlxModuleService, olxId: string): Promise<AdvertSnapshot | null> {
  try {
    const raw = await withToken(svc, (t) => clientFor(svc).get<unknown>(`/adverts/${encodeURIComponent(olxId)}`, {}, t))
    return advertData(raw) ? snapshotOf(raw) : null
  } catch (err) {
    if (err instanceof OlxApiError && err.status === 404) return null
    throw err
  }
}

/** Adverts of the account carrying this `external_id`, in any status. */
export async function findAdvertsByExternalId(svc: OlxModuleService, externalId: string): Promise<FoundAdvert[]> {
  const raw = await withToken(svc, (t) =>
    clientFor(svc).get<{ data?: unknown[] }>("/adverts", { external_id: externalId, limit: String(PAGE_SIZE), offset: "0" }, t),
  )
  const list = Array.isArray(raw?.data) ? raw.data : []
  const out: FoundAdvert[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const a = item as Record<string, unknown>
    const id = String(a.id ?? "").trim()
    if (!id) continue
    out.push({
      olxId: id,
      url: typeof a.url === "string" ? a.url : null,
      status: typeof a.status === "string" ? a.status : null,
      externalId: a.external_id === null || a.external_id === undefined ? null : String(a.external_id),
    })
  }
  return out
}

export async function readAdvertStatistics(svc: OlxModuleService, olxId: string): Promise<unknown | null> {
  try {
    return await withToken(svc, (t) => clientFor(svc).get<unknown>(`/adverts/${encodeURIComponent(olxId)}/statistics`, {}, t))
  } catch (err) {
    if (err instanceof OlxApiError && err.status === 404) return null
    throw err
  }
}

export interface ThreadsRead {
  threads: OlxThreadInput[]
  complete: boolean
  pages: number
  reason: string | null
}

/**
 * Every thread of the account. Moves by the number of threads received and
 * stops on an empty page (see `threads.ts`); a failed page or the ceiling
 * marks the read incomplete.
 */
export async function readAllThreads(svc: OlxModuleService): Promise<ThreadsRead> {
  const collected = new Map<string, OlxThreadInput>()
  let offset = 0
  let pages = 0
  for (let page = 0; page < THREADS_MAX_PAGES; page += 1) {
    let raw: unknown
    try {
      raw = await withToken(svc, (t) =>
        clientFor(svc).get<unknown>("/threads", { offset: String(offset), limit: String(THREADS_PAGE_SIZE) }, t),
      )
    } catch (err) {
      return { threads: [...collected.values()], complete: false, pages, reason: svc.mask(err instanceof Error ? err.message : String(err)) }
    }
    pages += 1
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).data)
        ? ((raw as Record<string, unknown>).data as unknown[])
        : []
    if (list.length === 0) return { threads: [...collected.values()], complete: true, pages, reason: null }
    for (const t of parseThreads(list)) collected.set(t.key, t)
    offset += list.length
  }
  return { threads: [...collected.values()], complete: false, pages, reason: `stopped at the ceiling of ${THREADS_MAX_PAGES} pages` }
}

export async function readCategory(svc: OlxModuleService, categoryId: number): Promise<unknown> {
  return withToken(svc, (t) => clientFor(svc).get<unknown>(`/categories/${categoryId}`, {}, t))
}

export async function readCategoryAttributes(svc: OlxModuleService, categoryId: number): Promise<unknown> {
  return withToken(svc, (t) => clientFor(svc).get<unknown>(`/categories/${categoryId}/attributes`, {}, t))
}

/* ---- writes ------------------------------------------------------- */

export async function sendAdvertCommand(
  svc: OlxModuleService,
  olxId: string,
  command: LifecycleCommand,
  isSuccess: boolean,
  allow: readonly WriteKind[],
): Promise<void> {
  const body: Record<string, unknown> = { command }
  if (command === "deactivate") body.is_success = isSuccess
  await withToken(svc, (t) => clientFor(svc).send("POST", `/adverts/${encodeURIComponent(olxId)}/commands`, body, t, allow))
}

export async function updateAdvert(
  svc: OlxModuleService,
  olxId: string,
  body: Record<string, unknown>,
  allow: readonly WriteKind[],
): Promise<AdvertSnapshot | null> {
  const raw = await withToken(svc, (t) => clientFor(svc).send("PUT", `/adverts/${encodeURIComponent(olxId)}`, body, t, allow))
  return advertData(raw) ? snapshotOf(raw) : null
}

export async function createAdvert(svc: OlxModuleService, body: Record<string, unknown>, allow: readonly WriteKind[]): Promise<FoundAdvert> {
  const raw = await withToken(svc, (t) => clientFor(svc).send("POST", "/adverts", body, t, allow))
  const a = advertData(raw)
  const id = a ? String(a.id ?? "").trim() : ""
  if (!a || !id) {
    /* OLX accepted the request (2xx) but the answer carries no advert id: it may exist. */
    throw new OlxUnknownResultError("POST /adverts", new Error("a success answer without the advert id"))
  }
  return {
    olxId: id,
    url: typeof a.url === "string" ? a.url : null,
    status: typeof a.status === "string" ? a.status : null,
    externalId: a.external_id === null || a.external_id === undefined ? null : String(a.external_id),
  }
}
