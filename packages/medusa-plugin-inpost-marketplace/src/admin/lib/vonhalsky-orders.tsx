import { Fragment, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightMini, MagnifyingGlass } from "@medusajs/icons"
import { Badge, Button, Input, Table, Text, toast } from "@medusajs/ui"
import type { MarketplaceOrderDto, OrderFilter, StatusResponse } from "../../modules/vonhalsky/lib/contract"
import { errorMessage, useDemoShip, useResendTracking, useRetryOrder, useVonHalskyOrders } from "./vonhalsky-api"
import { KitLoading } from "./vonhalsky-kit"
import { KitOrderProductsCell, useKitOrderProducts } from "./vonhalsky-order-products"
import { Chip, EventList, ImportBadge, Pager, Section, TrackingBadge, fmtDateTime, fmtMoney } from "./vonhalsky-ui"

export const ORDER_FILTERS: OrderFilter[] = ["all", "awaiting_shipment", "tracking_sent", "held", "errors"]
const PAGE = 50

/** The marketplace orders with the Medusa orders they became: products, delivery, payment, tracking and the actions of each. */
export function OrdersSection({ status: s, lang, filter, onFilter, initialQuery }: { status: StatusResponse; lang: string; filter: OrderFilter; onFilter: (f: OrderFilter) => void; initialQuery: string }) {
  const { t } = useTranslation("vonhalsky")
  const [input, setInput] = useState(initialQuery)
  const [q, setQ] = useState(initialQuery)
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => setOffset(0), [filter, q])
  useEffect(() => {
    const id = setTimeout(() => setQ(input.trim()), 300)
    return () => clearTimeout(id)
  }, [input])

  const list = useVonHalskyOrders(filter, q, offset, PAGE)
  const rows = list.data?.orders ?? []
  const products = useKitOrderProducts(rows.map((r) => r.order_id))

  return (
    <Section title={t("orders.title")} subtitle={t("orders.subtitle")}>
      <div className="flex flex-col gap-3 px-6 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {ORDER_FILTERS.map((f) => (
            <Chip key={f} active={filter === f} label={t(`orderFilter.${f}`)} onClick={() => onFilter(f)} />
          ))}
        </div>
        <div className="relative w-full md:w-72">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ui-fg-muted">
            <MagnifyingGlass />
          </span>
          <Input size="small" className="pl-8" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("orders.search")} />
        </div>
      </div>
      {list.isLoading ? (
        <KitLoading label={t("widget.loading")} />
      ) : rows.length === 0 ? (
        <Text size="small" className="px-6 py-6 text-ui-fg-subtle">
          {s.mode === "demo" ? t("orders.emptyDemo") : t("orders.empty")}
        </Text>
      ) : (
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
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((o) => (
                <Fragment key={o.id}>
                  <Table.Row className="cursor-pointer" onClick={() => setOpen(open === o.id ? null : o.id)}>
                    <Table.Cell className="whitespace-nowrap">
                      <span className="flex flex-col">
                        <span className="txt-compact-small tabular-nums text-ui-fg-base">{fmtDateTime(o.created_at, lang)}</span>
                        <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{o.marketplace_order_id}</span>
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="flex flex-wrap items-center gap-1">
                        <ImportBadge status={o.status} />
                        {o.demo ? (
                          <Badge size="2xsmall" color="purple">
                            {t("demo.badge")}
                          </Badge>
                        ) : null}
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
                  </Table.Row>
                  {open === o.id ? (
                    <Table.Row>
                      <td colSpan={8} className="bg-ui-bg-subtle px-6 py-2">
                        <OrderDetails order={o} lang={lang} demo={s.mode === "demo"} />
                      </td>
                    </Table.Row>
                  ) : null}
                </Fragment>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
      <Pager offset={offset} page={PAGE} count={list.data?.count ?? 0} onChange={setOffset} />
    </Section>
  )
}

function OrderDetails({ order: o, lang, demo }: { order: MarketplaceOrderDto; lang: string; demo: boolean }) {
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
    <div className="flex flex-col gap-y-3 py-2">
      <div className="flex flex-wrap gap-2">
        {o.status !== "imported" ? (
          <Button size="small" variant="secondary" isLoading={retry.isPending} onClick={() => void run(() => retry.mutateAsync(o.id), (r) => (r.kind === "held" ? t("toast.held", { reason: r.order.error ?? "" }) : t("toast.already")))}>
            {t("actions.retry")}
          </Button>
        ) : null}
        {o.status === "imported" && demo && o.tracking_status !== "sent" ? (
          <Button size="small" variant="secondary" isLoading={ship.isPending} onClick={() => void run(() => ship.mutateAsync(o.id), () => t("toast.shipped"))}>
            {t("actions.ship")}
          </Button>
        ) : null}
        {o.status === "imported" ? (
          <Button size="small" variant="secondary" isLoading={resend.isPending} onClick={() => void run(() => resend.mutateAsync(o.id), (r) => t("toast.tracking", { outcome: r.outcome }))}>
            {t("actions.resendTracking")}
          </Button>
        ) : null}
      </div>
      {o.error ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {o.error}
        </Text>
      ) : null}
      <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
        {t("orders.events")}
      </Text>
      <EventList events={o.events} lang={lang} />
    </div>
  )
}
