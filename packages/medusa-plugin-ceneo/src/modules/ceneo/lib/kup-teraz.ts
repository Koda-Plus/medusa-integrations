/**
 * KUP TERAZ ORDERS, READ SIDE. Pure, zero runtime imports.
 *
 * The transport is what the sync talks to: the live one wraps the Ceneo
 * client, the demo one simulates an account from the store's own offers.
 * The same sync code runs on both.
 *
 * What is stored per order (`ceneo_order`): the Ceneo ids, the state, the
 * amounts and the items matched to variants. Shipping, invoice and pickup
 * data (names, addresses, phone, e-mail) are NOT stored: the admin reads
 * them from Ceneo when an order is opened, and the import of stage 6 when
 * it creates the Medusa order.
 */

import { isGuid, odataList, ordersFilter, parseCeneoDate, type OrderFilter } from "./odata"

export interface CeneoOrderRaw {
  Id: string
  DisplayedOrderId?: string | null
  ShopOrderId?: string | null
  CreatedDate?: string | null
  OrderStateId?: number | null
  PaymentTypeId?: number | null
  PaymentMethodId?: number | null
  ShopDeliveryFormName?: string | null
  DeliveryCost?: number | null
  OrderValue?: number | null
  ProductsValue?: number | null
  CustomerRemark?: string | null
}

export interface CeneoItemRaw {
  ShopProductId?: string | null
  Name?: string | null
  Price?: number | null
  Count?: number | null
  TotalItemPrice?: number | null
  Returned?: number | null
}

export interface CeneoDictEntry {
  id: number
  value: string
  description: string
}

/** The order data that holds personal data: read on demand, never stored. */
export interface CeneoOrderDetailRaw {
  shipping: Record<string, unknown>[]
  invoice: Record<string, unknown>[]
  pickup: Record<string, unknown>[]
  services: Record<string, unknown>[]
  /** The buyer's remark (free text, may hold a phone or an address): read here, never stored. */
  remark: string | null
}

export interface CeneoTransport {
  readonly demo: boolean
  orders(filter: OrderFilter, skip: number): Promise<CeneoOrderRaw[]>
  items(orderId: string): Promise<CeneoItemRaw[]>
  detail(orderId: string): Promise<CeneoOrderDetailRaw>
  states(): Promise<CeneoDictEntry[]>
}

/* ---- from OData rows ------------------------------------------------ */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

export function toOrderRaw(r: Record<string, unknown>): CeneoOrderRaw | null {
  if (!isGuid(r.Id)) return null
  return {
    Id: r.Id.toLowerCase(),
    DisplayedOrderId: text(r.DisplayedOrderId),
    ShopOrderId: text(r.ShopOrderId),
    CreatedDate: text(r.CreatedDate),
    OrderStateId: num(r.OrderStateId),
    PaymentTypeId: num(r.PaymentTypeId),
    PaymentMethodId: num(r.PaymentMethodId),
    ShopDeliveryFormName: text(r.ShopDeliveryFormName),
    DeliveryCost: num(r.DeliveryCost),
    OrderValue: num(r.OrderValue),
    ProductsValue: num(r.ProductsValue),
    CustomerRemark: text(r.CustomerRemark),
  }
}

export function toItemRaw(r: Record<string, unknown>): CeneoItemRaw {
  return { ShopProductId: text(r.ShopProductId), Name: text(r.Name), Price: num(r.Price), Count: num(r.Count), TotalItemPrice: num(r.TotalItemPrice), Returned: num(r.Returned) }
}

export function toDict(body: unknown): CeneoDictEntry[] {
  return odataList(body)
    .map((r) => ({ id: num(r.Id), value: text(r.Value) ?? "", description: text(r.Description) ?? text(r.Value) ?? "" }))
    .filter((e): e is CeneoDictEntry => e.id !== null)
    .sort((a, b) => a.id - b.id)
}

/** The live transport over a client with `get(path, query)`. */
export function liveTransport(client: { get(path: string, query?: Record<string, string>): Promise<unknown> }): CeneoTransport {
  const order = (id: string, sub: string) => {
    if (!isGuid(id)) throw new Error(`Not a Ceneo order id: ${id}`)
    return `/BasketService.svc/Orders(guid'${id}')/${sub}`
  }
  return {
    demo: false,
    async orders(filter, skip) {
      const q: Record<string, string> = { $orderby: "CreatedDate asc" }
      const f = ordersFilter(filter)
      if (f) q.$filter = f
      if (skip > 0) q.$skip = String(skip)
      return odataList(await client.get("/BasketService.svc/Orders", q))
        .map(toOrderRaw)
        .filter((o): o is CeneoOrderRaw => o !== null)
    },
    async items(id) {
      return odataList(await client.get(order(id, "OrderItems"))).map(toItemRaw)
    },
    async detail(id) {
      const [shipping, invoice, pickup, services] = await Promise.all(["ShippingData", "InvoiceData", "PickupPoint", "OrderAdditionalServices"].map(async (s) => odataList(await client.get(order(id, s)))))
      const head = odataList(await client.get(`/BasketService.svc/Orders(guid'${id}')`))[0]
      return { shipping, invoice, pickup, services, remark: text(head?.CustomerRemark) }
    },
    async states() {
      return toDict(await client.get("/BasketService.svc/OrderStates"))
    },
  }
}

export interface ApiLimit {
  method: string
  perPeriod: number
  left: number
  expires: string | null
}

/** `GetExecutionLimits` nests `Response.Result.Response.Result.limits.limit` (Swagger example). */
export function limitsOf(body: unknown): ApiLimit[] {
  const dig = (v: unknown, keys: string[]): unknown => keys.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), v)
  const candidates = [dig(body, ["Response", "Result", "Response", "Result", "limits", "limit"]), dig(body, ["Result", "Response", "Result", "limits", "limit"]), dig(body, ["Result", "limits", "limit"]), dig(body, ["limits", "limit"])]
  const list = candidates.find((c) => Array.isArray(c)) as Record<string, unknown>[] | undefined
  return (list ?? []).map((l) => ({
    method: String(l.function ?? ""),
    perPeriod: Number(l.execution_per_period ?? 0) || 0,
    left: Number(l.period_executions_left ?? 0) || 0,
    expires: typeof l.period_expires === "string" ? l.period_expires : null,
  }))
}

/* ---- the row ---------------------------------------------------------- */

export type OrderProblemCode = "item_unmatched" | "item_no_id" | "state_unknown" | "date_invalid"
export interface OrderProblem {
  code: OrderProblemCode
  detail?: string
}

export interface OrderItemRow {
  shop_product_id: string | null
  name: string | null
  price: number | null
  quantity: number
  total: number | null
  returned: number
  variant_id: string | null
}

export interface OrderRowData {
  ceneo_order_id: string
  displayed_order_id: string | null
  shop_order_id: string | null
  state_id: number | null
  ordered_at: Date | null
  amounts: { order: number | null; products: number | null; delivery: number | null }
  delivery_form: string | null
  payment_type_id: number | null
  payment_method_id: number | null
  items: OrderItemRow[]
  matched: boolean
  problems: OrderProblem[] | null
  demo: boolean
}

/**
 * The row of a Ceneo order. `variantOf` maps an offer id from the feed
 * (ShopProductId) to the variant that has it, retired ids included: an
 * order may come for an id the variant no longer uses.
 */
export function toOrderRow(o: CeneoOrderRaw, items: CeneoItemRaw[], variantOf: (offerId: string) => string | null, knownStates: ReadonlySet<number> | null, demo: boolean): OrderRowData {
  const problems: OrderProblem[] = []
  const rows: OrderItemRow[] = items.map((i) => {
    const id = i.ShopProductId ?? null
    const variant = id ? variantOf(id) : null
    if (!id) problems.push({ code: "item_no_id", detail: i.Name ?? "" })
    else if (!variant) problems.push({ code: "item_unmatched", detail: id })
    return { shop_product_id: id, name: i.Name ?? null, price: i.Price ?? null, quantity: Math.max(0, Math.round(i.Count ?? 0)), total: i.TotalItemPrice ?? null, returned: Math.max(0, Math.round(i.Returned ?? 0)), variant_id: variant }
  })
  const state = o.OrderStateId ?? null
  if (state !== null && knownStates && !knownStates.has(state)) problems.push({ code: "state_unknown", detail: String(state) })
  const ordered = parseCeneoDate(o.CreatedDate)
  if (!ordered) problems.push({ code: "date_invalid", detail: o.CreatedDate ?? "" })
  return {
    ceneo_order_id: o.Id,
    displayed_order_id: o.DisplayedOrderId ?? null,
    shop_order_id: o.ShopOrderId ?? null,
    state_id: state,
    ordered_at: ordered,
    amounts: { order: o.OrderValue ?? null, products: o.ProductsValue ?? null, delivery: o.DeliveryCost ?? null },
    delivery_form: o.ShopDeliveryFormName ?? null,
    payment_type_id: o.PaymentTypeId ?? null,
    payment_method_id: o.PaymentMethodId ?? null,
    items: rows,
    matched: rows.length > 0 && rows.every((r) => r.variant_id !== null),
    problems: problems.length > 0 ? problems : null,
    demo,
  }
}

/** Fields that a later read may change: an unchanged order writes nothing. */
export function orderChanged(prev: Record<string, unknown>, next: OrderRowData): boolean {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return (
    !same(prev.state_id, next.state_id) ||
    !same(prev.displayed_order_id, next.displayed_order_id) ||
    !same(prev.delivery_form, next.delivery_form) ||
    !same(prev.payment_type_id, next.payment_type_id) ||
    !same(prev.payment_method_id, next.payment_method_id) ||
    !same(prev.ordered_at ? new Date(String(prev.ordered_at instanceof Date ? prev.ordered_at.toISOString() : prev.ordered_at)).getTime() : null, next.ordered_at ? next.ordered_at.getTime() : null) ||
    !same(prev.shop_order_id, next.shop_order_id) ||
    !same(prev.amounts, next.amounts) ||
    !same(prev.items, next.items) ||
    !same(prev.problems, next.problems) ||
    prev.matched !== next.matched
  )
}
