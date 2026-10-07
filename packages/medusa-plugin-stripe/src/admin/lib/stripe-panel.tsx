import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Container, Heading, InlineTip, Input, Table, Text } from "@medusajs/ui"
import type { MethodKey, MoneyDto, PaymentFilter, PeriodStatsDto, StripeOverviewResponse } from "../../modules/stripe/lib/contract"
import { useStripePayments } from "./stripe-api"
import {
  DisputeDue,
  ExternalLink,
  Fact,
  FilterPills,
  MethodCell,
  OrderCell,
  PaymentStatusBadge,
  SampleBadge,
  StatTile,
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

function useDebounced(value: string, ms = 300): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <Table.Row>
      <td colSpan={cols} className="px-6 py-6 text-center">
        <Text size="small" className="text-ui-fg-muted">
          {text}
        </Text>
      </td>
    </Table.Row>
  )
}

/* ------------------------------------------------------------------ */
/* The figures of a period                                             */
/* ------------------------------------------------------------------ */

export type PeriodDays = 7 | 30

export function PeriodSwitch({ value, onChange }: { value: PeriodDays; onChange: (v: PeriodDays) => void }) {
  const { t } = useTranslation("stripe")
  return (
    <FilterPills<"7" | "30">
      value={String(value) as "7" | "30"}
      onChange={(v) => onChange(Number(v) as PeriodDays)}
      options={[
        { value: "7", label: t("period.d7") },
        { value: "30", label: t("period.d30") },
      ]}
    />
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

export function PeriodTiles({ overview, days, lang, onDisputes }: { overview: StripeOverviewResponse; days: PeriodDays; lang: string; onDisputes: () => void }) {
  const { t } = useTranslation("stripe")
  const p = overview.periods.find((x) => x.days === days) ?? overview.periods[0]
  if (!p) return null
  const rate = feeRate(p)
  const respond = overview.disputes.filter((d) => d.urgency !== "waiting").length
  const urgent = overview.disputes.some((d) => d.urgency === "overdue" || d.urgency === "urgent")
  return (
    <div className="flex flex-col gap-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label={t("stats.volume")} value={<MoneyValue values={p.volume} lang={lang} />} hint={t("stats.volumeHint", { n: fmtNumber(p.succeeded, lang) })} tone="green" />
        <StatTile
          label={t("stats.fees")}
          value={<MoneyValue values={p.fees} lang={lang} />}
          hint={p.feesPending > 0 ? t("stats.feesPending", { count: p.feesPending }) : rate !== null ? t("stats.feesHint", { rate: fmtPercent(rate, lang, 2) }) : undefined}
        />
        <StatTile label={t("stats.net")} value={<MoneyValue values={p.net} lang={lang} />} hint={t("stats.netHint")} tone="green" />
        <StatTile
          label={t("stats.success")}
          value={p.successRate === null ? "0" : fmtPercent(p.successRate, lang, 1)}
          hint={p.successRate === null ? t("stats.successNone") : t("stats.successHint", { failed: p.failed, attempts: p.failed + p.succeeded })}
          tone={p.successRate === null ? "default" : p.successRate >= 0.9 ? "green" : p.successRate >= 0.75 ? "orange" : "red"}
        />
        <StatTile label={t("stats.refunds")} value={<MoneyValue values={p.refunded} lang={lang} />} hint={t("stats.refundsHint", { count: p.refunds })} tone={p.refunds > 0 ? "orange" : "default"} />
        <StatTile
          label={t("stats.disputes")}
          value={overview.disputes.length}
          hint={respond > 0 ? t("stats.disputesHint", { count: respond }) : t("stats.disputesNone")}
          tone={urgent ? "red" : overview.disputes.length > 0 ? "orange" : "default"}
          onClick={overview.disputes.length > 0 ? onDisputes : undefined}
        />
      </div>
      {p.processing + p.authorized > 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {[p.processing > 0 ? t("stats.processing", { count: p.processing }) : null, p.authorized > 0 ? t("stats.authorized", { count: p.authorized }) : null].filter(Boolean).join(". ")}
        </Text>
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
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Heading level="h2">{t("methods.title")}</Heading>
          <Badge size="2xsmall" color="grey">
            {t(days === 7 ? "period.d7" : "period.d30")}
          </Badge>
          {overview.mode === "demo" ? <SampleBadge /> : null}
        </div>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("methods.subtitle")}
        </Text>
      </div>
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
              <EmptyRow cols={8} text={t("methods.empty")} />
            ) : (
              rows.map((m) => (
                <Table.Row key={m.method} className="[&_td]:py-2.5">
                  <Table.Cell>
                    <Text size="small" weight="plus">
                      {t(`methods.${m.method}`)}
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
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export function PaymentsSection({
  overview,
  lang,
  initialFilter = "all",
  initialQuery = "",
}: {
  overview: StripeOverviewResponse
  lang: string
  /** From the page URL (?filter=, ?q=): the list a board counter or a host links to. */
  initialFilter?: PaymentFilter
  initialQuery?: string
}) {
  const { t } = useTranslation("stripe")
  const [filter, setFilter] = useState<PaymentFilter>(initialFilter)
  const [method, setMethod] = useState<MethodKey | "all">("all")
  const [search, setSearch] = useState(initialQuery)
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, method, q])
  const payments = useStripePayments(filter, method, q, page * PAGE_SIZE, PAGE_SIZE, overview.fetchedAt)
  const data = payments.data
  const rows = data?.payments ?? []
  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const methods = useMemo(() => METHOD_ORDER.filter((m) => (data?.methods?.[m] ?? 0) > 0), [data?.methods])

  return (
    <Container className="divide-y p-0" id="stripe-payments">
      <div className="flex flex-col gap-1 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Heading level="h2">{t("payments.title")}</Heading>
          {overview.mode === "demo" ? <SampleBadge /> : null}
        </div>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("payments.subtitle")}
        </Text>
      </div>
      <div className="flex flex-col gap-3 px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterPills<PaymentFilter>
            value={filter}
            onChange={setFilter}
            options={PAYMENT_FILTERS.filter((f) => f !== "foreign" || filter === "foreign" || (data?.counts?.foreign ?? 0) > 0).map((f) => ({ value: f, label: t(`payments.filter.${f}`), count: data?.counts?.[f] }))}
          />
          <div className="w-full lg:w-80">
            <Input size="small" type="search" placeholder={t("payments.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {methods.length > 1 || method !== "all" ? (
          <FilterPills<MethodKey | "all">
            value={method}
            onChange={setMethod}
            options={[{ value: "all", label: t("payments.methodAll") }, ...methods.map((m) => ({ value: m, label: t(`methods.${m}`), count: data?.methods?.[m] }))]}
          />
        ) : null}
      </div>
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
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.length === 0 ? (
              <EmptyRow cols={7} text={payments.isLoading ? "" : overview.paymentsTotal === 0 ? t("payments.emptyRead") : t("payments.empty")} />
            ) : (
              rows.map((p) => (
                <Table.Row key={p.id} className="align-top [&_td]:py-2.5">
                  <Table.Cell className="whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="txt-compact-small">{fmtDateTime(p.created, lang)}</span>
                      <span className="txt-compact-xsmall font-mono text-ui-fg-muted">{p.id}</span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-right">
                    <div className="flex flex-col items-end gap-y-1">
                      <span className="txt-compact-small-plus tabular-nums">{fmtMoney(p.amount, lang)}</span>
                      {p.refunded ? (
                        <Badge size="2xsmall" color="orange">
                          {t("payments.refunded", { amount: fmtMoney(p.refunded, lang) })}
                        </Badge>
                      ) : null}
                      {p.disputed ? (
                        <Badge size="2xsmall" color={p.disputeOpen ? "red" : "grey"}>
                          {t("payments.disputed")}
                        </Badge>
                      ) : null}
                      {p.refundFailed ? (
                        <Badge size="2xsmall" color="red">
                          {t("payments.refundFailed")}
                        </Badge>
                      ) : null}
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
                        <Badge size="2xsmall" color={p.risk === "highest" ? "red" : "orange"}>
                          {t(`payments.risk.${p.risk}`)}
                        </Badge>
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
                  <Table.Cell className="whitespace-nowrap text-right">
                    <ExternalLink href={p.dashboardUrl}>{t("actions.openStripe")}</ExternalLink>
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
    </Container>
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
    <Container className="divide-y p-0" id="stripe-disputes">
      <div className="flex flex-col gap-1 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Heading level="h2">{t("disputes.title")}</Heading>
          {overview.mode === "demo" ? <SampleBadge /> : null}
        </div>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("disputes.subtitle")}
        </Text>
        {closed.won + closed.lost > 0 ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("disputes.closed", closed)}
          </Text>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-muted">
            {t("disputes.none")}
          </Text>
        </div>
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
                      {d.method ? <span className="txt-compact-xsmall text-ui-fg-muted">{t(`methods.${d.method}`)}</span> : null}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{d.reason ? t(`disputes.reason.${d.reason}`, { defaultValue: d.reason }) : ""}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col items-start gap-y-1">
                      <Badge size="2xsmall" color={d.urgency === "waiting" ? "blue" : "orange"}>
                        {t(`disputes.status.${d.status}`, { defaultValue: d.status })}
                      </Badge>
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
    </Container>
  )
}

const REFUND_TONE: Record<string, "green" | "orange" | "red" | "grey" | "blue"> = { succeeded: "green", pending: "blue", requires_action: "orange", failed: "red", canceled: "grey" }

export function RefundsSection({ overview, lang }: { overview: StripeOverviewResponse; lang: string }) {
  const { t } = useTranslation("stripe")
  const rows = overview.refunds
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Heading level="h2">{t("refunds.title")}</Heading>
          {overview.mode === "demo" ? <SampleBadge /> : null}
        </div>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("refunds.subtitle")}
        </Text>
      </div>
      {rows.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-muted">
            {t("refunds.none")}
          </Text>
        </div>
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
                      <Badge size="2xsmall" color={REFUND_TONE[r.status] ?? "grey"}>
                        {t(`refunds.status.${r.status}`, { defaultValue: r.status })}
                      </Badge>
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
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Balance and payouts                                                 */
/* ------------------------------------------------------------------ */

const PAYOUT_TONE: Record<string, "green" | "orange" | "red" | "grey" | "blue"> = { paid: "green", pending: "blue", in_transit: "blue", canceled: "grey", failed: "red" }

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
      <EmptyRow cols={5} text={empty} />
    ) : (
      list.slice(0, 10).map((p) => (
        <Table.Row key={p.id} className="[&_td]:py-2.5">
          <Table.Cell className="whitespace-nowrap">{fmtDate(p.arrivalDate ?? p.created, lang)}</Table.Cell>
          <Table.Cell className="whitespace-nowrap text-right tabular-nums">{fmtMoney(p.amount, lang)}</Table.Cell>
          <Table.Cell>
            <div className="flex flex-col items-start gap-y-1">
              <Badge size="2xsmall" color={PAYOUT_TONE[p.status] ?? "grey"}>
                {t(`balance.status.${p.status}`, { defaultValue: p.status })}
              </Badge>
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
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-1 px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Heading level="h2">{t("balance.title")}</Heading>
          {overview.mode === "demo" ? <SampleBadge /> : null}
        </div>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {t("balance.subtitle")}
        </Text>
      </div>
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
          <Text size="small" className="text-ui-fg-muted">
            {t("balance.none")}
          </Text>
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
    </Container>
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
