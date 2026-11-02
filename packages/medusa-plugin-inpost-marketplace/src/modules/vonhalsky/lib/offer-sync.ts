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
 * WHO CLOSED IT: an offer the sync closed for zero stock keeps the row
 * `listed` with the last command `close`; an offer closed by a person here
 * is `closed`; one closed on the marketplace's side (its panel) becomes
 * `closed` too, so the sync never reopens what a person took off.
 */

import type { CommandState, RemoteOffer } from "./remote"

type Row = Record<string, any>

export function remotePatch(row: Row, remote: RemoteOffer, now: Date = new Date()): Record<string, unknown> {
  const validation = [
    ...remote.validationErrors.map((v) => ({ code: v.code, message: v.message })),
    ...remote.rejectionReasons.map((m) => ({ code: "REJECTED", message: m })),
  ]
  const closedElsewhere = remote.status === "CLOSED" && row.status === "listed" && row.command_kind !== "close"
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
      if (r.command_kind === "close" && stock > 0) plan.reopen.push({ rowId: r.id, offerId })
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

/** Medusa's tracking numbers against the marketplace's parcels. */
export function trackingStatus(numbers: readonly string[], parcels: ReadonlyArray<{ trackingNumber: string }>): "none" | "waiting" | "linked" {
  if (numbers.length === 0) return parcels.length > 0 ? "linked" : "none"
  const shown = new Set(parcels.map((p) => p.trackingNumber.replace(/\s+/g, "")))
  return numbers.every((n) => shown.has(n.replace(/\s+/g, ""))) ? "linked" : "waiting"
}
