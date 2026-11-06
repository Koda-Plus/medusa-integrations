/**
 * KEEPING A LISTED OFFER IN STEP: the pure parts.
 *
 *   remotePatch  what the marketplace's answer about an offer changes on
 *                our row (its status, prices, stock, promotion, price
 *                program, validation errors).
 *   pushPlan     what to send for listed offers whose Medusa price or stock
 *                moved: price and stock updates (batched by the caller),
 *                and, following InPost's guidelines, no stock update down
 *                to zero: an offer with nothing left is CLOSED, and opened
 *                again when stock comes back.
 *
 * WHO CLOSED IT: an offer the sync closed for zero stock, or closed to be
 * edited, keeps the row `listed` with the last command `close`, `edit_close`
 * or `edit_patch`; an offer closed by a person here is `closed`; one closed
 * on the marketplace's side (its panel) becomes `closed` too, so the sync
 * never reopens what a person took off.
 *
 *   editStart       how an edit of an offer reaches the marketplace.
 *   afterEditStep   what follows a finished step of that edit.
 */

import { OWN_CLOSE_KINDS } from "./constants"
import type { CommandState, RemoteOffer } from "./remote"

type Row = Record<string, any>

export function remotePatch(row: Row, remote: RemoteOffer, now: Date = new Date()): Record<string, unknown> {
  const validation = [
    ...remote.validationErrors.map((v) => ({ code: v.code, message: v.message })),
    ...remote.rejectionReasons.map((m) => ({ code: "REJECTED", message: m })),
  ]
  const closedElsewhere = remote.status === "CLOSED" && row.status === "listed" && !OWN_CLOSE_KINDS.includes(String(row.command_kind ?? ""))
  return {
    remote_id: remote.id,
    remote_status: remote.status,
    remote_price_minor: remote.grossPriceMinor,
    remote_final_price_minor: remote.finalPriceMinor,
    remote_stock: remote.stock,
    promotion: remote.promotion ? { start: remote.promotion.start, end: remote.promotion.end, status: remote.promotion.status, mode: remote.promotion.mode, value: remote.promotion.value } : null,
    program: remote.program,
    validation,
    image_count: remote.imageCount,
    synced_at: now,
    ...(remote.status === "PUBLISHED" && !row.published_at ? { published_at: now } : {}),
    ...(closedElsewhere ? { status: "closed" } : {}),
  }
}

/** What a finished command changes on the row. */
export function commandPatch(row: Row, c: CommandState, now: Date = new Date()): Record<string, unknown> {
  const base = { command_status: c.status, command_at: now }
  if (c.status !== "FAILURE") return base
  const error = c.errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join("; ").slice(0, 500) || "The marketplace refused the change."
  switch (row.command_kind) {
    /* The offer never came to be: back to draft, the person fixes and lists again. */
    case "create":
      return { ...base, status: "draft", remote_id: null, remote_status: null, pushed_price_minor: null, pushed_stock: null, error }
    /* Sent again on the next sync. */
    case "price":
      return { ...base, pushed_price_minor: null, error }
    case "stock":
      return { ...base, pushed_stock: null, error }
    default:
      return { ...base, error }
  }
}

export interface PushPlan {
  prices: Array<{ rowId: string; offerId: string; grossPriceMinor: number }>
  stocks: Array<{ rowId: string; offerId: string; quantity: number }>
  close: Array<{ rowId: string; offerId: string }>
  reopen: Array<{ rowId: string; offerId: string }>
}

export function pushPlan(rows: readonly Row[]): PushPlan {
  const plan: PushPlan = { prices: [], stocks: [], close: [], reopen: [] }
  for (const r of rows) {
    if (r.status !== "listed" || !r.remote_id || r.command_status === "PENDING") continue
    const offerId = String(r.remote_id)
    const stock = Math.max(0, Math.round(Number(r.stock) || 0))
    const price = Math.round(Number(r.price_minor) || 0)
    const remote = String(r.remote_status ?? "")
    if (remote === "CLOSED") {
      /* Closed by the sync itself (no stock, or an edit that stopped half way): back when stock is there. */
      if (OWN_CLOSE_KINDS.includes(String(r.command_kind ?? "")) && stock > 0) plan.reopen.push({ rowId: r.id, offerId })
      continue
    }
    if (remote !== "PUBLISHED" && remote !== "SOLDOUT" && remote !== "PENDING") continue
    if (stock === 0) {
      if (remote === "PUBLISHED") plan.close.push({ rowId: r.id, offerId })
      continue
    }
    /* One command per offer per run (the row follows one): a price first, the stock on the next run. */
    if (price > 0 && price !== r.pushed_price_minor) plan.prices.push({ rowId: r.id, offerId, grossPriceMinor: price })
    else if (stock !== r.pushed_stock) plan.stocks.push({ rowId: r.id, offerId, quantity: stock })
  }
  return plan
}

/**
 * How an edit (name, description, photos, package, days to ship, category
 * parameters) reaches the marketplace:
 *
 *   local       nothing to send: the offer is not on the marketplace (draft,
 *               blocked, detached, or a create that never came back)
 *   busy        the marketplace has not finished the last change: wait
 *   close       a live offer (PUBLISHED, SOLDOUT): InPost's FAQ says a change
 *               other than price and stock may be refused on a published
 *               offer and recommends close, patch, reopen. The close goes
 *               first (`edit_close`), the sync sends the patch when it is
 *               done and reopens the offer after it
 *   edit_patch  an offer the plugin closed itself (zero stock, or an edit that
 *               stopped half way): patched, then reopened when there is stock
 *   patch       an offer in review, rejected, or closed by a person: patched,
 *               nothing else (a closed one stays closed)
 */
export type EditStart = "local" | "busy" | "close" | "edit_patch" | "patch"

export function editStart(row: Row): EditStart {
  if (!row.remote_id || (row.status !== "listed" && row.status !== "closed")) return "local"
  if (row.command_status === "PENDING") return "busy"
  const remote = String(row.remote_status ?? "")
  if (row.status === "closed") return "patch"
  if (remote === "PUBLISHED" || remote === "SOLDOUT") return "close"
  if (remote === "CLOSED") return OWN_CLOSE_KINDS.includes(String(row.command_kind ?? "")) ? "edit_patch" : "patch"
  return "patch"
}

/**
 * What follows a finished step of an edit:
 *   send_patch  the close for the edit is done: send the patch now
 *   reopen      the patch of an offer we closed is done (or refused: the
 *               offer must not stay closed for a refused change), stock is
 *               there: reopen it
 *   park        the same at zero stock: the row keeps a `close` and the
 *               price and stock sync reopens the offer when stock comes back
 *   none        nothing (a refused close keeps the offer live and says why)
 */
export type EditNext = "send_patch" | "reopen" | "park" | "none"

export function afterEditStep(row: Row, c: Pick<CommandState, "status">): EditNext {
  if (c.status === "PENDING") return "none"
  if (row.command_kind === "edit_close") return c.status === "SUCCESS" ? "send_patch" : "none"
  if (row.command_kind === "edit_patch") return Math.max(0, Math.round(Number(row.stock) || 0)) > 0 ? "reopen" : "park"
  return "none"
}

/** Medusa's tracking numbers against the marketplace's parcels. */
export function trackingStatus(numbers: readonly string[], parcels: ReadonlyArray<{ trackingNumber: string }>): "none" | "waiting" | "linked" {
  if (numbers.length === 0) return parcels.length > 0 ? "linked" : "none"
  const shown = new Set(parcels.map((p) => p.trackingNumber.replace(/\s+/g, "")))
  return numbers.every((n) => shown.has(n.replace(/\s+/g, ""))) ? "linked" : "waiting"
}
