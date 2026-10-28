import { Fragment, useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  ArrowPath,
  ArrowUpRightMini,
  ArrowUpRightOnBox,
  CheckCircle,
  Clock,
  CreditCard,
  ExclamationCircle,
  History as HistoryIcon,
  ListBullet,
  PaperPlane,
  ShoppingCart,
  TruckFast,
  XCircle,
} from "@medusajs/icons"
import { Table, Text, toast } from "@medusajs/ui"
import type { MarketplaceOrderDto, OrderFilter, StatusResponse } from "../../modules/vonhalsky/lib/contract"
import { errorMessage, useDemoShip, useResendTracking, useRetryOrder, useVonHalskyOrders } from "./vonhalsky-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue } from "./vonhalsky-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./vonhalsky-kit"
import { KitOrderProductsCell, useKitOrderProducts } from "./vonhalsky-order-products"
import { EventList, ImportBadge, TrackingBadge, fmtDateTime, fmtMoney } from "./vonhalsky-ui"

export const ORDER_FILTERS: OrderFilter[] = ["all", "awaiting_shipment", "tracking_sent", "held", "errors"]
const PAGE = 50

const FILTER_ICON: Record<OrderFilter, ReactNode> = {
  all: <ListBullet />,
  awaiting_shipment: <Clock />,
  tracking_sent: <CheckCircle />,
  held: <ExclamationCircle />,
  errors: <XCircle />,
}
const FILTER_GROUPS: OrderFilter[][] = [["all"], ["awaiting_shipment", "tracking_sent"], ["held", "errors"]]
const ATTENTION: OrderFilter[] = ["held", "errors"]

function filterCount(s: StatusResponse, f: OrderFilter): number {
  return f === "all" ? s.counts.orders : s.counts[f]
}

/** The marketplace orders with the Medusa orders they became: products, delivery, payment, tracking and the actions of each. */
export function OrdersSection({ status: s, lang, filter, onFilter, initialQuery }: { status: StatusResponse; lang: string; filter: OrderFilter; onFilter: (f: OrderFilter) => void; initialQuery: string }) {
  const { t } = useTranslation("vonhalsky")
  const [input, setInput] = useState(initialQuery)
  const q = useDebouncedValue(input.trim())
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
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
            {list.isLoading ? <KitSkeletonRows cols={9} rows={5} /> : null}
            {!list.isLoading && rows.length === 0 ? (
              <EmptyTableRow
                cols={9}
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
                      <span className="txt-compact-small tabular-nums text-ui-fg-base">{fmtDateTime(o.created_at, lang)}</span>
                      <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{o.marketplace_order_id}</span>
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="flex flex-wrap items-center gap-1">
                      <ImportBadge status={o.status} />
                      {o.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
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
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {o.payment_type === "CASH_ON_DELIVERY" ? t("payment.cod") : t("payment.paid")}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(o.total, o.currency_code, lang)}</Table.Cell>
                  <Table.Cell>
                    <span className="flex flex-col gap-y-0.5">
                      <TrackingBadge order={o} />
                      {o.tracking_numbers.length > 0 ? <span className="txt-compact-xsmall font-mono text-ui-fg-subtle">{o.tracking_numbers.join(", ")}</span> : null}
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
                    <OrderActions order={o} demo={s.mode === "demo"} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} />
                  </Table.Cell>
                </Table.Row>
                {open === o.id ? (
                  <Table.Row>
                    <td colSpan={9} className="bg-ui-bg-subtle px-6 py-2">
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
    </Section>
  )
}

/** What a person can do with one marketplace order, each as a visible icon: the history, retry, ship (demo), tracking again, the Medusa order. */
function OrderActions({ order: o, demo, open, onToggle }: { order: MarketplaceOrderDto; demo: boolean; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation("vonhalsky")
  const retry = useRetryOrder()
  const resend = useResendTracking()
  const ship = useDemoShip()
  const run = async (fn: () => Promise<unknown>, ok: (r: any) => string) => {
    try {
      const r = await fn()
      toast.success(ok(r))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <RowActions
      actions={[
        { key: "history", label: open ? t("orders.hideEvents") : t("orders.events"), icon: <HistoryIcon />, onClick: onToggle },
        {
          key: "retry",
          label: t("actions.retry"),
          icon: <ArrowPath />,
          hidden: o.status === "imported",
          loading: retry.isPending,
          onClick: () => void run(() => retry.mutateAsync(o.id), (r) => (r.kind === "held" ? t("toast.held", { reason: r.order.error ?? "" }) : t("toast.already"))),
        },
        {
          key: "ship",
          label: t("actions.ship"),
          icon: <TruckFast />,
          hidden: !(o.status === "imported" && demo && o.tracking_status !== "sent"),
          loading: ship.isPending,
          onClick: () => void run(() => ship.mutateAsync(o.id), () => t("toast.shipped")),
        },
        {
          key: "tracking",
          label: t("actions.resendTracking"),
          icon: <PaperPlane />,
          hidden: o.status !== "imported",
          loading: resend.isPending,
          onClick: () => void run(() => resend.mutateAsync(o.id), (r) => t("toast.tracking", { outcome: r.outcome })),
        },
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
      <Text size="xsmall" weight="plus" className="flex items-center gap-x-1.5 text-ui-fg-subtle">
        <HistoryIcon className="text-ui-fg-muted" />
        {t("orders.events")}
      </Text>
      <EventList events={o.events} lang={lang} />
    </div>
  )
}
