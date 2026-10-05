/**
 * CONNECTION TO THE ALLEGRO ACCOUNT: device login, tokens, and the two doors
 * every request goes through (`apiGet` for reads, `apiSend` for writes).
 *
 * THREE THINGS THIS FILE NEVER DOES: write to Allegro outside the allowlist
 * (barrier in security.ts), hand tokens outside the module (they are
 * decrypted only for one call) and touch the catalog.
 *
 * CONNECTING IS A DEVICE LOGIN, NO REDIRECT URI NEEDED:
 *   1. `startConnecting()` asks Allegro for a code, stores the device code
 *      encrypted and returns the code a person types at allegro.pl.
 *   2. The admin polls `pollConnecting()` every few seconds; the scheduled
 *      offer job polls once per run as a safety net. When the seller approves,
 *      the poll receives the token pair and stores it encrypted.
 * The state lives in the database, so a deploy in the middle of a login loses
 * nothing.
 *
 * ONE REFRESH AT A TIME, ACROSS PROCESSES. Allegro rotates the refresh token
 * on every refresh and keeps the old one alive for 60 seconds. Inside one
 * process a queue serializes refreshes; across processes (a server and a
 * worker) a lease on the connection row does: one process refreshes, the
 * other waits and reads the new token. Without a database connection bound
 * (`bindDb`) the queue alone works, as in 0.1.
 */

import { randomUUID } from "node:crypto"
import type AllegroModuleService from "../service"
import { AllegroApiError, AllegroClient, type TokenPair, type WriteRequest, type WriteResponse } from "./client"
import {
  CONNECTION_ID,
  MAX_OFFER_PAGES,
  MAX_ORDER_PAGES,
  OFFERS_PAGE_SIZE,
  ORDERS_PAGE_SIZE,
  REFRESH_LEASE_MS,
  REFRESH_MARGIN_MS,
  allegroUrls,
} from "./constants"
import { AllegroCryptoError, decrypt, encrypt, keyFromBase64 } from "./crypto"
import { offersFromApi, type AllegroOfferInput } from "./offers"
import { scopesFor } from "./options"
import { ordersFromApi, type AllegroOrderInput } from "./orders"
import { releaseRefreshLease, takeRefreshLease, type SqlRunner } from "./store"

export interface ConnectionRow {
  id: string
  environment: string
  refresh_token_enc: string | null
  access_token_enc: string | null
  access_expires_at: Date | null
  refreshed_at: Date | null
  connected_at: Date | null
  disconnected_at: Date | null
  scope: string | null
  device_code_enc: string | null
  user_code: string | null
  device_expires_at: Date | null
  device_interval_s: number | null
  last_error: string | null
  last_error_at: Date | null
  refresh_lease_until?: Date | string | null
  refresh_lease_owner?: string | null
  version: number
}

export interface OffersRead {
  offers: AllegroOfferInput[]
  /** Offers per Allegro status. */
  statuses: Record<string, number>
  /**
   * Whether the whole list was read. MORE IMPORTANT THAN THE LIST: an
   * incomplete list passed as complete would unlink offers that are live
   * right now. Complete means: no page failed and we collected as many
   * offers as the first page announced in `totalCount`.
   */
  complete: boolean
  totalCount: number | null
  pages: number
  reason: string | null
}

export interface OrdersRead {
  orders: AllegroOrderInput[]
  complete: boolean
  pages: number
  reason: string | null
}

export type ConnectStep = "pending" | "connected" | "denied" | "expired" | "none"

/* ------------------------------------------------------------------ */
/* One queue for everything that touches tokens, inside a process      */
/* ------------------------------------------------------------------ */

const QUEUE_KEY = Symbol.for("koda.allegro.tokenQueue")

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const holder = globalThis as typeof globalThis & { [QUEUE_KEY]?: Promise<unknown> }
  const previous = holder[QUEUE_KEY] ?? Promise.resolve()
  const step = previous.then(work)
  holder[QUEUE_KEY] = step.then(
    () => undefined,
    () => undefined,
  )
  return step
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const clients = new WeakMap<object, AllegroClient>()
const databases = new WeakMap<object, SqlRunner>()

/** Gives the module service a database connection for the cross-process refresh lease. */
export function bindDb(svc: AllegroModuleService, db: SqlRunner | null | undefined): void {
  if (db && typeof db.raw === "function") databases.set(svc, db)
}

export function dbFor(svc: AllegroModuleService): SqlRunner | null {
  return databases.get(svc) ?? null
}

export function clientFor(svc: AllegroModuleService): AllegroClient {
  let client = clients.get(svc)
  if (!client) {
    const o = svc.getOptions()
    client = new AllegroClient({
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      urls: allegroUrls(o.environment),
      scope: scopesFor(o),
      requestsPerMinute: o.requestsPerMinute,
      timeoutMs: o.timeoutMs,
      userAgent: o.userAgent,
      logger: svc.getLogger(),
    })
    clients.set(svc, client)
  }
  return client
}

/* ------------------------------------------------------------------ */
/* The connection row                                                  */
/* ------------------------------------------------------------------ */

export async function getConnectionRow(svc: AllegroModuleService): Promise<ConnectionRow | null> {
  const rows = (await svc.listAllegroConnections({ id: CONNECTION_ID } as never, { take: 1 })) as unknown as ConnectionRow[]
  return rows[0] ?? null
}

/**
 * The row, but ONLY when its tokens come from the configured environment.
 * After switching from sandbox to production, sandbox tokens would otherwise
 * pass for a production connection and the job would send them to the
 * production API every hour.
 */
async function rowOfThisEnvironment(svc: AllegroModuleService): Promise<ConnectionRow | null> {
  const row = await getConnectionRow(svc)
  if (!row) return null
  return row.environment === svc.getOptions().environment ? row : null
}

/** Explains an environment mismatch for the admin, or null. */
export function environmentMismatch(svc: AllegroModuleService, row: ConnectionRow | null): string | null {
  if (!row || !row.refresh_token_enc) return null
  const env = svc.getOptions().environment
  if (row.environment === env) return null
  return `The stored tokens come from the ${row.environment} environment and the plugin is set to ${env}. Connect the account again.`
}

async function save(svc: AllegroModuleService, changes: Partial<ConnectionRow>): Promise<void> {
  const row = await getConnectionRow(svc)
  if (row) {
    await svc.updateAllegroConnections({ id: CONNECTION_ID, ...changes, version: (row.version ?? 0) + 1 } as never)
    return
  }
  await svc.createAllegroConnections({
    id: CONNECTION_ID,
    environment: svc.getOptions().environment,
    version: 1,
    ...changes,
  } as never)
}

function key(svc: AllegroModuleService): Buffer {
  return keyFromBase64(svc.getOptions().encryptionKey)
}

/** Whether we hold a refresh token for the configured environment. */
export async function isConnected(svc: AllegroModuleService): Promise<boolean> {
  if (svc.isDemo() || !svc.isConfigured()) return false
  const row = await rowOfThisEnvironment(svc)
  return Boolean(row?.refresh_token_enc)
}

/** The scope string of the stored token (what the seller granted), or null. */
export async function grantedScope(svc: AllegroModuleService): Promise<string | null> {
  if (svc.isDemo()) return null
  const row = await rowOfThisEnvironment(svc)
  return row?.refresh_token_enc ? row.scope ?? "" : null
}

/** A device login waiting for the seller, with the address and the code to show. */
export function activeConnecting(
  svc: AllegroModuleService,
  row: ConnectionRow | null,
): { userCode: string; url: string; expiresAt: string; intervalS: number } | null {
  if (svc.isDemo() || !svc.isConfigured()) return null
  if (!row || row.environment !== svc.getOptions().environment) return null
  if (!row.device_code_enc || !row.user_code || !row.device_expires_at) return null
  const expires = new Date(row.device_expires_at)
  if (expires.getTime() <= Date.now()) return null
  const link = allegroUrls(svc.getOptions().environment).link
  return {
    userCode: row.user_code,
    url: `${link}?code=${encodeURIComponent(row.user_code)}`,
    expiresAt: expires.toISOString(),
    intervalS: row.device_interval_s ?? 5,
  }
}

/* ------------------------------------------------------------------ */
/* Device login                                                        */
/* ------------------------------------------------------------------ */

/** Step one: a code for the seller, valid for an hour. Every click draws a new one. */
export async function startConnecting(svc: AllegroModuleService): Promise<void> {
  if (svc.isDemo()) throw new Error("Demo mode: connecting is disabled.")
  if (!svc.isConfigured()) throw new Error(`Missing options: ${svc.missingOptions().join(", ")}`)
  const start = await clientFor(svc).startDevice()
  const now = Date.now()
  await enqueue(() =>
    save(svc, {
      environment: svc.getOptions().environment,
      device_code_enc: encrypt(start.device_code, key(svc)),
      user_code: start.user_code,
      device_expires_at: new Date(now + start.expires_in * 1000),
      device_interval_s: start.interval,
      last_error: null,
      last_error_at: null,
    }),
  )
}

async function clearDevice(svc: AllegroModuleService, reason: string): Promise<void> {
  await save(svc, {
    device_code_enc: null,
    user_code: null,
    device_expires_at: null,
    device_interval_s: null,
    last_error: reason,
    last_error_at: new Date(),
  })
}

/** Step two, one poll. The admin calls it every few seconds while the code is shown. */
export function pollConnecting(svc: AllegroModuleService): Promise<{ state: ConnectStep; intervalS: number | null }> {
  return enqueue(async () => {
    if (svc.isDemo() || !svc.isConfigured()) return { state: "none" as const, intervalS: null }
    const row = await rowOfThisEnvironment(svc)
    if (!row?.device_code_enc || !row.device_expires_at) return { state: "none" as const, intervalS: null }
    if (new Date(row.device_expires_at).getTime() <= Date.now()) {
      await clearDevice(svc, "The code expired before the seller confirmed it.")
      return { state: "expired" as const, intervalS: null }
    }
    let deviceCode: string
    try {
      deviceCode = decrypt(row.device_code_enc, key(svc))
    } catch (err) {
      await clearDevice(svc, `The encryption key changed during the login (${err instanceof Error ? err.message : String(err)}).`)
      return { state: "expired" as const, intervalS: null }
    }
    const interval = row.device_interval_s ?? 5
    const poll = await clientFor(svc).pollDevice(deviceCode, interval)
    if (poll.state === "pending") {
      if (poll.intervalS !== interval) await save(svc, { device_interval_s: poll.intervalS })
      return { state: "pending" as const, intervalS: poll.intervalS }
    }
    if (poll.state === "denied") {
      await clearDevice(svc, "The seller refused access on allegro.pl.")
      return { state: "denied" as const, intervalS: null }
    }
    if (poll.state === "expired") {
      await clearDevice(svc, "The code expired or was already used.")
      return { state: "expired" as const, intervalS: null }
    }
    await savePair(svc, poll.pair, {
      connected_at: new Date(),
      disconnected_at: null,
      device_code_enc: null,
      user_code: null,
      device_expires_at: null,
      device_interval_s: null,
    })
    svc.getLogger().info(`[allegro] Account connected, scope: ${poll.pair.scope || "(none)"}`)
    return { state: "connected" as const, intervalS: null }
  })
}

/** Forgets the tokens. The consent on the Allegro side stays; the seller removes it in the account settings. */
export function disconnect(svc: AllegroModuleService, reason: string | null = null): Promise<void> {
  return enqueue(() =>
    save(svc, {
      refresh_token_enc: null,
      access_token_enc: null,
      access_expires_at: null,
      disconnected_at: new Date(),
      device_code_enc: null,
      user_code: null,
      device_expires_at: null,
      device_interval_s: null,
      ...(reason ? { last_error: reason, last_error_at: new Date() } : { last_error: null, last_error_at: null }),
    }),
  )
}

async function savePair(svc: AllegroModuleService, pair: TokenPair, rest: Partial<ConnectionRow> = {}): Promise<void> {
  const k = key(svc)
  await save(svc, {
    environment: svc.getOptions().environment,
    refresh_token_enc: encrypt(pair.refresh_token, k),
    access_token_enc: encrypt(pair.access_token, k),
    access_expires_at: new Date(Date.now() + pair.expires_in * 1000),
    refreshed_at: new Date(),
    scope: pair.scope || null,
    last_error: null,
    last_error_at: null,
    ...rest,
  })
}

/* ------------------------------------------------------------------ */
/* Access token                                                        */
/* ------------------------------------------------------------------ */

function expiresAt(row: ConnectionRow | null): number {
  return row?.access_expires_at ? new Date(row.access_expires_at).getTime() : 0
}

/** The access token stored by another process, when it is fresh enough to use. */
function freshStoredAccess(svc: AllegroModuleService, row: ConnectionRow | null): string | null {
  if (!row?.access_token_enc) return null
  if (expiresAt(row) - Date.now() <= REFRESH_MARGIN_MS) return null
  try {
    return decrypt(row.access_token_enc, key(svc))
  } catch {
    return null
  }
}

async function refreshWith(svc: AllegroModuleService, refresh: string): Promise<string> {
  try {
    const pair = await clientFor(svc).refresh(refresh)
    /* After a disconnect we never bring tokens back: the refresh may have
     * hung for 20 s while somebody clicked "Disconnect". */
    const now = await rowOfThisEnvironment(svc)
    if (!now?.refresh_token_enc) throw new AllegroApiError(0, "The Allegro account was disconnected during the token refresh.", false)
    await savePair(svc, pair)
    return pair.access_token
  } catch (err) {
    const reason = svc.mask(err instanceof Error ? err.message : String(err))
    const permanent = err instanceof AllegroApiError && !err.transient && err.status >= 400 && err.status < 500
    if (permanent) {
      /* Refresh token revoked: it will not come back by itself, so we
       * disconnect instead of failing every hour. */
      await save(svc, {
        refresh_token_enc: null,
        access_token_enc: null,
        access_expires_at: null,
        disconnected_at: new Date(),
        last_error: `Disconnected, Allegro rejected the refresh token: ${reason}. Connect the account again.`,
        last_error_at: new Date(),
      })
    } else {
      await save(svc, { last_error: `Token refresh: ${reason}`, last_error_at: new Date() })
    }
    throw err
  }
}

/**
 * Another process holds the refresh lease: wait for its new token. Returns
 * null when the lease ends without a new token (that process died), and the
 * caller tries to take the lease itself.
 */
async function waitForOtherRefresh(svc: AllegroModuleService, version: number): Promise<string | null> {
  const deadline = Date.now() + REFRESH_LEASE_MS + 2000
  while (Date.now() < deadline) {
    await sleep(1000)
    const row = await rowOfThisEnvironment(svc)
    if (!row?.refresh_token_enc) throw new AllegroApiError(0, "The Allegro account is not connected.", false)
    if ((row.version ?? 0) !== version) {
      const fresh = freshStoredAccess(svc, row)
      if (fresh) return fresh
    }
    const leaseUntil = row.refresh_lease_until ? new Date(row.refresh_lease_until).getTime() : 0
    if (!leaseUntil || leaseUntil < Date.now()) return null
  }
  return null
}

/**
 * A valid access token, refreshed ahead of time (ten minutes before the end
 * of its 12 hours). The refresh token lives three months from the last
 * refresh and the hourly sync refreshes twice a day, so in normal operation
 * it never expires.
 *
 * @param force Refresh despite validity; used after a 401 from the API.
 */
function accessToken(svc: AllegroModuleService, force = false): Promise<string> {
  return enqueue(async () => {
    const row = await rowOfThisEnvironment(svc)
    if (!row?.refresh_token_enc) throw new AllegroApiError(0, "The Allegro account is not connected.", false)
    const k = key(svc)
    let refresh: string
    let access: string | null = null
    try {
      refresh = decrypt(row.refresh_token_enc, k)
      if (row.access_token_enc) access = decrypt(row.access_token_enc, k)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      await save(svc, {
        refresh_token_enc: null,
        access_token_enc: null,
        access_expires_at: null,
        disconnected_at: new Date(),
        last_error: `Disconnected: ${reason}`,
        last_error_at: new Date(),
      })
      throw new AllegroApiError(0, `Allegro account disconnected: ${reason}`, false)
    }
    if (!force && access && expiresAt(row) - Date.now() > REFRESH_MARGIN_MS) return access

    const db = dbFor(svc)
    if (!db) return refreshWith(svc, refresh)

    for (let round = 0; round < 2; round += 1) {
      const owner = randomUUID()
      const taken = await takeRefreshLease(db, CONNECTION_ID, owner, REFRESH_LEASE_MS).catch(() => true)
      if (!taken) {
        const fresh = await waitForOtherRefresh(svc, row.version ?? 0)
        if (fresh) return fresh
        continue
      }
      try {
        /* Another process may have finished a refresh just before we took
         * the lease: its token is new, and our refresh token is the rotated
         * one. Use the stored token instead of refreshing again. */
        const latest = await rowOfThisEnvironment(svc)
        if (!latest?.refresh_token_enc) throw new AllegroApiError(0, "The Allegro account is not connected.", false)
        if ((latest.version ?? 0) !== (row.version ?? 0)) {
          const fresh = freshStoredAccess(svc, latest)
          if (fresh) return fresh
        }
        return await refreshWith(svc, decrypt(latest.refresh_token_enc, k))
      } finally {
        await releaseRefreshLease(db, CONNECTION_ID, owner).catch(() => undefined)
      }
    }
    throw new AllegroApiError(0, "Another process kept the token refresh lease; try again in a minute.", true)
  })
}

/* ------------------------------------------------------------------ */
/* The two doors: reads and writes                                     */
/* ------------------------------------------------------------------ */

/** GET with one retry on a fresh token after 401 (403 is a missing scope and is final). */
export async function apiGet<T>(
  svc: AllegroModuleService,
  path: string,
  query: Record<string, string | string[]>,
  accept?: string,
): Promise<T> {
  const token = await accessToken(svc)
  try {
    return await clientFor(svc).get<T>(path, query, token, accept)
  } catch (err) {
    if (err instanceof AllegroApiError && err.status === 401) {
      return clientFor(svc).get<T>(path, query, await accessToken(svc, true), accept)
    }
    throw err
  }
}

/**
 * A write behind the allowlist. A 401 means Allegro refused the request
 * before doing anything, so one retry on a fresh token is safe even for a
 * non-idempotent write.
 */
export async function apiSend<T>(svc: AllegroModuleService, req: WriteRequest): Promise<WriteResponse<T>> {
  const token = await accessToken(svc)
  try {
    return await clientFor(svc).send<T>(req, token)
  } catch (err) {
    if (err instanceof AllegroApiError && err.status === 401) {
      return clientFor(svc).send<T>(req, await accessToken(svc, true))
    }
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* Offers                                                              */
/* ------------------------------------------------------------------ */

interface OffersPage {
  offers?: unknown[]
  count?: number
  totalCount?: number
}

/**
 * Every offer of the account IN EVERY STATUS, 1 000 per page.
 *
 * BY ID, NOT BY LIST POSITION: the default order is newest first, so an offer
 * listed during the read shifts everything by one and the last offer of page
 * N comes back as the first of page N+1. The map drops the duplicate, and the
 * comparison with `totalCount` counts real offers.
 *
 * AN INCOMPLETE READ IS A FLAG, NOT AN EXCEPTION: the caller keeps what was
 * collected and removes nothing.
 */
export async function readAllOffers(svc: AllegroModuleService): Promise<OffersRead> {
  const collected = new Map<string, AllegroOfferInput>()
  let totalCount: number | null = null
  let pages = 0

  const countStatuses = (): Record<string, number> => {
    const statuses: Record<string, number> = {}
    for (const o of collected.values()) statuses[o.status] = (statuses[o.status] ?? 0) + 1
    return statuses
  }

  const incomplete = (err: unknown): OffersRead => {
    const reason = svc.mask(err instanceof Error ? err.message : String(err))
    if (err instanceof AllegroCryptoError) svc.getLogger().error(`[allegro] ${reason}`)
    return { offers: [...collected.values()], statuses: countStatuses(), complete: false, totalCount, pages, reason }
  }

  for (let page = 0; page < MAX_OFFER_PAGES; page += 1) {
    let res: OffersPage
    try {
      res = await apiGet<OffersPage>(svc, "/sale/offers", { limit: String(OFFERS_PAGE_SIZE), offset: String(page * OFFERS_PAGE_SIZE) })
    } catch (err) {
      return incomplete(err)
    }
    pages += 1
    if (totalCount === null && Number.isFinite(Number(res.totalCount))) totalCount = Number(res.totalCount)
    const data = Array.isArray(res.offers) ? res.offers : []
    for (const offer of offersFromApi(data).offers) collected.set(offer.allegroId, offer)
    if (data.length < OFFERS_PAGE_SIZE) break
    /* THE PAGE CEILING IS AN INCOMPLETE READ, not the end of the list. */
    if (page === MAX_OFFER_PAGES - 1) return incomplete(new Error(`stopped at the ceiling of ${MAX_OFFER_PAGES} pages`))
  }

  const statuses = countStatuses()
  const offers = [...collected.values()]
  if (totalCount !== null && offers.length < totalCount) {
    return {
      offers,
      statuses,
      complete: false,
      totalCount,
      pages,
      reason: `collected ${offers.length} of ${totalCount} offers (the list changed during the read)`,
    }
  }
  return { offers, statuses, complete: true, totalCount, pages, reason: null }
}

/* ------------------------------------------------------------------ */
/* Orders (read-only journal)                                          */
/* ------------------------------------------------------------------ */

interface OrdersPage {
  checkoutForms?: unknown[]
  count?: number
  totalCount?: number
}

/**
 * Orders changed since `since`, oldest change first, 100 per page. Upserted
 * by id, so a page boundary shifted by a fresh change only re-reads an order.
 */
export async function readOrdersSince(svc: AllegroModuleService, since: Date): Promise<OrdersRead> {
  const collected = new Map<string, AllegroOrderInput>()
  let pages = 0
  const incomplete = (err: unknown): OrdersRead => ({
    orders: [...collected.values()],
    complete: false,
    pages,
    reason: svc.mask(err instanceof Error ? err.message : String(err)),
  })

  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    let res: OrdersPage
    try {
      res = await apiGet<OrdersPage>(svc, "/order/checkout-forms", {
        "updatedAt.gte": since.toISOString(),
        sort: "updatedAt",
        limit: String(ORDERS_PAGE_SIZE),
        offset: String(page * ORDERS_PAGE_SIZE),
      })
    } catch (err) {
      return incomplete(err)
    }
    pages += 1
    const data = Array.isArray(res.checkoutForms) ? res.checkoutForms : []
    for (const order of ordersFromApi(data)) collected.set(order.allegroId, order)
    if (data.length < ORDERS_PAGE_SIZE) return { orders: [...collected.values()], complete: true, pages, reason: null }
  }
  return { ...incomplete(new Error(`stopped at the ceiling of ${MAX_ORDER_PAGES} pages`)) }
}
