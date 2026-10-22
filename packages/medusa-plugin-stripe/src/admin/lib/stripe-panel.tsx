import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import {
  ArrowUpRightOnBox,
  ArrowUturnLeft,
  BarsArrowDown,
  Buildings,
  Calendar,
  Cash,
  ChartBar,
  CheckCircle,
  Clock,
  CreditCard,
  CurrencyDollar,
  ExclamationCircle,
  GlobeEurope,
  ListBullet,
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  XCircle,
} from "@medusajs/icons"
import { InlineTip, Table, Text } from "@medusajs/ui"
import { KitSkeletonRows } from "./stripe-kit"
import { EmptyState, EmptyTableRow, FilterBar, FilterButton, FilterDivider, SearchInput, Section, StatTile, StatTiles, ToneBadge, useDebouncedValue, type Tone } from "./stripe-blocks"
import { KitOrderAmountLines, KitOrderProductsCell, useKitCartProducts, useKitOrderProducts } from "./stripe-order-products"
import type { MethodKey, MoneyDto, PaymentFilter, PaymentRowDto, PeriodStatsDto, StripeOverviewResponse } from "../../modules/stripe/lib/contract"
import { useStripePayments } from "./stripe-api"
import {
  DisputeDue,
  ExternalLink,
  Fact,
  MethodCell,
  OrderCell,
  PaymentStatusBadge,
  SampleBadge,
  declineText,
  fmtAgo,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtMoneyList,
  fmtNumber,
  fmtPercent,
  refundFailureText,
} from "./stripe-ui"
import { MethodIcon, MethodName } from "./stripe-method-icon"

/*
 * The Panel: the figures of a period, the methods, the payments next to
 * their orders, open disputes, recent refunds, the balance and the payouts.
 * Everything comes from one cached read of Stripe; nothing here writes.
 */

const PAGE_SIZE = 15
export const PAYMENT_FILTERS: PaymentFilter[] = ["all", "succeeded", "failed", "attention", "refunded", "disputed", "outside", "foreign"]
const METHOD_ORDER: MethodKey[] = ["blik", "card", "p24", "apple_pay", "google_pay", "link", "other"]

const pagination = (t: (k: string) => string) => ({
  of: t("pagination.of"),
  results: t("pagination.results"),
  pages: t("pagination.pages"),
  prev: t("pagination.prev"),
  next: t("pagination.next"),
})

/** The icon of each payments filter, next to its name and count. */
const FILTER_ICON: Record<PaymentFilter, ReactNode> = {
  all: <ListBullet />,
  succeeded: <CheckCircle />,
  failed: <XCircle />,
  attention: <ExclamationCircle />,
  refunded: <ArrowUturnLeft />,
  disputed: <ShieldCheck />,
  outside: <ArrowUpRightOnBox />,
  foreign: <GlobeEurope />,
}

/** Filters with something to do: their count turns orange while above zero. */
const ATTENTION: ReadonlySet<PaymentFilter> = new Set<PaymentFilter>(["failed", "attention", "disputed"])

/* ------------------------------------------------------------------ */
/* The figures of a period                                             */
/* ------------------------------------------------------------------ */

export type PeriodDays = 7 | 30

export function PeriodSwitch({ value, onChange }: { value: PeriodDays; onChange: (v: PeriodDays) => void }) {
  const { t } = useTranslation("stripe")
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("period.label")}>
      {([7, 30] as const).map((d) => (
        <FilterButton key={d} icon={<Calendar />} label={t(d === 7 ? "period.d7" : "period.d30")} active={value === d} onClick={() => onChange(d)} />
      ))}
    </div>
  )
}

/** The largest amount big, the other currencies small under it. */
function MoneyValue({ values, lang }: { values: PeriodStatsDto["volume"]; lang: string }) {
  if (values.length === 0) return <>0</>
  const [first, ...rest] = values
  return (
    <span className="flex flex-col">
      <span className="whitespace-nowrap">{fmtMoney(first, lang)}</span>
      {rest.length > 0 ? <span className="txt-compact-xsmall text-ui-fg-muted">{fmtMoneyList(rest, lang)}</span> : null}
    </span>
  )
}

export function feeRate(p: PeriodStatsDto): number | null {
  if (p.volume.length !== 1 || p.fees.length !== 1) return null
  const [v] = p.volume
  const [f] = p.fees
  return v.currency === f.currency && v.amount > 0 ? f.amount / v.amount : null
}

/** Where a tile leads: the payments list with a filter, or a section of the panel. */
export type TileTarget = { payments: PaymentFilter } | { section: "stripe-balance" | "stripe-refunds" | "stripe-disputes" }

export function PeriodTiles({ overview, days, lang, onOpen }: { overview: StripeOverviewResponse; days: PeriodDays; lang: string; onOpen: (target: TileTarget) => void }) {
  const { t } = useTranslation("stripe")
  const p = overview.periods.find((x) => x.days === days) ?? overview.periods[0]
  if (!p) return null
  const rate = feeRate(p)
  const respond = overview.disputes.filter((d) => d.urgency !== "waiting").length
  const urgent = overview.disputes.some((d) => d.urgency === "overdue" || d.urgency === "urgent")
  return (
    <div className="flex flex-col gap-y-3">
      <StatTiles columns={6} className="px-0 py-0">
        <StatTile label={t("stats.volume")} value={<MoneyValue values={p.volume} lang={lang} />} hint={t("stats.volumeHint", { n: fmtNumber(p.succeeded, lang) })} tone="green" onClick={() => onOpen({ payments: "succeeded" })} />
        <StatTile
          label={t("stats.fees")}
          value={<MoneyValue values={p.fees} lang={lang} />}
          hint={p.feesPending > 0 ? t("stats.feesPending", { count: p.feesPending }) : rate !== null ? t("stats.feesHint", { rate: fmtPercent(rate, lang, 2) }) : undefined}
          onClick={() => onOpen({ section: "stripe-balance" })}
        />
        <StatTile label={t("stats.net")} value={<MoneyValue values={p.net} lang={lang} />} hint={t("stats.netHint")} tone="green" onClick={() => onOpen({ section: "stripe-balance" })} />
        <StatTile
          label={t("stats.success")}
          value={p.successRate === null ? "0" : fmtPercent(p.successRate, lang, 1)}
          hint={p.successRate === null ? t("stats.successNone") : t("stats.successHint", { failed: p.failed, attempts: p.failed + p.succeeded })}
          tone={p.successRate === null ? "grey" : p.successRate >= 0.9 ? "green" : p.successRate >= 0.75 ? "orange" : "red"}
          onClick={() => onOpen({ payments: "failed" })}
        />
        <StatTile label={t("stats.refunds")} value={<MoneyValue values={p.refunded} lang={lang} />} hint={t("stats.refundsHint", { count: p.refunds })} tone={p.refunds > 0 ? "orange" : "grey"} onClick={() => onOpen({ section: "stripe-refunds" })} />
        <StatTile
          label={t("stats.disputes")}
          value={overview.disputes.length}
          hint={respond > 0 ? t("stats.disputesHint", { count: respond }) : t("stats.disputesNone")}
          tone={urgent ? "red" : overview.disputes.length > 0 ? "orange" : "grey"}
          onClick={() => onOpen(overview.disputes.length > 0 ? { section: "stripe-disputes" } : { payments: "disputed" })}
        />
      </StatTiles>
      {p.processing + p.authorized > 0 ? (
        <span className="flex flex-wrap items-center gap-1.5">
          {p.processing > 0 ? (
            <ToneBadge tone="blue" icon={<Clock />}>
              {t("stats.processing", { count: p.processing })}
            </ToneBadge>
          ) : null}
          {p.authorized > 0 ? (
            <ToneBadge tone="orange" icon={<CreditCard />}>
              {t("stats.authorized", { count: p.authorized })}
            </ToneBadge>
          ) : null}
        </span>
      ) : null}
      {p.partial ? (
        <InlineTip variant="warning" label={t(days === 7 ? "period.d7" : "period.d30")}>
          {t("period.partial", { count: overview.paymentsTotal })}
        </InlineTip>
      ) : null}
    </div>
  )
}

/** "Read from Stripe 3 minutes ago, kept for 5 min; Refresh reads again." */
export function Freshness({ overview, lang }: { overview: StripeOverviewResponse | undefined; lang: string }) {
  const { t } = useTranslation("stripe")
  if (!overview) return null
  if (!overview.fetchedAt) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("freshness.never")}
      </Text>
    )
  }
  const when = fmtAgo(overview.fetchedAt, lang)
  return (
    <Text size="xsmall" className="text-ui-fg-muted" title={fmtDateTime(overview.fetchedAt, lang)}>
      {overview.mode === "demo" ? t("freshness.demo", { when }) : t("freshness.read", { when })}
      {", "}
      {t("freshness.kept", { minutes: Math.max(1, Math.round(overview.cacheSeconds / 60)) })}
    </Text>
  )
}

/** Parts of the read that failed, with the permission Stripe asked for. */
export function ReadErrors({ overview }: { overview: StripeOverviewResponse | undefined }) {
  const { t } = useTranslation("stripe")
  const errors = overview?.errors ?? []
  if (errors.length === 0) return null
  return (
    <div className="px-6 py-4">
      <InlineTip variant="warning" label={t("errors.label")}>
        <span className="flex flex-col gap-y-1">
          {errors.map((e) => (
            <span key={e.section}>
              <span className="font-medium">{t(`errors.section.${e.section}`)}:</span> {e.message}
              {e.permission ? <span className="block">{t("errors.permission", { permission: e.permission })}</span> : null}
            </span>
          ))}
        </span>
      </InlineTip>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Methods                                                             */
/* ------------------------------------------------------------------ */

export function MethodsSection({ overview, days, lang }: { overview: StripeOverviewResponse; days: PeriodDays; lang: string }) {
  const { t } = useTranslation("stripe")
  const p = overview.periods.find((x) => x.days === days) ?? overview.periods[0]
  const rows = p?.methods ?? []
  return (
    <Section
      id="stripe-methods"
      icon={<CreditCard />}
      title={t("methods.title")}
      badges={
        <>
          <ToneBadge tone="grey">{t(days === 7 ? "period.d7" : "period.d30")}</ToneBadge>
          {overview.mode === "demo" ? <SampleBadge /> : null}
        </>
      }
      pointsLabel={t("methods.subtitle")}
      points={[
        { icon: <ChartBar />, text: t("methods.points.how") },
        { icon: <Receipt />, text: t("methods.points.fees") },
        { icon: <CurrencyDollar />, text: t("methods.points.currency") },
      ]}
    >
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("methods.col.method")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("methods.col.payments")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("methods.col.share")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("methods.col.volume")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("methods.col.fees")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("methods.col.net")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("methods.col.declined")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("methods.col.success")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyTableRow cols={8} icon={<CreditCard />} title={t("methods.empty")} />
            ) : (
              rows.map((m) => (
                <Table.Row key={m.method} className="[&_td]:py-2.5">
                  <Table.Cell>
                    <Text size="small" weight="plus">
                      <MethodName method={m.method} label={t(`methods.${m.method}`)} />
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtNumber(m.count, lang)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{p && p.succeeded > 0 ? fmtPercent(m.count / p.succeeded, lang, 0) : ""}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoneyList(m.volume, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums text-ui-fg-subtle">{fmtMoneyList(m.fees, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoneyList(m.net, lang)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{m.failed > 0 ? <span className="text-ui-tag-red-text">{m.failed}</span> : "0"}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{fmtPercent(m.successRate, lang, 0)}</Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

/**
 * Where a refund of this payment is made. With an order: in the order, so
 * Medusa, the stock and the invoices follow it (a refund made in Stripe alone
 * leaves the order paid in Medusa). Without one: in Stripe's dashboard. The
 * plugin itself never refunds; it only reads.
 */
function RefundLink({ payment: p }: { payment: PaymentRowDto }) {
  const { t } = useTranslation("stripe")
  const left = p.amount.amount - (p.refunded?.amount ?? 0)
  if (p.status !== "succeeded" || left <= 0) return null
  if (p.order) {
    return (
      <Link to={`/orders/${p.order.id}`} className="txt-compact-small inline-flex items-center gap-x-1 text-ui-fg-subtle hover:text-ui-fg-interactive" title={t("payments.refundInOrderHint")}>
        <ArrowUturnLeft className="shrink-0" />
        {t("payments.refundInOrder")}
      </Link>
    )
  }
  return (
    <a href={p.dashboardUrl} target="_blank" rel="noreferrer" className="txt-compact-small inline-flex items-center gap-x-1 text-ui-fg-subtle hover:text-ui-fg-interactive" title={t("payments.refundInStripeHint")}>
      <ArrowUturnLeft className="shrink-0" />
      {t("payments.refundInStripe")}
    </a>
  )
}

export function PaymentsSection({
  overview,
  lang,
  initialFilter = "all",
  initialQuery = "",
  focus,
}: {
  overview: StripeOverviewResponse
  lang: string
  /** From the page URL (?filter=, ?q=): the list a board counter or a host links to. */
  initialFilter?: PaymentFilter
  initialQuery?: string
  /** A tile asked for this list (at: when, so the same tile twice still applies). */
  focus?: { filter: PaymentFilter; at: number } | null
}) {
  const { t } = useTranslation("stripe")
  const [filter, setFilter] = useState<PaymentFilter>(initialFilter)
  useEffect(() => {
    if (focus) setFilter(focus.filter)
  }, [focus])
  const [method, setMethod] = useState<MethodKey | "all">("all")
  const [search, setSearch] = useState(initialQuery)
  const q = useDebouncedValue(search).trim()
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, method, q])
  const payments = useStripePayments(filter, method, q, page * PAGE_SIZE, PAGE_SIZE, overview.fetchedAt)
  const data = payments.data
  const rows = data?.payments ?? []
  const products = useKitOrderProducts(rows.map((p) => p.order?.id))
  /* No order (abandoned, failed, waiting): what was in the cart. */
  const carts = useKitCartProducts(rows.map((p) => (p.order ? null : p.cartId)), "/admin/stripe/carts")
  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const methods = useMemo(() => METHOD_ORDER.filter((m) => (data?.methods?.[m] ?? 0) > 0), [data?.methods])
  /* A second click on the active filter clears it. */
  const pickFilter = (f: PaymentFilter) => setFilter((cur) => (cur === f && f !== "all" ? "all" : f))
  const pickMethod = (m: MethodKey | "all") => setMethod((cur) => (cur === m && m !== "all" ? "all" : m))
  const shownFilters = PAYMENT_FILTERS.filter((f) => f !== "foreign" || filter === "foreign" || (data?.counts?.foreign ?? 0) > 0)

  return (
    <Section
      id="stripe-payments"
      icon={<Receipt />}
      title={t("payments.title")}
      badges={overview.mode === "demo" ? <SampleBadge /> : null}
      pointsLabel={t("payments.subtitle")}
      points={[
        { icon: <Clock />, text: t("payments.points.days") },
        { icon: <BarsArrowDown />, text: t("payments.points.newest") },
        { icon: <ShoppingBag />, text: t("payments.points.order") },
        { icon: <ArrowUpRightOnBox />, text: t("payments.points.dashboard") },
      ]}
      actions={<SearchInput value={search} onChange={setSearch} placeholder={t("payments.search")} className="sm:w-80" />}
    >
      <FilterBar>
        {shownFilters.map((f, i) => (
          <span key={f} className="contents">
            {i === 1 ? <FilterDivider /> : null}
            <FilterButton icon={FILTER_ICON[f]} label={t(`payments.filter.${f}`)} count={data?.counts?.[f]} attention={ATTENTION.has(f)} active={filter === f} onClick={() => pickFilter(f)} />
          </span>
        ))}
      </FilterBar>
      {methods.length > 1 || method !== "all" ? (
        <FilterBar>
          <FilterButton icon={<CreditCard />} label={t("payments.methodAll")} active={method === "all"} onClick={() => pickMethod("all")} />
          <FilterDivider />
          {methods.map((m) => (
            <FilterButton key={m} icon={<MethodIcon method={m} title={t(`methods.${m}`)} />} label={t(`methods.${m}`)} count={data?.methods?.[m]} active={method === m} onClick={() => pickMethod(m)} />
          ))}
        </FilterBar>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("payments.col.created")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("payments.col.amount")}</Table.HeaderCell>
              <Table.HeaderCell>{t("payments.col.method")}</Table.HeaderCell>
              <Table.HeaderCell>{t("payments.col.status")}</Table.HeaderCell>
              <Table.HeaderCell className="text-right">{t("payments.col.fee")}</Table.HeaderCell>
              <Table.HeaderCell>{t("payments.col.order")}</Table.HeaderCell>
              <Table.HeaderCell>{t("payments.col.products")}</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 && payments.isLoading ? (
              <KitSkeletonRows cols={8} rows={8} />
            ) : rows.length === 0 ? (
              <EmptyTableRow cols={8} icon={<Receipt />} title={overview.paymentsTotal === 0 ? t("payments.emptyRead") : t("payments.empty")} />
            ) : (
              rows.map((p) => (
                <Table.Row key={p.id} className="align-top [&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="txt-compact-small">{fmtDateTime(p.created, lang)}</span>
                      <span className="txt-compact-xsmall text-ui-fg-muted" title={t("payments.stripeIdHint")}>
                        {t("payments.stripeId")} <span className="font-mono">{p.id}</span>
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right">
                    <div className="flex flex-col items-end gap-y-1">
                      <span className="txt-compact-small-plus tabular-nums">{fmtMoney(p.amount, lang)}</span>
                      {p.order ? <KitOrderAmountLines data={products.data?.[p.order.id]} /> : null}
                      {p.refunded ? <ToneBadge tone="orange">{t("payments.refunded", { amount: fmtMoney(p.refunded, lang) })}</ToneBadge> : null}
                      {p.disputed ? <ToneBadge tone={p.disputeOpen ? "red" : "grey"}>{t("payments.disputed")}</ToneBadge> : null}
                      {p.refundFailed ? <ToneBadge tone="red">{t("payments.refundFailed")}</ToneBadge> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="max-w-[220px]">
                    <MethodCell method={p.method} detail={p.detail} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[260px]">
                    <div className="flex flex-col items-start gap-y-1">
                      <PaymentStatusBadge status={p.status} />
                      {p.failure && (p.failure.message || p.failure.code) ? (
                        <Text size="xsmall" className="text-ui-tag-red-text" title={[p.failure.code, p.failure.message].filter(Boolean).join(": ")}>
                          {declineText(t, p.failure)}
                        </Text>
                      ) : null}
                      {p.risk === "elevated" || p.risk === "highest" ? (
                        <ToneBadge tone={p.risk === "highest" ? "red" : "orange"}>{t(`payments.risk.${p.risk}`)}</ToneBadge>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right">
                    {p.fee ? (
                      <div className="flex flex-col items-end">
                        <span className="txt-compact-small tabular-nums text-ui-fg-subtle">{fmtMoney(p.fee, lang)}</span>
                        {p.net ? <span className="txt-compact-xsmall tabular-nums text-ui-fg-muted">{t("payments.net", { amount: fmtMoney(p.net, lang) })}</span> : null}
                      </div>
                    ) : p.status === "succeeded" ? (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {t("payments.feePending")}
                      </Text>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="max-w-[220px]">
                    <OrderCell order={p.order} payment={p} />
                  </Table.Cell>
                  <Table.Cell>
                    {p.order ? (
                      <KitOrderProductsCell data={products.data?.[p.order.id]} loading={products.isLoading} displayId={p.order.displayId} />
                    ) : p.cartId ? (
                      <div className="flex flex-col items-start gap-y-1">
                        <KitOrderProductsCell data={carts.data?.[p.cartId]} loading={carts.isLoading} />
                        {carts.data?.[p.cartId] ? <span className="txt-compact-xsmall text-ui-fg-muted">{t("payments.cartOnly")}</span> : null}
                      </div>
                    ) : null}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right">
                    <div className="flex flex-col items-end gap-y-1.5">
                      <ExternalLink href={p.dashboardUrl}>{t("actions.openStripe")}</ExternalLink>
                      <RefundLink payment={p} />
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            )}
          </Table.Body>
        </Table>
      </div>
      <Table.Pagination
        count={count}
        pageSize={PAGE_SIZE}
        pageIndex={page}
        pageCount={pageCount}
        canPreviousPage={page > 0}
        canNextPage={page + 1 < pageCount}
        previousPage={() => setPage((x) => Math.max(0, x - 1))}
        nextPage={() => setPage((x) => x + 1)}
        translations={pagination(t)}
      />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Disputes and refunds                                                */
/* ------------------------------------------------------------------ */

export function DisputesSection({ overview, lang }: { overview: StripeOverviewResponse; lang: string }) {
  const { t } = useTranslation("stripe")
  const rows = overview.disputes
  const closed = overview.disputesClosed
  return (
    <Section
      id="stripe-disputes"
      icon={<ShieldCheck />}
      title={t("disputes.title")}
      badges={overview.mode === "demo" ? <SampleBadge /> : null}
      pointsLabel={t("disputes.subtitle")}
      points={[
        { icon: <ExclamationCircle />, text: t("disputes.points.waiting"), tone: rows.length > 0 ? "orange" : "grey" },
        { icon: <ArrowUpRightOnBox />, text: t("disputes.points.answer") },
        { icon: <Clock />, text: t("disputes.points.deadline"), tone: rows.length > 0 ? "red" : "grey" },
        closed.won + closed.lost > 0 && { icon: <Trophy />, text: t("disputes.closed", closed) },
      ]}
    >
      {rows.length === 0 ? (
        <EmptyState compact icon={<ShieldCheck />} title={t("disputes.none")} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("disputes.col.created")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("disputes.col.amount")}</Table.HeaderCell>
                <Table.HeaderCell>{t("disputes.col.reason")}</Table.HeaderCell>
                <Table.HeaderCell>{t("disputes.col.status")}</Table.HeaderCell>
                <Table.HeaderCell>{t("disputes.col.due")}</Table.HeaderCell>
                <Table.HeaderCell>{t("disputes.col.order")}</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((d) => (
                <Table.Row key={d.id} className="align-top [&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap">{fmtDate(d.created, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right">
                    <div className="flex flex-col items-end">
                      <span className="txt-compact-small-plus tabular-nums">{fmtMoney(d.amount, lang)}</span>
                      {d.method ? <span className="txt-compact-xsmall text-ui-fg-muted"><MethodName method={d.method} label={t(`methods.${d.method}`)} /></span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{d.reason ? t(`disputes.reason.${d.reason}`, { defaultValue: d.reason }) : ""}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <ToneBadge tone={d.urgency === "waiting" ? "blue" : "orange"}>{t(`disputes.status.${d.status}`, { defaultValue: d.status })}</ToneBadge>
                      {d.hasEvidence ? (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {t("disputes.evidence")}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <DisputeDue dueBy={d.dueBy} daysLeft={d.daysLeft} urgency={d.urgency} lang={lang} />
                  </Table.Cell>
                  <Table.Cell className="max-w-[220px]">
                    <OrderCell order={d.order} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right">
                    <ExternalLink href={d.dashboardUrl}>{t("actions.openStripe")}</ExternalLink>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </Section>
  )
}

const REFUND_TONE: Record<string, Tone> = { succeeded: "green", pending: "blue", requires_action: "orange", failed: "red", canceled: "grey" }

export function RefundsSection({ overview, lang }: { overview: StripeOverviewResponse; lang: string }) {
  const { t } = useTranslation("stripe")
  const rows = overview.refunds
  return (
    <Section
      id="stripe-refunds"
      icon={<ArrowUturnLeft />}
      title={t("refunds.title")}
      badges={overview.mode === "demo" ? <SampleBadge /> : null}
      pointsLabel={t("refunds.subtitle")}
      points={[
        { icon: <Clock />, text: t("refunds.points.days") },
        { icon: <ArrowUturnLeft />, text: t("refunds.points.order") },
        { icon: <CheckCircle />, text: t("refunds.points.provider") },
      ]}
    >
      {rows.length === 0 ? (
        <EmptyState compact icon={<ArrowUturnLeft />} title={t("refunds.none")} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("refunds.col.created")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("refunds.col.amount")}</Table.HeaderCell>
                <Table.HeaderCell>{t("refunds.col.status")}</Table.HeaderCell>
                <Table.HeaderCell>{t("refunds.col.reason")}</Table.HeaderCell>
                <Table.HeaderCell>{t("refunds.col.order")}</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((r) => (
                <Table.Row key={r.id} className="align-top [&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap">{fmtDateTime(r.created, lang)}</Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(r.amount, lang)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <ToneBadge tone={REFUND_TONE[r.status] ?? "grey"}>{t(`refunds.status.${r.status}`, { defaultValue: r.status })}</ToneBadge>
                      {r.failureReason ? (
                        <Text size="xsmall" className="text-ui-tag-red-text" title={r.failureReason}>
                          {refundFailureText(t, r.failureReason)}
                        </Text>
                      ) : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{r.reason ? t(`refunds.reason.${r.reason}`, { defaultValue: r.reason }) : ""}</Table.Cell>
                  <Table.Cell className="max-w-[220px]">
                    <OrderCell order={r.order} />
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right">
                    <ExternalLink href={r.dashboardUrl}>{t("actions.openStripe")}</ExternalLink>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* Balance and payouts                                                 */
/* ------------------------------------------------------------------ */

const PAYOUT_TONE: Record<string, Tone> = { paid: "green", pending: "blue", in_transit: "blue", canceled: "grey", failed: "red" }

/** Stripe lists every currency the account used; one with nothing in it is left out, unless the balance is empty altogether. */
function held(list: readonly MoneyDto[]): MoneyDto[] {
  const some = list.filter((m) => m.amount !== 0)
  return some.length > 0 ? some : list.slice(0, 1)
}

export function BalanceSection({ overview, lang }: { overview: StripeOverviewResponse; lang: string }) {
  const { t } = useTranslation("stripe")
  const b = overview.balance
  const { upcoming, past } = overview.payouts
  const payoutRows = (list: typeof past, empty: string) =>
    list.length === 0 ? (
      <EmptyTableRow cols={5} icon={<Buildings />} title={empty} />
    ) : (
      list.slice(0, 10).map((p) => (
        <Table.Row key={p.id} className="[&_td]:py-2.5">
          <Table.Cell className="whitespace-nowrap">{fmtDate(p.arrivalDate ?? p.created, lang)}</Table.Cell>
          <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(p.amount, lang)}</Table.Cell>
          <Table.Cell>
            <div className="flex flex-col items-start gap-y-1">
              <ToneBadge tone={PAYOUT_TONE[p.status] ?? "grey"}>{t(`balance.status.${p.status}`, { defaultValue: p.status })}</ToneBadge>
              {p.failureMessage ? (
                <Text size="xsmall" className="text-ui-tag-red-text">
                  {p.failureMessage}
                </Text>
              ) : null}
            </div>
          </Table.Cell>
          <Table.Cell>{p.method ? t(`balance.method.${p.method}`, { defaultValue: p.method }) : ""}</Table.Cell>
          <Table.Cell className="whitespace-nowrap text-right">
            <ExternalLink href={p.dashboardUrl}>{t("actions.openStripe")}</ExternalLink>
          </Table.Cell>
        </Table.Row>
      ))
    )
  const header = (
    <Table.Header>
      <Table.Row>
        <Table.HeaderCell>{t("balance.col.arrival")}</Table.HeaderCell>
        <Table.HeaderCell className="text-right">{t("balance.col.amount")}</Table.HeaderCell>
        <Table.HeaderCell>{t("balance.col.status")}</Table.HeaderCell>
        <Table.HeaderCell>{t("balance.col.method")}</Table.HeaderCell>
        <Table.HeaderCell />
      </Table.Row>
    </Table.Header>
  )
  return (
    <Section
      id="stripe-balance"
      icon={<Cash />}
      title={t("balance.title")}
      badges={overview.mode === "demo" ? <SampleBadge /> : null}
      pointsLabel={t("balance.subtitle")}
      points={[
        { icon: <Cash />, text: t("balance.points.held") },
        { icon: <Buildings />, text: t("balance.points.bank") },
      ]}
    >
      <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-2">
        {b ? (
          <>
            <Fact label={t("balance.available")}>
              <span className="txt-large-plus tabular-nums">{fmtMoneyList(held(b.available), lang, "0")}</span>
            </Fact>
            <Fact label={t("balance.pending")}>
              <span className="txt-large-plus tabular-nums text-ui-fg-subtle">{fmtMoneyList(held(b.pending), lang, "0")}</span>
            </Fact>
          </>
        ) : (
          <EmptyState compact icon={<Cash />} title={t("balance.none")} className="sm:col-span-2" />
        )}
      </div>
      <div className="flex flex-col">
        <div className="px-6 pb-1 pt-4">
          <Text size="small" weight="plus">
            {t("balance.upcoming")}
          </Text>
        </div>
        <div className="overflow-x-auto">
          <Table>
            {header}
            <Table.Body>{payoutRows(upcoming, t("balance.noUpcoming"))}</Table.Body>
          </Table>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="px-6 pb-1 pt-4">
          <Text size="small" weight="plus">
            {t("balance.past")}
          </Text>
        </div>
        <div className="overflow-x-auto">
          <Table>
            {header}
            <Table.Body>{payoutRows(past, t("balance.noPast"))}</Table.Body>
          </Table>
        </div>
      </div>
    </Section>
  )
}

/** The demo note, in the mode badge's popover. */
export function DemoDetails() {
  const { t } = useTranslation("stripe")
  return (
    <>
      <p>{t("demo.text")}</p>
      <p>{t("demo.details")}</p>
      <p>{t("demo.off")}</p>
    </>
  )
}
