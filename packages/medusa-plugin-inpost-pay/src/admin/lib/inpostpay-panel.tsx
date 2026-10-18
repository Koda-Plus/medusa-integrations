import { Fragment, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightMini, MagnifyingGlass } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Table, Text } from "@medusajs/ui"
import type { BasketDto, BasketFilter, StatusResponse } from "../../modules/inpostpay/lib/contract"
import { useInpostPayBaskets } from "./inpostpay-api"
import { KitLoading } from "./inpostpay-kit"
import { KitOrderProductsCell, useKitCartProducts, useKitOrderProducts } from "./inpostpay-order-products"
import { BasketStatusBadge, Chip, EventList, PaymentBadge, fmtDateTime, fmtMoney } from "./inpostpay-ui"

export const FILTERS: BasketFilter[] = ["all", "created", "linked", "ordered", "rejected", "failed", "unbound", "payment_problems"]
const PAGE = 20

/** The demo note inside the mode badge. */
export function DemoDetails() {
  const { t } = useTranslation("inpostpay")
  return (
    <>
      <p>{t("demo.text")}</p>
      <p>{t("demo.how")}</p>
      <p>{t("demo.samples")}</p>
    </>
  )
}

/** The baskets and the orders they became, with filters, search and the products of each. */
export function BasketsSection({ lang, filter, onFilter, initialQuery }: { status: StatusResponse; lang: string; filter: BasketFilter; onFilter: (f: BasketFilter) => void; initialQuery: string }) {
  const { t } = useTranslation("inpostpay")
  const [input, setInput] = useState(initialQuery)
  const [q, setQ] = useState(initialQuery)
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => setOffset(0), [filter, q])
  useEffect(() => {
    const id = setTimeout(() => setQ(input.trim()), 300)
    return () => clearTimeout(id)
  }, [input])

  const list = useInpostPayBaskets(filter, q, offset, PAGE)
  const rows = list.data?.baskets ?? []
  const orders = useKitOrderProducts(rows.map((r) => r.order_id))
  const carts = useKitCartProducts(rows.filter((r) => !r.order_id).map((r) => r.cart_id), "/admin/inpostpay/carts")
  const count = list.data?.count ?? 0

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{t("table.title")}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("table.subtitle")}
        </Text>
      </div>
      <div className="flex flex-col gap-3 px-6 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Chip key={f} active={filter === f} label={t(`filter.${f}`)} onClick={() => onFilter(f)} />
          ))}
        </div>
        <div className="relative w-full md:w-72">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ui-fg-muted">
            <MagnifyingGlass />
          </span>
          <Input size="small" className="pl-8" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("table.search")} />
        </div>
      </div>
      {list.isLoading ? (
        <KitLoading label={t("widget.loading")} />
      ) : rows.length === 0 ? (
        <Text size="small" className="px-6 py-6 text-ui-fg-subtle">
          {t("table.empty")}
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("table.when")}</Table.HeaderCell>
                <Table.HeaderCell>{t("table.status")}</Table.HeaderCell>
                <Table.HeaderCell>{t("table.products")}</Table.HeaderCell>
                <Table.HeaderCell>{t("table.phone")}</Table.HeaderCell>
                <Table.HeaderCell>{t("table.delivery")}</Table.HeaderCell>
                <Table.HeaderCell>{t("table.payment")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("table.total")}</Table.HeaderCell>
                <Table.HeaderCell>{t("table.order")}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((b) => (
                <Fragment key={b.id}>
                  <Table.Row className="cursor-pointer" onClick={() => setOpen(open === b.id ? null : b.id)}>
                    <Table.Cell className="whitespace-nowrap">
                      <span className="flex flex-col">
                        <span className="txt-compact-small tabular-nums text-ui-fg-base">{fmtDateTime(b.created_at, lang)}</span>
                        <span className="txt-compact-xsmall text-ui-fg-muted">{b.binding_place ? t(`place.${b.binding_place}`, { defaultValue: b.binding_place }) : " "}</span>
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <span className="flex flex-wrap items-center gap-1">
                        <BasketStatusBadge basket={b} />
                        {b.demo ? (
                          <Badge size="2xsmall" color="purple">
                            {t("demo.badge")}
                          </Badge>
                        ) : null}
                      </span>
                    </Table.Cell>
                    <Table.Cell onClick={(e) => e.stopPropagation()}>
                      <KitOrderProductsCell data={b.order_id ? orders.data?.[b.order_id] : carts.data?.[b.cart_id]} loading={b.order_id ? orders.isLoading : carts.isLoading} displayId={b.display_id} />
                    </Table.Cell>
                    <Table.Cell className="font-mono txt-compact-small">{b.masked_phone ?? " "}</Table.Cell>
                    <Table.Cell>
                      <span className="flex flex-col">
                        <span className="txt-compact-small text-ui-fg-base">{b.delivery_type ? t(`delivery.${b.delivery_type}`) : t("delivery.none")}</span>
                        {b.delivery_point ? <span className="txt-compact-xsmall font-mono text-ui-fg-subtle">{b.delivery_point}</span> : null}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      <PaymentBadge status={b.payment_status} />
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(b.total, b.currency_code, lang)}</Table.Cell>
                    <Table.Cell onClick={(e) => e.stopPropagation()}>
                      {b.order_id ? (
                        <Link to={`/orders/${b.order_id}`} className="txt-compact-small-plus inline-flex items-center gap-x-0.5 whitespace-nowrap text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                          {b.display_id !== null ? `#${b.display_id}` : t("table.openOrder")}
                          <ArrowUpRightMini />
                        </Link>
                      ) : (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("table.noOrder")}
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                  {open === b.id ? (
                    <Table.Row>
                      <td colSpan={8} className="bg-ui-bg-subtle px-6 py-2">
                        <BasketDetails basket={b} lang={lang} />
                      </td>
                    </Table.Row>
                  ) : null}
                </Fragment>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
      {count > PAGE ? (
        <div className="flex items-center justify-between px-6 py-3">
          <Text size="small" className="tabular-nums text-ui-fg-subtle">
            {offset + 1}-{Math.min(offset + PAGE, count)} / {count}
          </Text>
          <div className="flex gap-2">
            <Button size="small" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              &lt;
            </Button>
            <Button size="small" variant="secondary" disabled={offset + PAGE >= count} onClick={() => setOffset(offset + PAGE)}>
              &gt;
            </Button>
          </div>
        </div>
      ) : null}
    </Container>
  )
}

function BasketDetails({ basket: b, lang }: { basket: BasketDto; lang: string }) {
  const { t } = useTranslation("inpostpay")
  return (
    <div className="flex flex-col gap-y-3 py-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <Text size="xsmall" className="font-mono text-ui-fg-muted">
          {b.id}
        </Text>
        <Text size="xsmall" className="font-mono text-ui-fg-muted">
          {b.cart_id}
        </Text>
        {b.payment_type ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {b.payment_type}
          </Text>
        ) : null}
        {b.order_status ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {b.order_status}
          </Text>
        ) : null}
      </div>
      {b.error ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {t("table.error")}: {b.error}
        </Text>
      ) : null}
      <EventList events={b.events} lang={lang} />
    </div>
  )
}
