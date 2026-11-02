/**
 * THE STATISTICS TAB: reads the plugin's rows of the window and the Medusa
 * orders of the other sales channels, and hands them to `computeStats`.
 * Read only; nothing is asked of the marketplace while answering (the sync
 * keeps the rows fresh).
 */

import type { StatsResponse } from "../../modules/vonhalsky/lib/contract"
import { toMinor } from "../../modules/vonhalsky/lib/pricing"
import { computeStats, type OtherChannelOrder } from "../../modules/vonhalsky/lib/stats"
import { readSettings, vonHalskySvc, type Scope } from "../../modules/vonhalsky/lib/store"
import { queryOf } from "./runtime"

type Row = Record<string, any>

const PAGE = 1000
const MAX_ROWS = 20_000

async function all(list: (skip: number, take: number) => Promise<Row[] | undefined>): Promise<Row[]> {
  const out: Row[] = []
  for (let skip = 0; skip < MAX_ROWS; skip += PAGE) {
    const page = (await list(skip, PAGE)) ?? []
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

/** A Medusa total as minor units: a number, a numeric string or a BigNumber-like object. */
function minorOf(v: unknown): number {
  if (v && typeof v === "object") {
    const o = v as { numeric?: unknown; value?: unknown }
    return toMinor(o.numeric ?? o.value) ?? 0
  }
  return toMinor(v) ?? 0
}

/** PLN orders placed in the other Medusa sales channels (the marketplace's own orders left out by id). */
async function otherChannelOrders(scope: Scope, from: Date): Promise<{ orders: OtherChannelOrder[]; names: Map<string, string> }> {
  const query = queryOf(scope)
  const rows = await all(async (skip, take) => {
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "sales_channel_id", "currency_code", "status", "total", "created_at"],
      filters: { created_at: { $gte: from } },
      pagination: { skip, take, order: { created_at: "DESC" } },
    })
    return data as Row[]
  })
  const svc = vonHalskySvc(scope)
  const ours = new Set<string>()
  const ids = rows.map((r) => String(r.id))
  for (let i = 0; i < ids.length; i += 500) {
    const mine = ((await svc.listVonHalskyOrders({ order_id: ids.slice(i, i + 500) }, { take: 1000, select: ["id", "order_id"] })) ?? []) as Row[]
    for (const m of mine) if (m.order_id) ours.add(String(m.order_id))
  }
  const orders = rows
    .filter((r) => !ours.has(String(r.id)) && String(r.currency_code ?? "").toLowerCase() === "pln" && r.status !== "canceled" && r.status !== "draft")
    .map((r) => ({ sales_channel_id: r.sales_channel_id ?? null, total_minor: minorOf(r.total), created_at: r.created_at }))
  const names = new Map<string, string>()
  const channelIds = [...new Set(orders.map((o) => o.sales_channel_id).filter((x): x is string => Boolean(x)))]
  if (channelIds.length) {
    const { data } = await query.graph({ entity: "sales_channel", fields: ["id", "name"], filters: { id: channelIds } })
    for (const c of data as Row[]) names.set(String(c.id), String(c.name ?? c.id))
  }
  return { orders, names }
}

export async function readStats(scope: Scope, days: number, now = new Date()): Promise<StatsResponse> {
  const svc = vonHalskySvc(scope)
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const settings = await readSettings(scope)
  const [orders, offers, cases, snapshots, other] = await Promise.all([
    all((skip, take) => svc.listVonHalskyOrders({ $or: [{ placed_at: { $gte: from } }, { placed_at: null, created_at: { $gte: from } }] }, { skip, take })),
    all((skip, take) =>
      svc.listVonHalskyOffers({}, { skip, take, select: ["id", "remote_id", "status", "remote_status", "title", "sku", "stock", "promotion", "program", "validation"] }),
    ),
    all((skip, take) => svc.listVonHalskyCases({ $or: [{ opened_at: { $gte: from } }, { opened_at: null, created_at: { $gte: from } }] }, { skip, take })),
    all((skip, take) => svc.listVonHalskySnapshots({}, { skip, take, order: { day: "DESC" } })),
    otherChannelOrders(scope, from).catch(() => ({ orders: [] as OtherChannelOrder[], names: new Map<string, string>() })),
  ])
  return computeStats({
    days,
    now,
    orders,
    offers,
    cases,
    snapshots: snapshots.slice(0, 120),
    otherOrders: other.orders,
    channelNames: other.names,
    daysToShip: settings.offerDefaults.daysToShip,
  })
}
