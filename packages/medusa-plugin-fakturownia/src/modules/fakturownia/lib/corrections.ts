/**
 * CORRECTIONS (FAKTURY KORYGUJĄCE): WHAT CHANGED, AND WHAT TO SEND. Pure: the
 * stored document, the order as Medusa holds it now and the corrections
 * already decided in, a plan out; a plan and the original invoice in, the
 * `invoice` of `POST /invoices.json` out.
 *
 * THE PLAN IS A DIFFERENCE OF STATES, not a replay of events:
 *
 *   documented  the positions of the issued document, plus every correction
 *               already decided (issued, approved, or handled outside the
 *               plugin by a person);
 *   target      the order now: line quantities after an order edit, minus
 *               the goods that came back (received and damaged returns), the
 *               shipping methods, a refund that exceeds the returned goods
 *               spread over the remaining positions as a price reduction,
 *               and nothing at all for a canceled order (a correction to
 *               zero, the only way to "cancel" an invoice in KSeF).
 *
 * Positions are matched by identity: the SKU (or the name without one) and
 * the tax rate, lines with the same identity added up. So an exchange of two
 * units for two units of the same SKU nets out, and a price changed by an
 * order edit is one position with a new value.
 *
 * A difference of states repairs itself: a missed event is found by the next
 * one, the refund that pays back a return is part of that return's
 * correction (not a second one), and a correction approved earlier is never
 * planned twice. The plan is only a proposal: a person approves it, and only
 * then the correction is issued, exactly once.
 *
 * NOT PLANNED, ON PURPOSE (the plan says why and a person decides):
 *   receipt             a receipt is not corrected with a correction invoice:
 *                       a return of goods sold with a receipt goes into the
 *                       register of returns (ewidencja zwrotów, § 3 ust. 3 of
 *                       the cash register regulation, Dz.U. 2025 poz. 845,
 *                       in force since July 2025), with the receipt and a
 *                       return protocol signed by the seller and the buyer
 *                       (or an internal note). The plan still shows the
 *                       amounts, for that register.
 *   claim_or_exchange   claims and exchanges mix returned and new goods, and
 *                       whether they change the invoice depends on the deal;
 *   unknown_positions   the plugin does not know what the document holds (a
 *                       document marked as issued by a person).
 */

import { round, sameAmount, toNumber, toNumberOrNull } from "./numbers"
import { lineName, taxValue, type ItemRecord, type ShippingRecord } from "./positions"
import { PayloadError } from "./errors"
import type { TaxValue } from "./options"

/* ------------------------------------------------------------------ */
/* Identity and amounts                                                */
/* ------------------------------------------------------------------ */

/** "23", 23, "23%", "23.0" are the same rate; "zw", "np" and "oo" stay codes. */
export function normTax(tax: unknown): string {
  const s = String(tax ?? "").trim().toLowerCase().replace("%", "").replace(",", ".").trim()
  if (s === "" || s === "zw" || s === "np" || s === "oo") return s
  const n = Number(s)
  return Number.isFinite(n) ? String(round(n, 2)) : s
}

/** The identity of a position: the SKU (or the name without one) and the rate. */
export function positionKey(p: { name: string; code?: string | null; tax: unknown }): string {
  const code = String(p.code ?? "").trim().toLowerCase()
  const name = String(p.name ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  return `${code ? `c:${code}` : `n:${name}`}|${normTax(p.tax)}`
}

/** The rate in percent; 0 for "zw", "np" and "oo". */
export function taxRate(tax: string): number {
  const n = Number(normTax(tax))
  return Number.isFinite(n) ? n : 0
}

/** Net and VAT inside a gross amount, rounded to the cent (the VAT is the rest, so they add up). */
export function splitGross(gross: number, tax: string): { net: number; vat: number } {
  const rate = taxRate(tax)
  const net = round(gross / (1 + rate / 100), 2)
  return { net, vat: round(gross - net, 2) }
}

export interface Line {
  name: string
  code: string | null
  tax: string
  unit: string
  quantity: number
  gross: number
}

export interface Amounts {
  quantity: number
  gross: number
}

export interface PlannedPosition {
  key: string
  name: string
  code: string | null
  tax: string
  unit: string
  before: Amounts
  after: Amounts
  delta: { quantity: number; gross: number; net: number; vat: number }
}

export interface Totals {
  net: number
  vat: number
  gross: number
}

type Agg = Line & { key: string }

/** Lines with the same identity added up, in the order they first appear. */
export function aggregate(lines: readonly Line[]): Map<string, Agg> {
  const out = new Map<string, Agg>()
  for (const l of lines) {
    const key = positionKey(l)
    const prev = out.get(key)
    if (prev) {
      prev.quantity = round(prev.quantity + l.quantity, 4)
      prev.gross = round(prev.gross + l.gross, 2)
    } else {
      out.set(key, { ...l, tax: normTax(l.tax), key, quantity: round(l.quantity, 4), gross: round(l.gross, 2) })
    }
  }
  return out
}

/** A stored position (the outbox row) as a line. */
export function storedLine(p: { name?: unknown; code?: unknown; quantity?: unknown; unit?: unknown; gross?: unknown; tax?: unknown }): Line {
  return {
    name: String(p.name ?? ""),
    code: p.code === null || p.code === undefined || String(p.code).trim() === "" ? null : String(p.code),
    tax: normTax(p.tax),
    unit: String(p.unit ?? ""),
    quantity: toNumber(p.quantity),
    gross: round(toNumber(p.gross), 2),
  }
}

/** What the document says now: its positions with every decided correction applied. */
export function documentedState(original: readonly Line[], applied: ReadonlyArray<readonly PlannedPosition[]>): Map<string, Agg> {
  const state = aggregate(original)
  for (const plan of applied) {
    for (const p of plan) {
      const prev = state.get(p.key)
      if (prev) {
        prev.quantity = round(prev.quantity + p.delta.quantity, 4)
        prev.gross = round(prev.gross + p.delta.gross, 2)
      } else {
        state.set(p.key, { key: p.key, name: p.name, code: p.code, tax: p.tax, unit: p.unit, quantity: p.delta.quantity, gross: p.delta.gross })
      }
    }
  }
  return state
}

/** The positions whose quantity or value differ, before and after. */
export function diffStates(before: Map<string, Agg>, after: Map<string, Agg>, tolerance = 0.005): PlannedPosition[] {
  const keys = [...before.keys(), ...[...after.keys()].filter((k) => !before.has(k))]
  const out: PlannedPosition[] = []
  for (const key of keys) {
    const b = before.get(key)
    const a = after.get(key)
    const was: Amounts = { quantity: b?.quantity ?? 0, gross: b?.gross ?? 0 }
    const now: Amounts = { quantity: a?.quantity ?? 0, gross: a?.gross ?? 0 }
    const dq = round(now.quantity - was.quantity, 4)
    const dg = round(now.gross - was.gross, 2)
    if (Math.abs(dq) < 1e-9 && Math.abs(dg) <= tolerance) continue
    const base = (b ?? a) as Agg
    out.push({
      key,
      name: base.name,
      code: base.code,
      tax: base.tax,
      unit: base.unit,
      before: was,
      after: now,
      delta: { quantity: dq, gross: dg, ...splitGross(dg, base.tax) },
    })
  }
  return out
}

export function totalsOf(positions: readonly PlannedPosition[]): Totals {
  return {
    net: round(positions.reduce((s, p) => s + p.delta.net, 0), 2),
    vat: round(positions.reduce((s, p) => s + p.delta.vat, 0), 2),
    gross: round(positions.reduce((s, p) => s + p.delta.gross, 0), 2),
  }
}

/* ------------------------------------------------------------------ */
/* The order now                                                       */
/* ------------------------------------------------------------------ */

export interface RefundRecord {
  id?: string | null
  amount?: unknown
  created_at?: string | Date | null
}

export interface CorrectionItem extends ItemRecord {
  detail?: {
    quantity?: unknown
    return_received_quantity?: unknown
    return_dismissed_quantity?: unknown
  } | null
}

export interface CorrectionOrder {
  id: string
  display_id?: number | null
  status?: string | null
  version?: number | null
  currency_code?: string | null
  shipping_total?: unknown
  items?: CorrectionItem[] | null
  shipping_methods?: ShippingRecord[] | null
  payment_collections?: Array<{ status?: string | null; payments?: Array<{ canceled_at?: unknown; refunds?: RefundRecord[] | null } | null> | null } | null> | null
}

export interface LineOptions {
  defaultVatRate: TaxValue
  shippingPositionName: string
  quantityUnit: string
}

export interface OrderTarget {
  canceled: boolean
  lines: Line[]
  /** Gross value of the goods that came back (received and damaged returns). */
  returnedValue: number
  returnedUnits: number
  /** Everything refunded on the order's payments. */
  refunded: number
  /** Refunded beyond the returned goods: a price reduction spread over the positions. */
  reduction: number
}

/** Every refund of the order's payments, newest last. */
export function refundsOf(order: Pick<CorrectionOrder, "payment_collections">): Array<{ id: string; amount: number; at: string | null }> {
  const out: Array<{ id: string; amount: number; at: string | null }> = []
  for (const c of order.payment_collections ?? []) {
    for (const p of c?.payments ?? []) {
      for (const r of p?.refunds ?? []) {
        const amount = round(toNumber(r?.amount), 2)
        if (!r || amount <= 0) continue
        const at = r.created_at ? new Date(r.created_at as string).toISOString() : null
        out.push({ id: String(r.id ?? ""), amount, at })
      }
    }
  }
  return out.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")))
}

/** Spreads a reduction over the lines in proportion to their value; the rounding rest lands on the largest line. */
export function spreadReduction(lines: Line[], amount: number): Line[] {
  const total = round(lines.reduce((s, l) => s + l.gross, 0), 2)
  if (amount <= 0 || total <= 0) return lines
  if (amount >= total - 0.005) return lines.map((l) => ({ ...l, gross: 0 }))
  let left = round(amount, 2)
  const out = lines.map((l) => {
    const share = round((l.gross / total) * amount, 2)
    left = round(left - share, 2)
    return { ...l, gross: round(l.gross - share, 2) }
  })
  if (Math.abs(left) > 0 && out.length > 0) {
    const largest = out.reduce((best, l, i) => (l.gross > out[best].gross ? i : best), 0)
    out[largest] = { ...out[largest], gross: round(out[largest].gross - left, 2) }
  }
  return out
}

export function orderTarget(order: CorrectionOrder, o: LineOptions, tolerance = 0.02): OrderTarget {
  const canceled = order.status === "canceled"
  const lines: Line[] = []
  let returnedValue = 0
  let returnedUnits = 0
  for (const item of order.items ?? []) {
    const quantity = toNumberOrNull(item.detail?.quantity ?? item.quantity)
    if (quantity === null) throw new PayloadError("no_quantity", `Line ${item.id} has no readable quantity (items.detail.quantity).`)
    if (quantity <= 0) continue
    const tax = normTax(taxValue(item.tax_lines, o.defaultVatRate))
    const total = toNumberOrNull(item.total)
    const gross =
      total !== null
        ? round(total, 2)
        : round((toNumber(item.unit_price) * quantity - toNumber(item.discount_total)) * (item.is_tax_inclusive ? 1 : 1 + taxRate(tax) / 100), 2)
    const back = Math.min(quantity, Math.max(0, toNumber(item.detail?.return_received_quantity) + toNumber(item.detail?.return_dismissed_quantity)))
    const left = round(quantity - back, 4)
    const leftGross = round((gross * left) / quantity, 2)
    if (back > 0) {
      returnedUnits = round(returnedUnits + back, 4)
      returnedValue = round(returnedValue + gross - leftGross, 2)
    }
    if (left <= 0) continue
    /* The same code as the document builder (`positions.ts`): the SKU, at most 50 characters. */
    const sku = [item.variant_sku, item.variant?.sku].map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean) ?? ""
    lines.push({ name: lineName(item), code: sku ? sku.slice(0, 50) : null, tax, unit: o.quantityUnit, quantity: left, gross: leftGross })
  }
  const methods = order.shipping_methods ?? []
  const orderShipping = toNumberOrNull(order.shipping_total)
  methods.forEach((m) => {
    const tax = normTax(taxValue(m.tax_lines, o.defaultVatRate))
    const own = toNumberOrNull(m.total)
    const gross =
      methods.length === 1 && orderShipping !== null
        ? round(orderShipping, 2)
        : own !== null
          ? round(own, 2)
          : round(toNumber(m.amount) * (m.is_tax_inclusive ? 1 : 1 + taxRate(tax) / 100), 2)
    lines.push({ name: (String(m.name ?? "").trim() || o.shippingPositionName).slice(0, 256), code: null, tax, unit: o.quantityUnit, quantity: 1, gross: Math.max(0, gross) })
  })
  const refunded = round(refundsOf(order).reduce((s, r) => s + r.amount, 0), 2)
  const excess = round(refunded - returnedValue, 2)
  const reduction = !canceled && excess > tolerance ? excess : 0
  return {
    canceled,
    lines: canceled ? [] : reduction > 0 ? spreadReduction(lines, reduction) : lines,
    returnedValue,
    returnedUnits,
    refunded,
    reduction,
  }
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export type SourceType = "return" | "refund" | "edit" | "cancel" | "scan" | "manual" | "demo"

export interface PlanSource {
  type: SourceType
  id: string
  at: string
}

export type ReasonKind = "cancel" | "return" | "refund" | "edit"
export type ManualReason = "receipt" | "claim_or_exchange" | "unknown_positions" | "unreadable_order"

export interface PlanNote {
  code: "refund_without_return" | "returned_not_refunded" | "order_unreadable"
  amount?: number
  detail?: string
}

export interface PlanBody {
  manualReason: ManualReason | null
  positions: PlannedPosition[]
  totals: Totals
  reasons: ReasonKind[]
  notes: PlanNote[]
}

export type PlanVerdict = { kind: "none" } | ({ kind: "draft" | "manual" } & PlanBody)

export interface PlanInput {
  documentKind: string
  /** Stored positions of the issued document; null or empty when unknown. */
  documentPositions: ReadonlyArray<Record<string, unknown>> | null
  /** Positions of the corrections already decided, one list per plan. */
  applied: ReadonlyArray<readonly PlannedPosition[]>
  order: CorrectionOrder
  options: LineOptions
  sources: readonly PlanSource[]
  /** Medusa's order version when the document was built (null for documents of 0.1.0). */
  orderVersionAtIssue: number | null
  claimsOrExchanges: boolean
  /** A person asked to check now: any difference counts, also without a change signal. */
  force?: boolean
  tolerance?: number
}

const EMPTY_TOTALS: Totals = { net: 0, vat: 0, gross: 0 }

export function planCorrection(input: PlanInput): PlanVerdict {
  const tolerance = input.tolerance ?? 0.02
  const manual = (manualReason: ManualReason, extra: Partial<PlanBody> = {}): PlanVerdict => ({
    kind: "manual",
    manualReason,
    positions: [],
    totals: EMPTY_TOTALS,
    reasons: [],
    notes: [],
    ...extra,
  })
  if (input.claimsOrExchanges) return manual("claim_or_exchange")
  const positions = (input.documentPositions ?? []).map((p) => storedLine(p))
  if (positions.length === 0) return manual("unknown_positions")

  let target: OrderTarget
  try {
    target = orderTarget(input.order, input.options, tolerance)
  } catch (err) {
    return manual("unreadable_order", { notes: [{ code: "order_unreadable", detail: (err as Error).message }] })
  }

  const eventTypes = new Set(input.sources.map((s) => s.type))
  const versionChanged = input.orderVersionAtIssue !== null && typeof input.order.version === "number" && input.order.version > input.orderVersionAtIssue
  const signal =
    input.force === true ||
    target.canceled ||
    target.returnedUnits > 0 ||
    target.refunded > tolerance ||
    versionChanged ||
    eventTypes.has("edit") ||
    eventTypes.has("cancel") ||
    eventTypes.has("return") ||
    eventTypes.has("refund")
  if (!signal) return { kind: "none" }

  const changed = diffStates(documentedState(positions, input.applied), aggregate(target.lines), 0.005)
  if (changed.length === 0) return { kind: "none" }

  const reasons: ReasonKind[] = []
  if (target.canceled) reasons.push("cancel")
  else {
    if (target.returnedUnits > 0) reasons.push("return")
    if (target.reduction > 0) reasons.push("refund")
    if (reasons.length === 0 || eventTypes.has("edit")) reasons.push("edit")
  }
  const notes: PlanNote[] = []
  if (!target.canceled && target.reduction > 0) notes.push({ code: "refund_without_return", amount: target.reduction })
  if (!target.canceled && target.returnedValue - target.refunded > tolerance) notes.push({ code: "returned_not_refunded", amount: round(target.returnedValue - target.refunded, 2) })

  const plan = { positions: changed, totals: totalsOf(changed), reasons, notes }
  if (input.documentKind === "receipt") return { kind: "manual", manualReason: "receipt", ...plan }
  return { kind: "draft", manualReason: null, ...plan }
}

/**
 * Demo mode, when the demo store has no return, refund or edit to plan from:
 * a simulated return of one unit of the document's first product line, so
 * the corrections can be clicked through. Null when the document has nothing
 * to return.
 */
export function simulatedReturn(stored: ReadonlyArray<Record<string, unknown>>): PlannedPosition[] | null {
  const lines = stored.map((p) => storedLine(p))
  const first = lines.find((l) => l.quantity >= 1 && l.gross > 0 && l.code !== null) ?? lines.find((l) => l.quantity >= 1 && l.gross > 0)
  if (!first) return null
  const left = round(first.quantity - 1, 4)
  const leftGross = round((first.gross * left) / first.quantity, 2)
  const dg = round(leftGross - first.gross, 2)
  return [
    {
      key: positionKey(first),
      name: first.name,
      code: first.code,
      tax: first.tax,
      unit: first.unit,
      before: { quantity: first.quantity, gross: first.gross },
      after: { quantity: left, gross: leftGross },
      delta: { quantity: -1, gross: dg, ...splitGross(dg, first.tax) },
    },
  ]
}

/** Plans with the same content need no new revision. */
export function samePlan(a: readonly PlannedPosition[], b: readonly PlannedPosition[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => {
    const q = b[i]
    return q && p.key === q.key && sameAmount(p.delta.quantity, q.delta.quantity, 1e-6) && sameAmount(p.delta.gross, q.delta.gross, 0.001) && sameAmount(p.before.gross, q.before.gross, 0.001)
  })
}

/** Sources of two plans together, without repeats. */
export function mergeSources(a: readonly PlanSource[] | null | undefined, b: readonly PlanSource[] | null | undefined): PlanSource[] {
  const out: PlanSource[] = []
  const seen = new Set<string>()
  for (const s of [...(a ?? []), ...(b ?? [])]) {
    const k = `${s.type}:${s.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/**
 * The business key of an approved correction: the order's source events
 * ("return:return_01J...+refund:ref_01J..."), or the plan id when a plan was
 * found by the scan without an event. The database refuses a second
 * correction document with the same key for one order.
 */
export function sourceKey(sources: readonly PlanSource[], planId: string): string {
  const ids = [...new Set(sources.filter((s) => s.id && s.type !== "scan").map((s) => `${s.type}:${s.id}`))].sort()
  if (ids.length === 0) return `plan:${planId}`
  const key = ids.join("+")
  if (key.length <= 300) return key
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${key.slice(0, 280)}#${(h >>> 0).toString(16)}`
}

const REASON_TEXT: Record<"pl" | "en", Record<ReasonKind, string>> = {
  pl: { cancel: "Anulowanie zamówienia", return: "Zwrot towaru", refund: "Obniżenie ceny po sprzedaży", edit: "Zmiana zamówienia" },
  en: { cancel: "Order canceled", return: "Return of goods", refund: "Price reduction after sale", edit: "Order changed" },
}

/** `correction_reason`: what happened, in the document's language, at most 256 characters (the KSeF limit). */
export function correctionReasonText(reasons: readonly ReasonKind[], lang: string, orderNumber: string | null): string {
  const l = /^pl/i.test(lang) ? "pl" : "en"
  const parts = [...new Set(reasons)].map((r) => REASON_TEXT[l][r])
  const text = parts.length > 0 ? parts.join(", ") : REASON_TEXT[l].edit
  const order = orderNumber ? (l === "pl" ? ` (zamówienie ${orderNumber})` : ` (order ${orderNumber})`) : ""
  return `${text}${order}`.slice(0, 256)
}

/* ------------------------------------------------------------------ */
/* What goes to Fakturownia                                            */
/* ------------------------------------------------------------------ */

type RemoteRecord = Record<string, unknown>

/**
 * Buyer fields copied from the corrected invoice. On a KSeF account a
 * correction must not change the buyer's type, tax ID, e-mail, phones or
 * note (KSeF.md, "Korekty faktur"), so they are copied as Fakturownia holds
 * them, never rebuilt from the order.
 */
export const CORRECTION_BUYER_FIELDS: readonly string[] = [
  "buyer_name",
  "buyer_company",
  "buyer_first_name",
  "buyer_last_name",
  "buyer_tax_no",
  "buyer_tax_no_kind",
  "buyer_email",
  "buyer_phone",
  "buyer_mobile_phone",
  "buyer_street",
  "buyer_post_code",
  "buyer_city",
  "buyer_country",
  "buyer_note",
]

/** Document fields copied from the corrected invoice (the seller department must not change either). */
export const CORRECTION_DOCUMENT_FIELDS: readonly string[] = ["oid", "currency", "lang", "department_id", "category_id", "place", "payment_type", "sell_date"]

function present(v: unknown): boolean {
  return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")
}

function taxOut(tax: string): string | number {
  return /^\d/.test(tax) ? Number(tax) : tax
}

/** The marker in `internal_note` (a private note, not printed) that identifies the correction of one outbox row. */
export function correctionMarker(rowId: string): string {
  return `[medusa:${rowId}]`
}

export interface CorrectionBuildArgs {
  /** The Fakturownia id of the corrected invoice. */
  originalId: string
  /** `YYYY-MM-DD` in Poland. */
  today: string
  reason: string
  /** The outbox row id of the correction: it goes into `internal_note`. */
  rowId: string
  orderLabel: string
  /** Used when the original was not read (demo mode). */
  fallback: { lang: string; issuePlace: string; currency: string; oid: string | null }
}

/**
 * The correction invoice, as documented: `kind: "correction"`, the reason,
 * `invoice_id` and `from_invoice_id` pointing at the corrected invoice, and
 * one position per changed identity with `kind: "correction"`, the change as
 * its quantity and gross value, and the state before and after in
 * `correction_before_attributes` and `correction_after_attributes`.
 * `oid_unique` is never sent: the corrected invoice carries the same order
 * number.
 */
export function buildCorrectionInvoice(original: RemoteRecord | null, positions: readonly PlannedPosition[], args: CorrectionBuildArgs): Record<string, unknown> {
  if (!/^\d+$/.test(args.originalId)) throw new PayloadError("original_unknown", "The corrected document has no Fakturownia id.")
  if (positions.length === 0) throw new PayloadError("plan_empty", "The correction has no positions.")
  const invoice: Record<string, unknown> = {
    kind: "correction",
    correction_reason: args.reason.slice(0, 256),
    invoice_id: Number(args.originalId),
    from_invoice_id: Number(args.originalId),
    issue_date: args.today,
    internal_note: `Medusa ${args.orderLabel} ${correctionMarker(args.rowId)}`.slice(0, 500),
  }
  if (original) {
    for (const f of CORRECTION_DOCUMENT_FIELDS) if (present(original[f])) invoice[f] = original[f]
    for (const f of CORRECTION_BUYER_FIELDS) if (present(original[f])) invoice[f] = original[f]
    const company = original.buyer_company
    invoice.buyer_company = company === true || company === "true" || company === "1" || company === 1
  } else {
    invoice.currency = args.fallback.currency
    invoice.lang = args.fallback.lang
    if (args.fallback.issuePlace) invoice.place = args.fallback.issuePlace
    if (args.fallback.oid) invoice.oid = args.fallback.oid
  }
  invoice.positions = positions.map((p) => {
    const common = { name: p.name, ...(p.code ? { code: p.code } : {}), tax: taxOut(p.tax), quantity_unit: p.unit || "szt." }
    return {
      ...common,
      quantity: p.delta.quantity,
      total_price_gross: p.delta.gross,
      kind: "correction",
      correction_before_attributes: { ...common, quantity: p.before.quantity, total_price_gross: p.before.gross, kind: "correction_before" },
      correction_after_attributes: { ...common, quantity: p.after.quantity, total_price_gross: p.after.gross, kind: "correction_after" },
    }
  })
  return invoice
}

/**
 * Whether the invoice in Fakturownia still holds what the plugin issued.
 * Someone may have edited it there (before KSeF accepted it): a correction
 * whose "before" is not the truth would be wrong, so it is not sent. Returns
 * a readable difference, or null when they match.
 */
export function originalMismatch(stored: ReadonlyArray<Record<string, unknown>>, remotePositions: unknown): string | null {
  if (!Array.isArray(remotePositions)) return "Fakturownia did not return the positions of the invoice."
  const remote = aggregate(
    remotePositions
      .filter((p): p is RemoteRecord => Boolean(p) && typeof p === "object")
      .filter((p) => !String(p.kind ?? "").startsWith("correction"))
      .map((p) => storedLine({ name: p.name, code: p.code, quantity: p.quantity, unit: p.quantity_unit, gross: p.total_price_gross, tax: p.tax })),
  )
  const ours = aggregate(stored.map((p) => storedLine(p)))
  for (const [key, a] of ours) {
    const b = remote.get(key)
    if (!b) return `"${a.name}" is not on the invoice in Fakturownia.`
    if (Math.abs(a.quantity - b.quantity) > 1e-6 || Math.abs(a.gross - b.gross) > 0.01) {
      return `"${a.name}" is ${b.quantity} for ${b.gross.toFixed(2)} in Fakturownia, ${a.quantity} for ${a.gross.toFixed(2)} in the plugin.`
    }
  }
  for (const [key, b] of remote) if (!ours.has(key)) return `"${b.name}" is on the invoice in Fakturownia but not in the plugin.`
  return null
}

/* ------------------------------------------------------------------ */
/* Looking a correction up                                             */
/* ------------------------------------------------------------------ */

export interface CorrectionCandidate {
  id: string
  number: string | null
  kind: string
  oid: string | null
  gross: number | null
  currency: string | null
  issueDate: string | null
  fromInvoiceId: string | null
  invoiceId: string | null
  internalNote: string | null
}

export interface CorrectionMatchSpec {
  originalId: string
  /** `correctionMarker(rowId)`. */
  marker: string
  totalGross: number
  currency: string | null
  notBefore: string | null
  /** Fakturownia ids of this invoice's corrections other outbox rows already own. */
  excludeIds: readonly string[]
}

export type CorrectionMatch<T extends CorrectionCandidate = CorrectionCandidate> =
  | { kind: "match"; doc: T }
  | { kind: "conflict"; doc: T; reason: string }
  | { kind: "none" }

/**
 * Our correction among the corrections of one invoice: the one whose private
 * note carries this row's marker; failing that (a list answer without notes),
 * the only one of the same value that no other row owns and no other marker
 * names. Two of the same value: a conflict, a person decides. Corrections of
 * other values are someone else's and ignored.
 */
export function matchCorrection<T extends CorrectionCandidate>(candidates: readonly T[], spec: CorrectionMatchSpec): CorrectionMatch<T> {
  const seen = new Set<string>()
  const linked = candidates.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    if (c.kind !== "correction") return false
    if (c.fromInvoiceId !== spec.originalId && c.invoiceId !== spec.originalId) return false
    if (spec.excludeIds.includes(c.id)) return false
    if (spec.notBefore && c.issueDate && c.issueDate < spec.notBefore) return false
    return true
  })
  const marked = linked.find((c) => (c.internalNote ?? "").includes(spec.marker))
  if (marked) return { kind: "match", doc: marked }
  const unowned = linked.filter((c) => !/\[medusa:/.test(c.internalNote ?? ""))
  const same = unowned.filter((c) => sameAmount(c.gross, spec.totalGross, 0.01) && (!spec.currency || !c.currency || c.currency === spec.currency))
  if (same.length === 1) return { kind: "match", doc: same[0] }
  if (same.length > 1) {
    return {
      kind: "conflict",
      doc: same[0],
      reason:
        `Fakturownia holds ${same.length} corrections of this invoice for ${spec.totalGross} (${same.map((c) => c.number ?? c.id).join(", ")}), ` +
        "and none is marked as this one. Nothing was issued: check them in Fakturownia, then mark this correction as issued or dismiss it.",
    }
  }
  return { kind: "none" }
}
