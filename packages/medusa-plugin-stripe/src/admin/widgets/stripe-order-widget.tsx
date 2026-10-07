import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Button, Heading, Text, clx } from "@medusajs/ui"
import type { OrderPaymentDto } from "../../modules/stripe/lib/contract"
import { errorMessage, useStripeOrder, useStripeOrderRefresh } from "../lib/stripe-api"
import { StripeIcon } from "../lib/stripe-icon"
import { WidgetFrame, hostable } from "../lib/stripe-kit"
import { DisputeDue, ExternalLink, PaymentStatusBadge, declineText, fmtDate, fmtDateTime, fmtMoney, methodDetail, methodLabel } from "../lib/stripe-ui"

/**
 * Order page, side column: the PaymentIntent behind the order's Stripe
 * payment, as Stripe holds it. Status, how the customer paid (BLIK, the
 * Przelewy24 bank, the card and its wallet), the amount, Stripe's fee and
 * the net from the balance transaction, Radar's risk, refunds, disputes
 * with their evidence deadlines, and the link to the Dashboard (test or
 * live). "Read again" asks Stripe once more (at most every 30 seconds); when
 * Stripe does not answer, the last read shows, marked as such.
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame, header or footer of its own, the facts in a grid
 * for the wide column, and a line while loading and on orders not paid with
 * Stripe instead of nothing. On its own it stays out of orders not paid with
 * Stripe.
 *
 * Read only: capture and refunds stay in Medusa's own order actions.
 */
const StripeOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("stripe")
  const lang = i18n.language || "en"
  const q = useStripeOrder(data.id)
  const refresh = useStripeOrderRefresh(data.id)
  const info = q.data

  if (q.isLoading) return embedded ? <Quiet>{t("widget.loading")}</Quiet> : null
  if (q.isError || !info) {
    const text = t("error", { message: errorMessage(q.error) })
    if (embedded) return <Quiet tone="error">{t("widget.failed")}</Quiet>
    return (
      <WidgetFrame header={<Header orderRef={data.display_id ?? data.id} demo={false} />}>
        <Quiet tone="error">{text}</Quiet>
      </WidgetFrame>
    )
  }
  if (info.none) return embedded ? <Quiet>{t("widget.none")}</Quiet> : null

  const readAt = info.payments
    .map((p) => p.readAt)
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop()
  const stale = info.payments.some((p) => p.stale)

  return (
    <WidgetFrame embedded={embedded} header={<Header orderRef={data.display_id ?? data.id} demo={info.mode === "demo"} />}>
      {embedded && info.mode === "demo" ? (
        <div className="px-6 py-2">
          <Badge size="2xsmall" color="purple">
            {t("widget.demo")}
          </Badge>
        </div>
      ) : null}

      {info.payments.map((p) => (
        <PaymentBlock key={p.id} payment={p} lang={lang} wide={Boolean(embedded)} />
      ))}

      <div className="flex flex-col gap-y-2 px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text size="xsmall" className={stale ? "text-ui-tag-orange-text" : "text-ui-fg-muted"}>
            {readAt ? (stale ? t("widget.stale", { time: fmtDateTime(readAt, lang) }) : t("widget.readAt", { time: fmtDateTime(readAt, lang) })) : ""}
          </Text>
          {info.mode !== "demo" && info.configured ? (
            <Button size="small" variant="secondary" isLoading={refresh.isPending} onClick={() => refresh.mutate()}>
              {t("widget.refresh")}
            </Button>
          ) : null}
        </div>
        {refresh.isError ? (
          <Text size="xsmall" className="text-ui-tag-red-text">
            {t("error", { message: errorMessage(refresh.error) })}
          </Text>
        ) : null}
        {embedded ? null : (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("widget.readOnly")}
          </Text>
        )}
      </div>
    </WidgetFrame>
  )
}

function Header({ orderRef, demo }: { orderRef: string | number; demo: boolean }) {
  const { t } = useTranslation("stripe")
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-x-2">
        <StripeIcon width={18} height={18} className="shrink-0" />
        <Heading level="h2">{t("widget.title")}</Heading>
        {demo ? (
          <Badge size="2xsmall" color="purple">
            {t("widget.demo")}
          </Badge>
        ) : null}
      </div>
      <Link to={`/stripe?q=${encodeURIComponent(String(orderRef))}`} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
        {t("widget.more")}
      </Link>
    </div>
  )
}

function Quiet({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <div className="px-6 py-4">
      <Text size="small" className={tone === "error" ? "text-ui-tag-red-text" : "text-ui-fg-subtle"}>
        {children}
      </Text>
    </div>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-x-3">
      <Text size="small" className="shrink-0 text-ui-fg-subtle">
        {label}
      </Text>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  )
}

function PaymentBlock({ payment: p, lang, wide }: { payment: OrderPaymentDto; lang: string; wide: boolean }) {
  const { t } = useTranslation("stripe")
  if (!p.found || !p.payment) {
    const message =
      p.problem === "unconfigured"
        ? t("widget.unconfigured", { id: p.id })
        : p.problem === "not_found"
          ? t("widget.notFound", { id: p.id })
          : p.problem === "forbidden"
            ? t("widget.forbidden", { id: p.id, permission: p.permission ?? "rak_payment_intent_read" })
            : t("widget.error", { id: p.id, message: p.problemMessage ?? "" })
    return (
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="small" className={p.problem === "unconfigured" ? "text-ui-fg-subtle" : "text-ui-tag-orange-text"}>
          {message}
        </Text>
        {p.problem === "unconfigured" ? (
          <Link to="/stripe?view=guide" className="txt-compact-small-plus text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("actions.guide")}
          </Link>
        ) : null}
      </div>
    )
  }
  const row = p.payment
  const detail = methodDetail(t, row.detail)
  const settlement = (row.fee ?? row.net)?.currency ?? null
  return (
    <div className="flex flex-col gap-y-3 px-6 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <span className="txt-compact-xsmall truncate font-mono text-ui-fg-muted" title={row.id}>
          {row.id}
        </span>
        <PaymentStatusBadge status={row.status} />
      </div>
      <div className={clx(wide ? "grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-y-3")}>
        <Line label={t("widget.amount")}>
          <span className="txt-compact-small-plus tabular-nums">{fmtMoney(row.amount, lang)}</span>
        </Line>
        <Line label={t("widget.method")}>
          <div className="flex flex-col items-end">
            <span className="txt-compact-small">{methodLabel(t, row.method)}</span>
            {detail ? <span className="txt-compact-xsmall text-ui-fg-muted">{detail}</span> : null}
          </div>
        </Line>
        {row.fee ? (
          <Line label={t("widget.fee")}>
            <span className="txt-compact-small tabular-nums text-ui-fg-subtle">{fmtMoney(row.fee, lang)}</span>
          </Line>
        ) : row.status === "succeeded" ? (
          <Line label={t("widget.fee")}>
            <span className="txt-compact-xsmall text-ui-fg-muted">{t("payments.feePending")}</span>
          </Line>
        ) : null}
        {row.net ? (
          <Line label={t("widget.net")}>
            <span className="txt-compact-small-plus tabular-nums">{fmtMoney(row.net, lang)}</span>
          </Line>
        ) : null}
        {p.exchangeRate ? (
          <Line label={t("widget.exchangeRate")}>
            <span className="txt-compact-small tabular-nums">
              {settlement ? t("widget.exchangeRateValue", { from: row.amount.currency.toUpperCase(), to: settlement.toUpperCase(), rate: String(p.exchangeRate) }) : String(p.exchangeRate)}
            </span>
          </Line>
        ) : null}
        {p.availableOn ? (
          <Line label={t("widget.availableOn")}>
            <span className="txt-compact-small">{fmtDate(p.availableOn, lang)}</span>
          </Line>
        ) : null}
        {row.risk ? (
          <Line label={t("widget.risk")}>
            <span className="txt-compact-small">
              {t(`widget.riskLevel.${row.risk}`)}
              {p.outcome?.riskScore !== null && p.outcome?.riskScore !== undefined ? <span className="text-ui-fg-muted"> ({p.outcome.riskScore})</span> : null}
            </span>
          </Line>
        ) : null}
        {row.captureMethod ? (
          <Line label={t("widget.capture")}>
            <span className="txt-compact-small">{t(`widget.captureMethod.${row.captureMethod}`, { defaultValue: row.captureMethod })}</span>
          </Line>
        ) : null}
        {p.providerId ? (
          <Line label={t("widget.provider")}>
            <span className="txt-compact-xsmall break-all font-mono">{p.providerId}</span>
          </Line>
        ) : null}
        <Line label={t("widget.created")}>
          <span className="txt-compact-small">{fmtDateTime(row.created, lang)}</span>
        </Line>
      </div>
      {row.failure && (row.failure.message || row.failure.code) ? (
        <Text size="xsmall" className="text-ui-tag-red-text" title={[row.failure.code, row.failure.message].filter(Boolean).join(": ")}>
          {declineText(t, row.failure)}
        </Text>
      ) : null}
      {p.refunds.length > 0 ? (
        <div className="flex flex-col gap-y-1.5">
          <Text size="small" weight="plus">
            {t("widget.refunds")}
          </Text>
          {p.refunds.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-x-2">
              <span className="txt-compact-xsmall text-ui-fg-muted">{fmtDate(r.created, lang)}</span>
              <span className="inline-flex items-center gap-x-1.5">
                <span className="txt-compact-small tabular-nums">{fmtMoney(r.amount, lang)}</span>
                <Badge size="2xsmall" color={r.status === "succeeded" ? "green" : r.status === "failed" ? "red" : "blue"}>
                  {t(`refunds.status.${r.status}`, { defaultValue: r.status })}
                </Badge>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {p.disputes.map((dispute) => (
        <div key={dispute.id} className="flex flex-col gap-y-1.5 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
          <div className="flex items-center justify-between gap-x-2">
            <Text size="small" weight="plus">
              {t("widget.disputes")}
            </Text>
            <Badge size="2xsmall" color={dispute.open ? "orange" : dispute.status === "won" ? "green" : "grey"}>
              {t(`disputes.status.${dispute.status}`, { defaultValue: dispute.status })}
            </Badge>
          </div>
          {dispute.reason ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {t(`disputes.reason.${dispute.reason}`, { defaultValue: dispute.reason })}, {fmtMoney(dispute.amount, lang)}
            </Text>
          ) : null}
          {dispute.open ? <DisputeDue dueBy={dispute.dueBy} daysLeft={dispute.daysLeft} urgency={dispute.urgency} lang={lang} /> : null}
          <ExternalLink href={dispute.dashboardUrl} className="txt-compact-xsmall-plus w-fit">
            {t("actions.openStripe")}
          </ExternalLink>
        </div>
      ))}
      <ExternalLink href={row.dashboardUrl} className="w-fit">
        {t("actions.openStripe")}
      </ExternalLink>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable({ id: "stripe.order", ns: "stripe", zone: "order.details", name: "Stripe", order: 10, Icon: StripeIcon, hideWhenNone: true }, StripeOrderCard)
