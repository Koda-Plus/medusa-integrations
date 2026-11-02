import { Fragment, useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  ArrowPath,
  ArrowUpRightMini,
  ArrowUpRightOnBox,
  ArrowUturnLeft,
  Clock,
  CreditCard,
  ExclamationCircle,
  History as HistoryIcon,
  ListBullet,
  MagnifyingGlass,
  PaperPlane,
  ShoppingCart,
  TruckFast,
  XCircle,
} from "@medusajs/icons"
import { Input, Table, Text, toast, usePrompt } from "@medusajs/ui"
import type { MarketplaceOrderDto, OrderFilter, StatusResponse } from "../../modules/vonhalsky/lib/contract"
import { errorMessage, useCheckTracking, useDemoShip, useRefundOrder, useRetryOrder, useVonHalskyOrders } from "./vonhalsky-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue } from "./vonhalsky-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./vonhalsky-kit"
import { KitOrderProductsCell, useKitOrderProducts } from "./vonhalsky-order-products"
import { EventList, Fact, Field, FormDrawer, ImportBadge, TrackingBadge, fmtDate, fmtDateTime, fmtMoney, parseAmount } from "./vonhalsky-ui"

export const ORDER_FILTERS: OrderFilter[] = ["all", "awaiting_shipment", "tracking_waiting", "held", "errors"]
const PAGE = 50
const COLS = 9

const FILTER_ICON: Record<OrderFilter, ReactNode> = {
  all: <ListBullet />,
  awaiting_shipment: <Clock />,
  tracking_waiting: <TruckFast />,
  held: <ExclamationCircle />,
  errors: <XCircle />,
}
const FILTER_GROUPS: OrderFilter[][] = [["all"], ["awaiting_shipment", "tracking_waiting"], ["held", "errors"]]
const ATTENTION: OrderFilter[] = ["tracking_waiting", "held", "errors"]

function filterCount(s: StatusResponse, f: OrderFilter): number {
  return f === "all" ? s.counts.orders : s.counts[f]
}

/** The marketplace orders with the Medusa orders they became: products, delivery, payment, parcels, after sale and the actions of each. */
export function OrdersSection({ status: s, lang, filter, onFilter, initialQuery }: { status: StatusResponse; lang: string; filter: OrderFilter; onFilter: (f: OrderFilter) => void; initialQuery: string }) {
  const { t } = useTranslation("vonhalsky")
  const [input, setInput] = useState(initialQuery)
  const q = useDebouncedValue(input.trim())
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [refund, setRefund] = useState<MarketplaceOrderDto | null>(null)
  useEffect(() => setOffset(0), [filter, q])

  const list = useVonHalskyOrders(filter, q, offset, PAGE)
  const rows = list.data?.orders ?? []
  const count = list.data?.count ?? 0
  const products = useKitOrderProducts(rows.map((r) => r.order_id))
  /* A second click on the active filter clears it. */
  const pick = (f: OrderFilter) => onFilter(filter === f ? "all" : f)
  const fresh = filter === "all" && !q

  return (
    <Section
      id="vonhalsky-orders"
      icon={<ShoppingCart />}
      title={t("orders.title")}
      pointsLabel={t("orders.subtitle")}
      points={[
        { icon: <ShoppingCart />, text: t("orders.points.medusa") },
        { icon: <CreditCard />, text: t("orders.points.paid") },
        { icon: <TruckFast />, text: t("orders.points.tracking") },
      ]}
      actions={<SearchInput value={input} onChange={setInput} placeholder={t("orders.search")} className="sm:w-72" />}
    >
      <FilterBar>
        {FILTER_GROUPS.map((group, i) => (
          <span key={group.join()} className="contents">
            {i > 0 ? <FilterDivider /> : null}
            {group.map((f) => (
              <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`orderFilter.${f}`)} count={filterCount(s, f)} attention={ATTENTION.includes(f)} active={filter === f} onClick={() => pick(f)} />
            ))}
          </span>
        ))}
      </FilterBar>
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("orders.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.status")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.products")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.delivery")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.payment")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("orders.total")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.tracking")}</Table.HeaderCell>
              <Table.HeaderCell>{t("orders.order")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? <KitSkeletonRows cols={COLS} rows={5} /> : null}
            {!list.isLoading && rows.length === 0 ? (
              <EmptyTableRow
                cols={COLS}
                icon={FILTER_ICON[filter]}
                title={fresh ? t("orders.empty") : t("orders.emptyFiltered")}
                points={fresh && s.mode === "demo" ? [{ icon: <PaperPlane />, text: t("orders.emptyDemo") }] : undefined}
              />
            ) : null}
            {rows.map((o) => (
              <Fragment key={o.id}>
                <Table.Row className="cursor-pointer [&_td]:py-2.5 align-top" onClick={() => setOpen(open === o.id ? null : o.id)}>
                  <Table.Cell className="whitespace-nowrap">
                    <span className="flex flex-col">
                      <span className="txt-compact-small tabular-nums text-ui-fg-base">{fmtDateTime(o.placed_at ?? o.created_at, lang)}</span>
                      <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{o.marketplace_order_id}</span>
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="flex flex-col items-start gap-1">
                      <span className="flex flex-wrap items-center gap-1">
                        <ImportBadge status={o.status} />
                        {o.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
                      </span>
                      {o.remote_status ? <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{t(`remoteOrderStatus.${o.remote_status}`, { defaultValue: o.remote_status })}</span> : null}
                      {o.returns_count > 0 ? <ToneBadge tone="blue">{t("orders.returns", { count: o.returns_count })}</ToneBadge> : null}
                      {o.claims_count > 0 ? <ToneBadge tone="orange">{t("orders.claims", { count: o.claims_count })}</ToneBadge> : null}
                    </span>
                  </Table.Cell>
                  <Table.Cell onClick={(e) => e.stopPropagation()}>
                    {o.order_id ? (
                      <KitOrderProductsCell data={products.data?.[o.order_id]} loading={products.isLoading} displayId={o.display_id} />
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {o.lines.map((l) => `${l.quantity} x ${l.title}`).join(", ")}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <span className="flex flex-col">
                      <span className="txt-compact-small text-ui-fg-base">{o.delivery_type ? t(`delivery.${o.delivery_type}`, { defaultValue: o.delivery_type }) : t("delivery.none")}</span>
                      {o.delivery_point ? <span className="txt-compact-xsmall font-mono text-ui-fg-subtle">{o.delivery_point}</span> : null}
                      {o.delivery ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("orders.deliveryPrice", { price: fmtMoney(o.delivery, o.currency_code, lang) })}</span> : null}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="flex flex-col">
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {o.payment_type === "CASH_ON_DELIVERY" ? t("payment.cod") : t("payment.paid")}
                      </Text>
                      {o.paid_at ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("orders.paidAt", { date: fmtDate(o.paid_at, lang) })}</span> : null}
                      {o.buyer_kind ? <span className="txt-compact-xsmall text-ui-fg-muted">{t(`buyerKind.${o.buyer_kind}`, { defaultValue: o.buyer_kind })}</span> : null}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">
                    <span className="flex flex-col items-end">
                      <span>{fmtMoney(o.total, o.currency_code, lang)}</span>
                      {o.refunded && Number(o.refunded) > 0 ? <span className="txt-compact-xsmall text-ui-tag-orange-text">{t("orders.refunded", { amount: fmtMoney(o.refunded, o.currency_code, lang) })}</span> : null}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="flex flex-col gap-y-0.5">
                      <TrackingBadge order={o} />
                      {o.tracking_numbers.length > 0 ? <span className="txt-compact-xsmall font-mono text-ui-fg-subtle">{o.tracking_numbers.join(", ")}</span> : null}
                      {o.shipped_at ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("orders.shippedAt", { date: fmtDate(o.shipped_at, lang) })}</span> : null}
                      {o.expected_delivery_at ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("orders.expectedAt", { date: fmtDate(o.expected_delivery_at, lang) })}</span> : null}
                    </span>
                  </Table.Cell>
                  <Table.Cell onClick={(e) => e.stopPropagation()}>
                    {o.order_id ? (
                      <Link to={`/orders/${o.order_id}`} className="txt-compact-small-plus inline-flex items-center gap-x-0.5 whitespace-nowrap text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                        {o.display_id !== null ? `#${o.display_id}` : t("actions.openOrder")}
                        <ArrowUpRightMini />
                      </Link>
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("orders.noOrder")}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <OrderActions order={o} status={s} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} onRefund={() => setRefund(o)} />
                  </Table.Cell>
                </Table.Row>
                {open === o.id ? (
                  <Table.Row>
                    <td colSpan={COLS} className="bg-ui-bg-subtle px-6 py-2">
                      <OrderDetails order={o} lang={lang} />
                    </td>
                  </Table.Row>
                ) : null}
              </Fragment>
            ))}
          </Table.Body>
        </Table>
      </div>
      {count > PAGE ? (
        <Table.Pagination
          count={count}
          pageSize={PAGE}
          pageIndex={Math.floor(offset / PAGE)}
          pageCount={Math.max(1, Math.ceil(count / PAGE))}
          canPreviousPage={offset > 0}
          canNextPage={offset + PAGE < count}
          previousPage={() => setOffset(Math.max(0, offset - PAGE))}
          nextPage={() => setOffset(offset + PAGE)}
          translations={{ of: t("pagination.of"), results: t("pagination.results"), pages: t("pagination.pages"), prev: t("pagination.prev"), next: t("pagination.next") }}
        />
      ) : null}
      {refund ? <RefundDrawer order={refund} lang={lang} onDone={() => setRefund(null)} /> : null}
    </Section>
  )
}

/** What a person can do with one marketplace order, each as a visible icon: the history, retry, ship (demo), check the parcel, refund, the Medusa order. */
function OrderActions({ order: o, status: s, open, onToggle, onRefund }: { order: MarketplaceOrderDto; status: StatusResponse; open: boolean; onToggle: () => void; onRefund: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const retry = useRetryOrder()
  const check = useCheckTracking()
  const ship = useDemoShip()
  const demo = s.mode === "demo"
  const onRetry = async () => {
    try {
      const r = await retry.mutateAsync(o.id)
      if (r.kind === "held") toast.warning(t("toast.held", { reason: r.order.error ?? "" }))
      else toast.success(r.kind === "already" ? t("toast.already") : t("toast.retried"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const onShip = async () => {
    try {
      await ship.mutateAsync(o.id)
      toast.success(t("toast.shipped"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const onCheck = async () => {
    try {
      const r = await check.mutateAsync(o.id)
      if (r.outcome === "linked") toast.success(t("toast.trackingLinked"))
      else if (r.outcome === "waiting") toast.warning(t("toast.trackingWaiting"))
      else toast.info(t("toast.trackingNone"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <RowActions
      actions={[
        { key: "history", label: open ? t("orders.hideEvents") : t("orders.events"), icon: <HistoryIcon />, onClick: onToggle },
        { key: "retry", label: t("actions.retry"), icon: <ArrowPath />, hidden: o.status === "imported", loading: retry.isPending, onClick: () => void onRetry() },
        { key: "ship", label: t("actions.ship"), icon: <TruckFast />, hidden: !(o.status === "imported" && demo && o.tracking_status === "none"), loading: ship.isPending, onClick: () => void onShip() },
        { key: "tracking", label: t("actions.checkParcel"), icon: <MagnifyingGlass />, hidden: o.status !== "imported", loading: check.isPending, onClick: () => void onCheck() },
        { key: "refund", label: t("actions.refund"), icon: <ArrowUturnLeft />, danger: true, hidden: s.mode === "off", onClick: onRefund },
        { key: "order", label: t("actions.openOrder"), icon: <ArrowUpRightOnBox />, href: o.order_id ? `/app/orders/${o.order_id}` : undefined, hidden: !o.order_id },
      ]}
    />
  )
}

function OrderDetails({ order: o, lang }: { order: MarketplaceOrderDto; lang: string }) {
  const { t } = useTranslation("vonhalsky")
  return (
    <div className="flex flex-col gap-y-3 py-2">
      {o.error ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {o.error}
        </Text>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact label={t("orders.placedAt")}>{fmtDateTime(o.placed_at, lang) || t("orders.unknown")}</Fact>
        <Fact label={t("orders.paidAtLabel")}>{fmtDateTime(o.paid_at, lang) || t("orders.unknown")}</Fact>
        <Fact label={t("orders.shippedAtLabel")}>{fmtDateTime(o.shipped_at, lang) || t("orders.notYet")}</Fact>
        <Fact label={t("orders.expectedAtLabel")}>{fmtDate(o.expected_delivery_at, lang) || t("orders.unknown")}</Fact>
      </div>
      <Text size="xsmall" className="max-w-3xl text-ui-fg-muted">
        {t(`trackingHint.${o.tracking_status}`)}
      </Text>
      <div className="flex flex-col gap-y-1">
        <Text size="xsmall" weight="plus" className="flex items-center gap-x-1.5 text-ui-fg-subtle">
          <TruckFast className="text-ui-fg-muted" />
          {t("orders.parcels")}
        </Text>
        {o.parcels.length === 0 ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("orders.noParcels")}
          </Text>
        ) : (
          <ul className="flex flex-col gap-y-0.5">
            {o.parcels.map((p) => (
              <li key={p.trackingNumber} className="flex flex-wrap items-baseline gap-x-2">
                <span className="txt-compact-xsmall font-mono text-ui-fg-base">{p.trackingNumber}</span>
                {p.status ? <ToneBadge tone="grey">{p.status}</ToneBadge> : null}
                {p.createdAt ? <span className="txt-compact-xsmall text-ui-fg-muted">{fmtDateTime(p.createdAt, lang)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Text size="xsmall" weight="plus" className="flex items-center gap-x-1.5 text-ui-fg-subtle">
        <HistoryIcon className="text-ui-fg-muted" />
        {t("orders.events")}
      </Text>
      <EventList events={o.events} lang={lang} />
    </div>
  )
}

/** A refund through the marketplace: an amount, or the whole order when left empty; asks before sending. Medusa's order is not changed. */
function RefundDrawer({ order: o, lang, onDone }: { order: MarketplaceOrderDto; lang: string; onDone: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const prompt = usePrompt()
  const refund = useRefundOrder()
  const [value, setValue] = useState("")
  const amount = value.trim() ? parseAmount(value) : null
  const valid = !value.trim() || (amount !== null && (o.total === null || Number(amount) <= Number(o.total)))
  const onSend = async () => {
    const ok = await prompt({
      title: t("confirm.refundTitle"),
      description: amount
        ? t("confirm.refundText", { amount: fmtMoney(amount, o.currency_code, lang), order: o.marketplace_order_id })
        : t("confirm.refundWholeText", { amount: fmtMoney(o.total, o.currency_code, lang), order: o.marketplace_order_id }),
      confirmText: t("actions.refund"),
      cancelText: t("actions.cancel"),
      variant: "danger",
    })
    if (!ok) return
    try {
      const r = await refund.mutateAsync({ id: o.id, amount })
      toast.success(t("toast.refundAsked", { status: r.status ?? "" }))
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <FormDrawer
      open
      onOpenChange={(open) => (open ? undefined : onDone())}
      title={t("refund.title", { order: o.marketplace_order_id })}
      description={t("refund.text")}
      confirmLabel={t("actions.refund")}
      onConfirm={() => void onSend()}
      loading={refund.isPending}
      disabled={!valid}
      danger
    >
      <div className="grid grid-cols-2 gap-3">
        <Fact label={t("orders.total")}>{fmtMoney(o.total, o.currency_code, lang)}</Fact>
        <Fact label={t("refund.already")}>{o.refunded && Number(o.refunded) > 0 ? fmtMoney(o.refunded, o.currency_code, lang) : t("refund.nothing")}</Fact>
      </div>
      <Field label={t("refund.amount")} hint={valid ? t("refund.amountHint") : t("refund.amountInvalid")}>
        <Input size="small" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={o.total ?? ""} />
      </Field>
    </FormDrawer>
  )
}
