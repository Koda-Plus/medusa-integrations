/**
 * What the e-mails of a code gave: per send (one click of "Send the code",
 * the people of one `code_sent` batch) how many got it, how many e-mails
 * were delivered and opened (when the store reports it), how many of them
 * ordered with the code afterwards, their orders, the revenue and the
 * conversion. Pure: the workflow reads the orders and the delivery, this
 * only counts, so the tests and the admin agree.
 *
 * An order counts for a send when it was placed by one of its people, with
 * the coupon, at or after the send. A person gets the code once, so she
 * belongs to one send only. Orders with the code by people who never got
 * the e-mail are "others" (the code passed on, a newsletter, the automatic
 * part of a coupon).
 */
import type { CodeMailCampaignDto, CodeMailDeliveryState, CodeMailStatsTotals, CodeSentEntry } from "./contract"

/** One non-canceled order with the coupon. `revenue` in the store's basis (option orderRevenue, else the order total). */
export interface CouponOrderFact {
  orderId: string
  customerId: string | null
  createdAt: string
  revenue: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Buyers of all people, in percent with one decimal; null without people. */
export function conversionOf(buyers: number, recipients: number): number | null {
  return recipients > 0 ? Math.round((buyers / recipients) * 1000) / 10 : null
}

/** The sends of a coupon: entries of the same moment and sender belong to one send. */
export function batchesOf(sent: readonly CodeSentEntry[]): Array<{ at: string; by: string | null; entries: CodeSentEntry[] }> {
  const out = new Map<string, { at: string; by: string | null; entries: CodeSentEntry[] }>()
  for (const e of sent) {
    const key = `${e.at}\u0000${e.by ?? ""}`
    const b = out.get(key) ?? { at: e.at, by: e.by, entries: [] }
    b.entries.push(e)
    out.set(key, b)
  }
  return [...out.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

const DELIVERED = new Set<CodeMailDeliveryState>(["delivered", "opened", "clicked"])
const OPENED = new Set<CodeMailDeliveryState>(["opened", "clicked"])
const FAILED = new Set<CodeMailDeliveryState>(["bounced", "failed", "complained", "suppressed"])

/**
 * The sends of a coupon with their results, newest first, and the totals.
 * `delivery` maps a customer id to what happened to her e-mail; null means
 * the store reports no delivery (the admin shows "no data" instead of 0).
 */
export function codeMailCampaigns(input: {
  sent: readonly CodeSentEntry[]
  orders: readonly CouponOrderFact[]
  delivery: Readonly<Record<string, CodeMailDeliveryState | null | undefined>> | null
  /** The coupon's own code, left out of the other codes of a send of several. */
  ownCode?: string
}): { campaigns: CodeMailCampaignDto[]; totals: CodeMailStatsTotals } {
  const known = input.delivery !== null
  const byCustomer = new Map<string, CouponOrderFact[]>()
  for (const o of input.orders) {
    if (!o.customerId) continue
    const list = byCustomer.get(o.customerId) ?? []
    list.push(o)
    byCustomer.set(o.customerId, list)
  }
  const counted = new Set<string>()
  const campaigns: CodeMailCampaignDto[] = batchesOf(input.sent).map((b) => {
    const people = [...new Set(b.entries.map((e) => e.customer_id))]
    const since = new Date(b.at).getTime()
    let buyers = 0
    let orders = 0
    let revenue = 0
    let delivered = 0
    let opened = 0
    let failed = 0
    for (const cid of people) {
      const own = (byCustomer.get(cid) ?? []).filter((o) => !counted.has(o.orderId) && (!Number.isFinite(since) || new Date(o.createdAt).getTime() >= since))
      if (own.length) buyers++
      for (const o of own) {
        counted.add(o.orderId)
        orders++
        revenue += o.revenue
      }
      const d = input.delivery?.[cid] ?? null
      if (d && DELIVERED.has(d)) delivered++
      if (d && OPENED.has(d)) opened++
      if (d && FAILED.has(d)) failed++
    }
    const withCodes = [...new Set(b.entries.flatMap((e) => e.codes ?? []))].filter((code) => code !== input.ownCode)
    return {
      at: b.at,
      by: b.by,
      ...(withCodes.length ? { withCodes } : {}),
      recipients: people.length,
      delivery: known ? { delivered, opened, failed } : null,
      buyers,
      orders,
      revenue: round2(revenue),
      conversion: conversionOf(buyers, people.length),
    }
  })

  const sum = (f: (c: CodeMailCampaignDto) => number) => campaigns.reduce((s, c) => s + f(c), 0)
  const recipients = sum((c) => c.recipients)
  const buyers = sum((c) => c.buyers)
  const allRevenue = input.orders.reduce((s, o) => s + o.revenue, 0)
  const fromMail = round2(sum((c) => c.revenue))
  const totals: CodeMailStatsTotals = {
    recipients,
    delivery: known ? { delivered: sum((c) => c.delivery?.delivered ?? 0), opened: sum((c) => c.delivery?.opened ?? 0), failed: sum((c) => c.delivery?.failed ?? 0) } : null,
    buyers,
    orders: sum((c) => c.orders),
    revenue: fromMail,
    conversion: conversionOf(buyers, recipients),
    allOrders: input.orders.length,
    allRevenue: round2(allRevenue),
    otherOrders: input.orders.length - counted.size,
    otherRevenue: round2(allRevenue - fromMail),
  }
  return { campaigns, totals }
}
