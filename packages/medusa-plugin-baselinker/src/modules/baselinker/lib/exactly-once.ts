/**
 * ORDERS EXACTLY ONCE. Pure orchestration with injected calls, so the unit
 * tests drive it without a network.
 *
 * BaseLinker has no idempotency key and no external id field in `addOrder`.
 * A mapping row on our side is not enough either: the row is written AFTER
 * the order exists, so a crash, a timeout or a lost answer between the two
 * leaves a row that says "not sent" for an order that is there. Production
 * measured exactly that failure before this file existed.
 *
 * So the plugin writes a marker (`[medusa:<order id>]`) into `admin_comments`
 * and asks BaseLinker before every write:
 *
 *   1. SCAN FIRST. `getOrders` from the order date minus one hour, with
 *      unconfirmed orders, paging by `id_from`. Found: adopt that order, write
 *      nothing. If the scan itself fails, nothing is written either.
 *   2. ONE SHOT. `addOrder` is never retried blindly (the client lets only a
 *      rate limit refusal repeat, when BaseLinker took nothing).
 *   3. UNKNOWN RESULT, SCAN AGAIN. A timeout, a 502 or broken JSON after
 *      `addOrder` means "no answer", not "no order". Wait a moment, scan
 *      again; found means adopt. Still not found: the error goes up as
 *      unknown, the row is retried later, and that attempt scans first.
 *
 * MEASURED ON A LIVE ACCOUNT (production, read only): `getOrders` takes
 * `date_from` and `get_unconfirmed_orders`, returns `admin_comments` as a
 * string and 100 orders per page, and `id_from` is INCLUSIVE, so the next
 * page starts at the highest id plus one (without it the loop never ends).
 */

import { MARKER_SCAN_LOOKBACK_SECONDS, MARKER_SCAN_MAX_PAGES, ORDERS_PAGE_SIZE, UNKNOWN_RESULT_RESCAN_MS } from "./constants"
import { BaseLinkerApiError, BaseLinkerUnknownResultError } from "./errors"

export interface ScannedOrder {
  order_id?: unknown
  admin_comments?: unknown
}

export type GetOrders = (params: Record<string, unknown>) => Promise<ScannedOrder[]>

/**
 * The BaseLinker order id that carries `marker` in `admin_comments`, or null.
 * Hitting the page ceiling THROWS: a silent "not found" there would mean
 * "create it", which is the duplicate this scan exists to prevent.
 */
export async function findOrderByMarker(
  getOrders: GetOrders,
  marker: string,
  placedAtUnix: number,
  maxPages: number = MARKER_SCAN_MAX_PAGES,
): Promise<string | null> {
  const needle = marker.trim()
  if (!needle) return null
  const from = Math.max(0, Math.floor(placedAtUnix) - MARKER_SCAN_LOOKBACK_SECONDS)
  let idFrom: number | undefined
  for (let page = 1; page <= maxPages; page += 1) {
    const params: Record<string, unknown> = { date_from: from, get_unconfirmed_orders: true }
    if (idFrom !== undefined) params.id_from = idFrom
    const orders = await getOrders(params)
    if (orders.length === 0) return null
    for (const o of orders) {
      if (String(o.admin_comments ?? "").includes(needle)) {
        const id = String(o.order_id ?? "").trim()
        if (id) return id
      }
    }
    if (orders.length < ORDERS_PAGE_SIZE) return null
    const highest = Math.max(...orders.map((o) => Number(o.order_id) || 0))
    if (!Number.isFinite(highest) || highest <= 0) return null
    idFrom = highest + 1
  }
  throw new BaseLinkerApiError({
    code: "SCAN_CEILING",
    method: "getOrders",
    message:
      `${maxPages} pages of orders since this order was placed did not settle whether it already exists in BaseLinker. ` +
      "Nothing was written. Look for the marker in BaseLinker before sending it again.",
    transient: false,
  })
}

export interface CreateOnceDeps {
  /** Scans for the marker (see `findOrderByMarker`). */
  findExisting: () => Promise<string | null>
  /** One `addOrder` call; resolves with the new BaseLinker order id. */
  addOrder: () => Promise<string>
  sleep?: (ms: number) => Promise<void>
  rescanDelayMs?: number
}

export interface CreateOnceResult {
  blOrderId: string
  /** True when the order already existed and was adopted instead of created. */
  adopted: boolean
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function createOrderOnce(deps: CreateOnceDeps): Promise<CreateOnceResult> {
  const existing = await deps.findExisting()
  if (existing) return { blOrderId: existing, adopted: true }

  let unknown: BaseLinkerUnknownResultError
  try {
    const id = String((await deps.addOrder()) ?? "").trim()
    if (id && id !== "0") return { blOrderId: id, adopted: false }
    /* A success without an order id may still have created the order. */
    unknown = new BaseLinkerUnknownResultError("addOrder", new Error("success answer without order_id"))
  } catch (err) {
    if (!(err instanceof BaseLinkerUnknownResultError)) throw err
    unknown = err
  }

  await (deps.sleep ?? defaultSleep)(deps.rescanDelayMs ?? UNKNOWN_RESULT_RESCAN_MS)
  let after: string | null = null
  try {
    after = await deps.findExisting()
  } catch {
    /* The scan failed too: still unknown, and the next attempt scans first. */
  }
  if (after) return { blOrderId: after, adopted: true }
  throw unknown
}
