/**
 * AFTER SALE: returns, refunds and claims of marketplace orders.
 *
 *   syncCases      reads the newest returns, claims (they raise no events)
 *                  and refunds, writes one `vonhalsky_case` row per case and
 *                  keeps the counters on the order rows.
 *   acceptReturn   accepts a return with the amount to refund (InPost makes
 *                  the refund); rejectReturn rejects it with a reason.
 *   resolveClaim   rejects a claim, or refunds part or all of it.
 *   refundOrder    a refund without a return or a claim (the whole order, or
 *                  an amount).
 *   retryRefund    pays a refund again whose payment was declined.
 *   caseDetail     one case read live, with the buyer's contact data for the
 *                  person deciding (shown, never stored).
 *   simulateCase   demo only: a return or a claim on a simulated order.
 */

import type { MedusaContainer } from "@medusajs/framework/types"
import { PAGE_MAX } from "../../modules/vonhalsky/lib/client"
import type { CaseKind } from "../../modules/vonhalsky/lib/constants"
import type { CaseDetailResponse, CaseDto, CasesResponse } from "../../modules/vonhalsky/lib/contract"
import { toMinor } from "../../modules/vonhalsky/lib/pricing"
import type { AfterSaleLine, RemoteClaim, RemoteRefund, RemoteReturn } from "../../modules/vonhalsky/lib/remote"
import { caseFilter, logSync, toCaseDto, vonHalskySvc, withEvent, type Scope } from "../../modules/vonhalsky/lib/store"
import { VonHalskyFlowError, demoClientOf, errorText, optionsOf, requireClient, withLock } from "./runtime"

type Row = Record<string, any>

const date = (v: string | null) => (v ? new Date(v) : null)
const lines = (l: AfterSaleLine[]) => l.map((x) => ({ offerId: x.offerId, name: x.name, ean: x.ean, quantity: x.quantity, priceMinor: x.priceMinor, reason: x.reason }))

export function returnRow(r: RemoteReturn): Record<string, unknown> {
  return {
    kind: "return",
    remote_id: r.id,
    display_id: r.displayId,
    marketplace_order_id: r.orderId,
    status: r.status,
    sub_status: r.refundPaymentStatus,
    source: r.method,
    reason: r.reason ?? r.lines.find((l) => l.reason)?.reason ?? null,
    amount_minor: r.refundMinor,
    lines: lines(r.lines),
    refund_id: r.refundId,
    opened_at: date(r.createdAt),
    expires_at: date(r.expiresAt),
    decided_at: r.status !== "NEW" ? new Date() : null,
  }
}

export function claimRow(c: RemoteClaim): Record<string, unknown> {
  return {
    kind: "claim",
    remote_id: c.id,
    display_id: null,
    marketplace_order_id: c.orderId,
    status: c.state,
    sub_status: c.resolution,
    source: c.requested,
    reason: c.type,
    amount_minor: c.lines.reduce((s, l) => s + (l.priceMinor ?? 0) * l.quantity, 0) || null,
    lines: lines(c.lines),
    opened_at: date(c.createdAt),
    expires_at: date(c.expiresAt),
    remote_updated_at: date(c.updatedAt),
    decided_at: c.resolution ? date(c.updatedAt) ?? new Date() : null,
  }
}

export function refundRow(r: RemoteRefund): Record<string, unknown> {
  return {
    kind: "refund",
    remote_id: r.id,
    display_id: r.displayId,
    marketplace_order_id: r.orderId,
    status: r.status,
    sub_status: r.paymentStatus,
    source: r.source,
    reason: r.declinedReason ?? r.reason,
    amount_minor: r.amountMinor,
    opened_at: date(r.submittedAt),
    remote_updated_at: date(r.updatedAt),
  }
}

async function upsertCases(scope: Scope, kind: CaseKind, incoming: Array<Record<string, unknown>>, demo: boolean): Promise<{ created: number; changed: number }> {
  if (incoming.length === 0) return { created: 0, changed: 0 }
  const svc = vonHalskySvc(scope)
  const ids = incoming.map((c) => String(c.remote_id))
  const existing = new Map((((await svc.listVonHalskyCases({ kind, remote_id: ids }, { take: ids.length })) ?? []) as Row[]).map((r) => [String(r.remote_id), r]))
  let created = 0
  let changed = 0
  for (const c of incoming) {
    const row = existing.get(String(c.remote_id))
    if (!row) {
      await svc.createVonHalskyCases({ ...c, demo, events: withEvent([], { kind: "opened", message: `${kind} ${c.display_id ?? c.remote_id} on the marketplace`, ...(demo ? { demo: true } : {}) }) })
      created += 1
      continue
    }
    const moved = row.status !== c.status || row.sub_status !== c.sub_status
    if (!moved && row.amount_minor === c.amount_minor) continue
    const { decided_at: decided, ...rest } = c
    await svc.updateVonHalskyCases({
      id: row.id,
      ...rest,
      decided_at: row.decided_at ?? decided ?? null,
      ...(moved ? { events: withEvent(row.events, { kind: "status", message: `${row.status ?? "?"}${row.sub_status ? `/${row.sub_status}` : ""} to ${c.status ?? "?"}${c.sub_status ? `/${c.sub_status}` : ""}` }) } : {}),
    })
    changed += 1
  }
  return { created, changed }
}

/** The order rows' counters and refunded amount, from the cases. */
async function recount(scope: Scope, orderIds: readonly string[]): Promise<void> {
  const svc = vonHalskySvc(scope)
  const unique = [...new Set(orderIds.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const [orders, cases] = await Promise.all([
      svc.listVonHalskyOrders({ marketplace_order_id: chunk }, { take: chunk.length }) as Promise<Row[]>,
      svc.listVonHalskyCases({ marketplace_order_id: chunk }, { take: 2000 }) as Promise<Row[]>,
    ])
    const updates = (orders ?? []).map((o) => {
      const mine = (cases ?? []).filter((c) => c.marketplace_order_id === o.marketplace_order_id)
      const refunded = mine.filter((c) => c.kind === "refund" && (c.sub_status === "REFUNDED" || c.sub_status === "PARTIALLY_REFUNDED")).reduce((s, c) => s + (Number(c.amount_minor) || 0), 0)
      return { id: o.id, returns_count: mine.filter((c) => c.kind === "return").length, claims_count: mine.filter((c) => c.kind === "claim").length, refunded_minor: refunded }
    })
    if (updates.length) await svc.updateVonHalskyOrders(updates)
  }
}

export async function syncCases(scope: Scope): Promise<{ returns: number; claims: number; refunds: number; created: number }> {
  const o = optionsOf(scope)
  const client = requireClient(scope)
  return withLock("cases", async () => {
    const pages = 3
    const returns: RemoteReturn[] = []
    const claims: RemoteClaim[] = []
    const refunds: RemoteRefund[] = []
    /* The returns list has no sort: every NEW one first (they wait for a decision), then the first pages. */
    const seen = new Set<string>()
    const take = (list: RemoteReturn[]) => {
      for (const x of list) {
        if (seen.has(x.id)) continue
        seen.add(x.id)
        returns.push(x)
      }
    }
    for (let p = 0; p < 10; p += 1) {
      const r = await client.listReturns({ offset: p * PAGE_MAX, limit: PAGE_MAX, status: ["NEW"] })
      take(r.returns)
      if (r.returns.length < PAGE_MAX) break
    }
    for (let p = 0; p < pages; p += 1) {
      const r = await client.listReturns({ offset: p * PAGE_MAX, limit: PAGE_MAX })
      take(r.returns)
      if (r.returns.length < PAGE_MAX) break
    }
    for (let p = 0; p < pages; p += 1) {
      const r = await client.listClaims({ offset: p * PAGE_MAX, limit: PAGE_MAX })
      claims.push(...r.claims)
      if (r.claims.length < PAGE_MAX) break
    }
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    for (let p = 0; p < pages; p += 1) {
      const r = await client.listRefunds({ offset: p * PAGE_MAX, limit: PAGE_MAX, since })
      refunds.push(...r.refunds)
      if (r.refunds.length < PAGE_MAX) break
    }
    const a = await upsertCases(scope, "return", returns.map(returnRow), o.demo)
    const b = await upsertCases(scope, "claim", claims.map(claimRow), o.demo)
    const c = await upsertCases(scope, "refund", refunds.map(refundRow), o.demo)
    await recount(scope, [...returns.map((x) => x.orderId), ...claims.map((x) => x.orderId), ...refunds.map((x) => x.orderId)].filter((x): x is string => Boolean(x)))
    const created = a.created + b.created + c.created
    if (created || a.changed || b.changed || c.changed) {
      await logSync(scope, { area: "cases", action: "sync", message: `After sale: ${created} new cases, ${a.changed + b.changed + c.changed} changed.`, count: created, demo: o.demo })
    }
    return { returns: returns.length, claims: claims.length, refunds: refunds.length, created }
  })
}

async function caseRow(scope: Scope, id: string): Promise<Row> {
  const [row] = ((await vonHalskySvc(scope).listVonHalskyCases({ id }, { take: 1 })) ?? []) as Row[]
  if (!row) throw new VonHalskyFlowError(404, "not_found", "After sale case not found.")
  return row
}

async function caseDto(scope: Scope, row: Row): Promise<CaseDto> {
  const [order] = row.marketplace_order_id ? (((await vonHalskySvc(scope).listVonHalskyOrders({ marketplace_order_id: row.marketplace_order_id }, { take: 1 })) ?? []) as Row[]) : []
  return toCaseDto(row, order ? { order_id: order.order_id ?? null, display_id: typeof order.display_id === "number" ? order.display_id : null } : null)
}

/** The cases of a panel filter, newest first, with the Medusa order each belongs to. `q` finds a case number, a marketplace order id or a case id. */
export async function listCases(scope: Scope, q: { filter: string; search: string; offset: number; limit: number }): Promise<CasesResponse> {
  const svc = vonHalskySvc(scope)
  const base = caseFilter(q.filter)
  let filters: Record<string, unknown> = base
  if (q.search) {
    const or = [{ display_id: { $ilike: `%${q.search}%` } }, { marketplace_order_id: { $ilike: `%${q.search}%` } }, { remote_id: q.search }]
    filters = Object.keys(base).length > 0 ? { $and: [base, { $or: or }] } : { $or: or }
  }
  const [rows, count] = (await svc.listAndCountVonHalskyCases(filters, { skip: q.offset, take: q.limit, order: { opened_at: "DESC" } })) as [Row[], number]
  const orderIds = [...new Set(rows.map((r) => r.marketplace_order_id).filter(Boolean).map(String))]
  const orders = orderIds.length ? (((await svc.listVonHalskyOrders({ marketplace_order_id: orderIds }, { take: orderIds.length })) ?? []) as Row[]) : []
  const byId = new Map(orders.map((o) => [String(o.marketplace_order_id), o]))
  return {
    cases: rows.map((r) => {
      const o = byId.get(String(r.marketplace_order_id ?? ""))
      return toCaseDto(r, o ? { order_id: o.order_id ?? null, display_id: typeof o.display_id === "number" ? o.display_id : null } : null)
    }),
    count: Number(count) || 0,
    offset: q.offset,
    limit: q.limit,
  }
}

async function afterDecision(scope: Scope, row: Row, message: string): Promise<CaseDto> {
  await syncCases(scope).catch(() => undefined)
  const fresh = await caseRow(scope, row.id)
  const svc = vonHalskySvc(scope)
  const updated = await svc.updateVonHalskyCases({ id: fresh.id, decided_at: fresh.decided_at ?? new Date(), events: withEvent(fresh.events, { kind: "decision", message }) })
  await logSync(scope, { area: "cases", action: "decide", message: `${row.kind} ${row.display_id ?? row.remote_id}: ${message}`, demo: optionsOf(scope).demo, refs: { case_id: row.id } })
  return caseDto(scope, updated)
}

export async function acceptReturn(scope: Scope, id: string, amount: unknown): Promise<CaseDto> {
  const row = await caseRow(scope, id)
  if (row.kind !== "return" || row.status !== "NEW") throw new VonHalskyFlowError(409, "not_open", "Only a new return can be accepted.")
  const minor = toMinor(amount)
  if (minor === null || minor <= 0) throw new VonHalskyFlowError(400, "invalid_amount", "Give the amount to refund, like 49.99.")
  try {
    const { refundId } = await requireClient(scope).acceptReturn(String(row.remote_id), minor)
    return afterDecision(scope, row, `Accepted, ${(minor / 100).toFixed(2)} PLN to refund${refundId ? ` (refund ${refundId})` : ""}`)
  } catch (err) {
    throw new VonHalskyFlowError(502, "decision_failed", errorText(err, scope))
  }
}

export async function rejectReturn(scope: Scope, id: string, reasonId: unknown): Promise<CaseDto> {
  const row = await caseRow(scope, id)
  if (row.kind !== "return" || row.status !== "NEW") throw new VonHalskyFlowError(409, "not_open", "Only a new return can be rejected.")
  if (typeof reasonId !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(reasonId)) throw new VonHalskyFlowError(400, "no_reason", "Pick the reason of the rejection.")
  try {
    await requireClient(scope).rejectReturn(String(row.remote_id), reasonId)
    return afterDecision(scope, row, "Rejected")
  } catch (err) {
    throw new VonHalskyFlowError(502, "decision_failed", errorText(err, scope))
  }
}

export async function resolveClaim(scope: Scope, id: string, how: unknown, description: unknown): Promise<CaseDto> {
  const row = await caseRow(scope, id)
  if (row.kind !== "claim" || row.sub_status || row.status === "APPROVED" || row.status === "REJECTED") throw new VonHalskyFlowError(409, "not_open", "Only an open claim can be resolved.")
  if (how !== "reject" && how !== "partial" && how !== "full") throw new VonHalskyFlowError(400, "invalid_resolution", "Resolve with reject, partial or full.")
  if (!row.marketplace_order_id) throw new VonHalskyFlowError(409, "no_order", "The claim names no order.")
  const text = typeof description === "string" ? description.trim().slice(0, 1000) : null
  try {
    await requireClient(scope).resolveClaim(String(row.marketplace_order_id), String(row.remote_id), how, text || null)
    return afterDecision(scope, row, how === "reject" ? "Rejected" : how === "partial" ? "Partial refund" : "Full refund")
  } catch (err) {
    throw new VonHalskyFlowError(502, "decision_failed", errorText(err, scope))
  }
}

/** A refund of a marketplace order (its row id), the whole order when no amount is given. */
export async function refundOrder(scope: Scope, orderRowId: string, amount: unknown): Promise<{ refundId: string | null; status: string | null }> {
  const [order] = ((await vonHalskySvc(scope).listVonHalskyOrders({ id: orderRowId }, { take: 1 })) ?? []) as Row[]
  if (!order) throw new VonHalskyFlowError(404, "not_found", "Marketplace order not found.")
  const minor = amount === null || amount === undefined || amount === "" ? null : toMinor(amount)
  if (minor !== null && (minor <= 0 || (typeof order.total_minor === "number" && minor > order.total_minor))) throw new VonHalskyFlowError(400, "invalid_amount", "The amount is above 0 and at most the order total.")
  try {
    const r = await requireClient(scope).refundOrder(String(order.marketplace_order_id), minor)
    await vonHalskySvc(scope).updateVonHalskyOrders({ id: order.id, events: withEvent(order.events, { kind: "refund", message: `Refund ${minor === null ? "of the whole order" : `${(minor / 100).toFixed(2)} PLN`} asked (${r.status ?? "sent"})` }) })
    await logSync(scope, { area: "cases", action: "refund", message: `Order ${order.marketplace_order_id}: refund ${minor === null ? "of the whole order" : `${(minor / 100).toFixed(2)} PLN`} asked.`, demo: optionsOf(scope).demo })
    await syncCases(scope).catch(() => undefined)
    return r
  } catch (err) {
    throw new VonHalskyFlowError(502, "refund_failed", errorText(err, scope))
  }
}

export async function retryRefund(scope: Scope, id: string): Promise<CaseDto> {
  const row = await caseRow(scope, id)
  if (row.kind !== "refund" || row.sub_status !== "DECLINED") throw new VonHalskyFlowError(409, "not_declined", "Only a refund whose payment was declined is paid again.")
  try {
    await requireClient(scope).retryRefund(String(row.remote_id))
    return afterDecision(scope, row, "Payment sent again")
  } catch (err) {
    throw new VonHalskyFlowError(502, "retry_failed", errorText(err, scope))
  }
}

/** One case, read live; the contact data come from the marketplace order and are not stored. */
export async function caseDetail(scope: Scope, id: string): Promise<CaseDetailResponse> {
  const row = await caseRow(scope, id)
  const client = requireClient(scope)
  let contact: CaseDetailResponse["contact"] = null
  let rejectReasons: CaseDetailResponse["rejectReasons"] = []
  try {
    const order = row.marketplace_order_id ? await client.getOrder(String(row.marketplace_order_id)) : null
    if (order) contact = { name: [order.buyer.firstName, order.buyer.lastName].filter(Boolean).join(" ") || null, email: order.invoice?.email ?? order.buyer.email, phone: order.buyer.phone ?? order.delivery.phone }
    if (row.kind === "return") rejectReasons = (await client.dictionaries()).returnRejectReasons
  } catch {
    /* the case itself is still shown */
  }
  return { case: await caseDto(scope, row), contact, rejectReasons }
}

/** DEMO MODE ONLY: a return or a claim on an imported simulated order. */
export async function simulateCase(container: MedusaContainer, kind: unknown, orderRowId: unknown): Promise<CaseDto> {
  const o = optionsOf(container)
  const demo = demoClientOf(container)
  if (!o.demo || !demo) throw new VonHalskyFlowError(404, "not_demo", "Simulated cases exist only in demo mode.")
  if (kind !== "return" && kind !== "claim") throw new VonHalskyFlowError(400, "invalid_kind", "Simulate a return or a claim.")
  const svc = vonHalskySvc(container)
  const filters = typeof orderRowId === "string" && orderRowId ? { id: orderRowId } : { demo: true, status: "imported" }
  const orders = ((await svc.listVonHalskyOrders(filters, { take: 20, order: { created_at: "DESC" } })) ?? []) as Row[]
  const [, count] = (await svc.listAndCountVonHalskyCases({ kind }, { take: 1 })) as [Row[], number]
  for (const order of orders) {
    const made = demo.simulateCase(kind, String(order.marketplace_order_id), Number(count) || 0)
    if (!made) continue
    await syncCases(container)
    const [row] = ((await svc.listVonHalskyCases({ kind, remote_id: made.id }, { take: 1 })) ?? []) as Row[]
    if (row) return caseDto(container, row)
  }
  throw new VonHalskyFlowError(409, "no_demo_order", "Simulate and import an order first (after a server restart the simulated marketplace forgets older orders).")
}
