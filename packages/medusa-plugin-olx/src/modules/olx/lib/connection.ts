/**
 * CONNECTION TO THE OLX ACCOUNT AND READING ITS ADVERTS.
 *
 * THREE THINGS THIS FILE NEVER DOES: write to OLX (barrier in security.ts),
 * hand tokens outside the module (they are decrypted only for one call) and
 * touch the catalog (the matching runs in the sync workflow).
 *
 * CONNECTING TAKES TWO STEPS, SEPARATED BY THE SELLER'S BROWSER:
 *   1. `startConnecting()` draws a `state` nonce, stores it for 15 minutes
 *      and returns the OLX consent URL.
 *   2. OLX sends the browser to `/olx/callback?code&state`; the route calls
 *      `completeConnecting(code, state)`, which checks the nonce, exchanges
 *      the code for a token pair and stores it encrypted.
 */

import { randomBytes } from "node:crypto"
import type OlxModuleService from "../service"
import { advertsFromPartnerApi, compilePatterns, type OlxAdvertInput } from "./adverts"
import { OlxApiError, OlxClient, type TokenPair } from "./client"
import { CONNECTION_ID, MAX_PAGES, PAGE_SIZE, REFRESH_MARGIN_MS, STATE_TTL_MS, olxUrls } from "./constants"
import { OlxCryptoError, decrypt, encrypt, keyFromBase64 } from "./crypto"
import { verifyState } from "./security"

export interface ConnectionRow {
  id: string
  refresh_token_enc: string | null
  access_token_enc: string | null
  access_expires_at: Date | null
  refreshed_at: Date | null
  connected_at: Date | null
  disconnected_at: Date | null
  scope: string | null
  state: string | null
  state_expires_at: Date | null
  last_error: string | null
  last_error_at: Date | null
  version: number
}

export interface AdvertsRead {
  adverts: OlxAdvertInput[]
  /** Adverts per OLX status, including the ones that are not live. */
  statuses: Record<string, number>
  /**
   * Whether the whole pagination was read. MORE IMPORTANT THAN THE LIST: an
   * incomplete list passed as complete would unlink items that are listed
   * right now. The Partner API gives no total, so complete means: no page
   * failed and the last page was shorter than 50.
   */
  complete: boolean
  pages: number
  reason: string | null
}

/* ------------------------------------------------------------------ */
/* One queue for everything that touches tokens                        */
/* ------------------------------------------------------------------ */

/**
 * Refreshes, the end of a connection attempt and disconnecting run one after
 * another. OLX rotates the refresh token on every refresh, so two parallel
 * refreshes (the hourly job and a click in the admin in the same minute)
 * would invalidate each other's tokens.
 */
const QUEUE_KEY = Symbol.for("koda.olx.tokenQueue")

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

const clients = new WeakMap<object, OlxClient>()

export function clientFor(svc: OlxModuleService): OlxClient {
  let client = clients.get(svc)
  if (!client) {
    const o = svc.getOptions()
    client = new OlxClient({
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      redirectUri: o.redirectUri,
      urls: olxUrls(o.market),
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

export async function getConnectionRow(svc: OlxModuleService): Promise<ConnectionRow | null> {
  const rows = (await svc.listOlxConnections({ id: CONNECTION_ID } as never, { take: 1 })) as unknown as ConnectionRow[]
  return rows[0] ?? null
}

async function save(svc: OlxModuleService, changes: Partial<ConnectionRow>): Promise<void> {
  const row = await getConnectionRow(svc)
  if (row) {
    await svc.updateOlxConnections({ id: CONNECTION_ID, ...changes, version: (row.version ?? 0) + 1 } as never)
    return
  }
  await svc.createOlxConnections({ id: CONNECTION_ID, version: 1, ...changes } as never)
}

function key(svc: OlxModuleService): Buffer {
  return keyFromBase64(svc.getOptions().encryptionKey)
}

/** Whether we hold a refresh token, i.e. whether there is anything to read with. */
export async function isConnected(svc: OlxModuleService): Promise<boolean> {
  if (svc.isDemo() || !svc.isConfigured()) return false
  const row = await getConnectionRow(svc)
  return Boolean(row?.refresh_token_enc)
}

/** A connection attempt still waiting for consent, with its consent URL. */
export function activeConnecting(
  svc: OlxModuleService,
  row: ConnectionRow | null,
): { url: string; expiresAt: string } | null {
  if (svc.isDemo() || !svc.isConfigured()) return null
  if (!row?.state || !row.state_expires_at) return null
  const expires = new Date(row.state_expires_at)
  if (expires.getTime() <= Date.now()) return null
  return { url: clientFor(svc).authorizeUrl(row.state), expiresAt: expires.toISOString() }
}

/* ------------------------------------------------------------------ */
/* Authorization code                                                  */
/* ------------------------------------------------------------------ */

/**
 * Step one: a new nonce valid for 15 minutes and the consent URL. Every click
 * on "Connect" draws a new nonce and invalidates the previous one.
 */
export async function startConnecting(svc: OlxModuleService): Promise<{ url: string; expiresAt: string }> {
  if (svc.isDemo()) throw new Error("Demo mode: connecting is disabled.")
  if (!svc.isConfigured()) throw new Error(`Missing options: ${svc.missingOptions().join(", ")}`)
  const state = randomBytes(24).toString("base64url")
  const expiresAt = new Date(Date.now() + STATE_TTL_MS)
  await enqueue(() =>
    save(svc, { state, state_expires_at: expiresAt, last_error: null, last_error_at: null }),
  )
  return { url: clientFor(svc).authorizeUrl(state), expiresAt: expiresAt.toISOString() }
}

/**
 * Step two, called by `/olx/callback`. Checks the nonce, exchanges the code
 * and stores the pair. Throws with a sentence fit for a human on the callback
 * page; it never carries the code or a token.
 */
export function completeConnecting(svc: OlxModuleService, code: string, state: string): Promise<void> {
  return enqueue(async () => {
    if (!svc.isConfigured()) throw new Error(`Missing options: ${svc.missingOptions().join(", ")}`)
    const row = await getConnectionRow(svc)
    const verdict = verifyState({ saved: row?.state, expiresAt: row?.state_expires_at, received: state, now: new Date() })
    if (!verdict.ok) {
      await save(svc, { last_error: verdict.reason, last_error_at: new Date() })
      throw new Error(verdict.reason)
    }
    if (!code.trim()) {
      await save(svc, { state: null, state_expires_at: null, last_error: "OLX sent the consent without a code.", last_error_at: new Date() })
      throw new Error("OLX sent the consent without a code.")
    }
    try {
      const pair = await clientFor(svc).exchangeCode(code.trim())
      await savePair(svc, pair, { connected_at: new Date(), disconnected_at: null, state: null, state_expires_at: null })
      svc.getLogger().info(`[olx] Account connected, scope: ${pair.scope || "(none)"}`)
    } catch (err) {
      const reason = svc.mask(err instanceof Error ? err.message : String(err))
      await save(svc, { state: null, state_expires_at: null, last_error: `Code exchange: ${reason}`, last_error_at: new Date() })
      throw new Error(`Exchanging the code for tokens failed: ${reason}`)
    }
  })
}

/** Consent refused on the OLX side: forget the attempt, keep any existing tokens. */
export function cancelConnecting(svc: OlxModuleService, reason: string): Promise<void> {
  return enqueue(() =>
    save(svc, { state: null, state_expires_at: null, last_error: reason, last_error_at: new Date() }),
  )
}

/** Forgets the tokens. The consent on the OLX side stays; the seller revokes it in the OLX account settings. */
export function disconnect(svc: OlxModuleService, reason: string | null = null): Promise<void> {
  return enqueue(() =>
    save(svc, {
      refresh_token_enc: null,
      access_token_enc: null,
      access_expires_at: null,
      disconnected_at: new Date(),
      state: null,
      state_expires_at: null,
      ...(reason ? { last_error: reason, last_error_at: new Date() } : { last_error: null, last_error_at: null }),
    }),
  )
}

async function savePair(svc: OlxModuleService, pair: TokenPair, rest: Partial<ConnectionRow> = {}): Promise<void> {
  const k = key(svc)
  await save(svc, {
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

/**
 * A valid access token, refreshed ahead of time (two hours before the end of
 * its 24 hours). The refresh token lives 30 days from the last refresh and the
 * hourly sync refreshes daily, so in normal operation it never expires.
 *
 * @param force Refresh despite validity; used after a 401 from the API.
 */
function accessToken(svc: OlxModuleService, force = false): Promise<string> {
  return enqueue(async () => {
    const row = await getConnectionRow(svc)
    if (!row?.refresh_token_enc) throw new OlxApiError(0, "The OLX account is not connected.", false)
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
      throw new OlxApiError(0, `OLX account disconnected: ${reason}`, false)
    }
    const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : 0
    if (!force && access && expiresAt - Date.now() > REFRESH_MARGIN_MS) return access
    try {
      const pair = await clientFor(svc).refresh(refresh)
      const now = await getConnectionRow(svc)
      if (!now?.refresh_token_enc) throw new OlxApiError(0, "The OLX account was disconnected during the token refresh.", false)
      await savePair(svc, pair)
      return pair.access_token
    } catch (err) {
      const reason = svc.mask(err instanceof Error ? err.message : String(err))
      const permanent = err instanceof OlxApiError && !err.transient && err.status >= 400 && err.status < 500
      if (permanent) {
        /* Refresh token revoked (30 days without a refresh, consent removed,
         * password change): it will not come back by itself, so we disconnect
         * instead of failing every hour. */
        await save(svc, {
          refresh_token_enc: null,
          access_token_enc: null,
          access_expires_at: null,
          disconnected_at: new Date(),
          last_error: `Disconnected, OLX rejected the refresh token: ${reason}. Connect the account again.`,
          last_error_at: new Date(),
        })
      } else {
        await save(svc, { last_error: `Token refresh: ${reason}`, last_error_at: new Date() })
      }
      throw err
    }
  })
}

/* ------------------------------------------------------------------ */
/* Adverts                                                             */
/* ------------------------------------------------------------------ */

interface ListResponse {
  data?: unknown[]
}

/**
 * Every advert of the account IN EVERY STATUS, 50 per page. What is live is
 * decided by the matching, not here.
 *
 * AN INCOMPLETE READ IS A FLAG, NOT AN EXCEPTION: the caller keeps what was
 * collected and removes nothing.
 */
export async function readAllAdverts(svc: OlxModuleService): Promise<AdvertsRead> {
  const patterns = compilePatterns(svc.getOptions().skuPatterns)
  const client = clientFor(svc)
  const collected = new Map<string, OlxAdvertInput>()
  const statuses: Record<string, number> = {}
  let pages = 0

  const incomplete = (err: unknown): AdvertsRead => {
    const reason = svc.mask(err instanceof Error ? err.message : String(err))
    if (err instanceof OlxCryptoError) svc.getLogger().error(`[olx] ${reason}`)
    return { adverts: [...collected.values()], statuses, complete: false, pages, reason }
  }

  let token: string
  try {
    token = await accessToken(svc)
  } catch (err) {
    return incomplete(err)
  }

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = { limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) }
    let res: ListResponse
    try {
      res = await client.get<ListResponse>("/adverts", query, token)
    } catch (err) {
      if (err instanceof OlxApiError && err.status === 401) {
        try {
          token = await accessToken(svc, true)
          res = await client.get<ListResponse>("/adverts", query, token)
        } catch (err2) {
          return incomplete(err2)
        }
      } else {
        return incomplete(err)
      }
    }
    pages += 1
    const data = Array.isArray(res.data) ? res.data : []
    const parsed = advertsFromPartnerApi(data, patterns)
    for (const [s, n] of Object.entries(parsed.statuses)) statuses[s] = (statuses[s] ?? 0) + n
    for (const a of parsed.adverts) collected.set(a.olxId, a)
    if (data.length < PAGE_SIZE) {
      return { adverts: [...collected.values()], statuses, complete: true, pages, reason: null }
    }
  }

  /* THE PAGE CEILING IS AN INCOMPLETE READ, not the end of the list. */
  return {
    adverts: [...collected.values()],
    statuses,
    complete: false,
    pages,
    reason: `stopped at the ceiling of ${MAX_PAGES} pages`,
  }
}
