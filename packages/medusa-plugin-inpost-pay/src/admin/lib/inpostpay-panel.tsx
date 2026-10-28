import { Fragment, useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  ArrowUpRightMini,
  ArrowUpRightOnBox,
  CheckCircle,
  Clock,
  CreditCard,
  CursorArrowRays,
  ExclamationCircle,
  History as HistoryIcon,
  ListBullet,
  MinusCircle,
  Phone,
  ShoppingCart,
  XCircle,
} from "@medusajs/icons"
import { Table, Text } from "@medusajs/ui"
import type { BasketDto, BasketFilter, StatusResponse } from "../../modules/inpostpay/lib/contract"
import { useInpostPayBaskets } from "./inpostpay-api"
import { EmptyTableRow, FilterBar, FilterButton, FilterDivider, RowActions, SearchInput, Section, ToneBadge, useDebouncedValue } from "./inpostpay-blocks"
import { KitFetchingBar, KitSkeletonRows } from "./inpostpay-kit"
import { KitOrderProductsCell, useKitCartProducts, useKitOrderProducts } from "./inpostpay-order-products"
import { BasketStatusBadge, EventList, PaymentBadge, fmtDateTime, fmtMoney } from "./inpostpay-ui"

export const FILTERS: BasketFilter[] = ["all", "created", "linked", "ordered", "rejected", "failed", "unbound", "payment_problems"]
const PAGE = 20

const FILTER_ICON: Record<BasketFilter, ReactNode> = {
  all: <ListBullet />,
  created: <Clock />,
  linked: <Phone />,
  ordered: <CheckCircle />,
  rejected: <XCircle />,
  failed: <ExclamationCircle />,
  unbound: <MinusCircle />,
  payment_problems: <CreditCard />,
}

/** The groups of the filter bar: everything, the way of a basket, what needs a person, what left. */
const FILTER_GROUPS: BasketFilter[][] = [["all"], ["created", "linked", "ordered"], ["failed", "payment_problems"], ["rejected", "unbound"]]
const ATTENTION: BasketFilter[] = ["failed", "payment_problems"]

/** The counts the status gives (the others have none). */
function filterCount(s: StatusResponse, f: BasketFilter): number | undefined {
  if (f === "all") return s.counts.baskets
  if (f === "linked") return s.counts.linked
  if (f === "ordered") return s.counts.orders
  if (f === "failed") return s.counts.failed
  if (f === "payment_problems") return s.counts.payment_problems
  return undefined
}

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
export function BasketsSection({ status, lang, filter, onFilter, initialQuery }: { status: StatusResponse; lang: string; filter: BasketFilter; onFilter: (f: BasketFilter) => void; initialQuery: string }) {
  const { t } = useTranslation("inpostpay")
  const [input, setInput] = useState(initialQuery)
  const q = useDebouncedValue(input.trim())
  const [offset, setOffset] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => setOffset(0), [filter, q])

  const list = useInpostPayBaskets(filter, q, offset, PAGE)
  const rows = list.data?.baskets ?? []
  const orders = useKitOrderProducts(rows.map((r) => r.order_id))
  const carts = useKitCartProducts(rows.filter((r) => !r.order_id).map((r) => r.cart_id), "/admin/inpostpay/carts")
  const count = list.data?.count ?? 0
  const pageIndex = Math.floor(offset / PAGE)
  const pageCount = Math.max(1, Math.ceil(count / PAGE))
  /* A second click on the active filter clears it. */
  const pick = (f: BasketFilter) => onFilter(filter === f ? "all" : f)
  const fresh = filter === "all" && !q

  return (
    <Section
      id="inpostpay-baskets"
      icon={<ShoppingCart />}
      title={t("table.title")}
      pointsLabel={t("table.subtitle")}
      points={[
        { icon: <CursorArrowRays />, text: t("table.points.where") },
        { icon: <Phone />, text: t("table.points.app") },
        { icon: <CreditCard />, text: t("table.points.payment") },
      ]}
      actions={<SearchInput value={input} onChange={setInput} placeholder={t("table.search")} className="sm:w-72" />}
    >
      <FilterBar>
        {FILTER_GROUPS.map((group, i) => (
          <span key={group.join()} className="contents">
            {i > 0 ? <FilterDivider /> : null}
            {group.map((f) => (
              <FilterButton key={f} icon={FILTER_ICON[f]} label={t(`filter.${f}`)} count={filterCount(status, f)} attention={ATTENTION.includes(f)} active={filter === f} onClick={() => pick(f)} />
            ))}
          </span>
        ))}
      </FilterBar>
      <KitFetchingBar active={list.isFetching && !list.isLoading} />
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
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {list.isLoading ? <KitSkeletonRows cols={9} rows={5} /> : null}
            {!list.isLoading && rows.length === 0 ? (
              <EmptyTableRow
                cols={9}
                icon={FILTER_ICON[filter]}
                title={fresh ? t("table.empty") : t("table.emptyFiltered")}
                points={fresh ? [{ icon: <CursorArrowRays />, text: t("table.emptyHint") }] : undefined}
              />
            ) : null}
            {rows.map((b) => (
              <Fragment key={b.id}>
                <Table.Row className="cursor-pointer [&_td]:py-2.5 align-top" onClick={() => setOpen(open === b.id ? null : b.id)}>
                  <Table.Cell className="whitespace-nowrap">
                    <span className="flex flex-col">
                      <span className="txt-compact-small tabular-nums text-ui-fg-base">{fmtDateTime(b.created_at, lang)}</span>
                      <span className="txt-compact-xsmall text-ui-fg-muted">{b.binding_place ? t(`place.${b.binding_place}`, { defaultValue: b.binding_place }) : " "}</span>
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="flex flex-wrap items-center gap-1">
                      <BasketStatusBadge basket={b} />
                      {b.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
                    </span>
                  </Table.Cell>
                  <Table.Cell onClick={(e) => e.stopPropagation()}>
                    <KitOrderProductsCell data={b.order_id ? orders.data?.[b.order_id] : carts.data?.[b.cart_id]} loading={b.order_id ? orders.isLoading : carts.isLoading} displayId={b.display_id} />
                  </Table.Cell>
                  <Table.Cell className="font-mono txt-compact-small">{b.masked_phone ?? " "}</Table.Cell>
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
                  <Table.Cell className="text-right">
                    <RowActions
                      actions={[
                        { key: "history", label: open === b.id ? t("table.hideEvents") : t("table.showEvents", { count: b.events.length }), icon: <HistoryIcon />, onClick: () => setOpen(open === b.id ? null : b.id) },
                        { key: "order", label: t("table.openOrder"), icon: <ArrowUpRightOnBox />, href: b.order_id ? `/app/orders/${b.order_id}` : undefined, hidden: !b.order_id },
                      ]}
                    />
                  </Table.Cell>
                </Table.Row>
                {open === b.id ? (
                  <Table.Row>
                    <td colSpan={9} className="bg-ui-bg-subtle px-6 py-2">
                      <BasketDetails basket={b} lang={lang} />
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
          pageIndex={pageIndex}
          pageCount={pageCount}
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
