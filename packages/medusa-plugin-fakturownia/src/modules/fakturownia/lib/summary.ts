/**
 * THE MONTHLY SUMMARY. Pure: issued rows in, one line per month out (newest
 * first): how many documents of each kind and their gross value per
 * currency, what is still unpaid, and the share KSeF accepted.
 *
 *   value     gross totals per currency, never added across currencies;
 *             a correction counts with its own (usually negative) value
 *   unpaid    `lib/unpaid.ts`, the one definition of the plugin: VAT
 *             invoices, receipts and proformas issued unpaid; a proforma
 *             already turned into a final document and the documents of
 *             canceled orders are left out, so one order's money is not
 *             counted twice
 *   KSeF      accepted among the VAT invoices and corrections that went to
 *             KSeF (a status other than none or not applicable); null when
 *             none did (an account without KSeF)
 */

import type { DocumentKind, MoneyDto, SummaryMonthDto } from "./contract"
import { round, toNumber } from "./numbers"
import { baseGovStatus } from "./status"
import { isUnpaid } from "./unpaid"

export interface SummaryRow {
  kind: string
  status: string
  issue_date: string | null
  total_gross: number | string | null
  currency: string | null
  paid: boolean
  gov_status: string | null
  fakturownia_id: string | null
  from_fakturownia_id: string | null
  converted_at?: Date | string | null
  cancel_requested_at?: Date | string | null
}

const KINDS: readonly DocumentKind[] = ["vat", "proforma", "receipt", "correction"]

/** `YYYY-MM` of the given month offset from `now` (0 is this month), in UTC calendar terms. */
export function monthKey(now: Date, offset: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function add(list: MoneyDto[], currency: string, amount: number): void {
  const found = list.find((m) => m.currency === currency)
  if (found) found.amount = round(found.amount + amount, 2)
  else list.push({ currency, amount: round(amount, 2) })
}

export function monthlySummary(rows: readonly SummaryRow[], now: Date, months = 12): SummaryMonthDto[] {
  const keys = Array.from({ length: months }, (_, i) => monthKey(now, i))
  const byMonth = new Map<string, SummaryMonthDto>()
  for (const key of keys) {
    byMonth.set(key, {
      month: key,
      kinds: { vat: { count: 0, gross: [] }, proforma: { count: 0, gross: [] }, receipt: { count: 0, gross: [] }, correction: { count: 0, gross: [] } },
      unpaidCount: 0,
      unpaid: [],
      ksef: { accepted: 0, total: 0, share: null },
    })
  }
  const converted = new Set(rows.map((r) => r.from_fakturownia_id).filter((id): id is string => Boolean(id)))
  for (const r of rows) {
    if (r.status !== "issued" && r.status !== "needs_correction") continue
    const month = byMonth.get(String(r.issue_date ?? "").slice(0, 7))
    if (!month || !(KINDS as readonly string[]).includes(r.kind)) continue
    const kind = r.kind as DocumentKind
    const currency = (r.currency ?? "PLN").toUpperCase()
    const gross = toNumber(r.total_gross)
    month.kinds[kind].count += 1
    add(month.kinds[kind].gross, currency, gross)
    if (isUnpaid(r, converted)) {
      month.unpaidCount += 1
      add(month.unpaid, currency, gross)
    }
    if (kind === "vat" || kind === "correction") {
      const gov = baseGovStatus(r.gov_status)
      if (gov && gov !== "null" && gov !== "not_applicable") {
        month.ksef.total += 1
        if (gov === "ok") month.ksef.accepted += 1
      }
    }
  }
  for (const m of byMonth.values()) m.ksef.share = m.ksef.total > 0 ? round(m.ksef.accepted / m.ksef.total, 4) : null
  return keys.map((k) => byMonth.get(k) as SummaryMonthDto)
}
