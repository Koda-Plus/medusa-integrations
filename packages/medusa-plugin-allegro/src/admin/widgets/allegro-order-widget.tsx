import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Copy, Heading, Text, toast } from "@medusajs/ui"
import type { AllegroImportDto } from "../../modules/allegro/lib/contract"
import { errorMessage, useAllegroImportHandled, useAllegroOrderCard, useAllegroOutboxRetry } from "../lib/allegro-api"
import { AllegroIcon } from "../lib/allegro-icon"
import { WidgetFrame, hostable } from "../lib/allegro-kit"
import { IMPORT_TONE, OUTBOX_TONE, fmtDateTime, fmtMoney } from "../lib/allegro-ui"

/**
 * Order page, side column: what Allegro knows about an order this plugin
 * imported. The import (status, checkout form, payment, the buyer login and
 * the delivery chosen on Allegro, the totals on both sides), what needs a
 * person (with "Mark as handled"), the parcels, status and invoices sent to
 * Allegro (with "Retry") and the returns and disputes of the purchase. A thin
 * card over GET /admin/allegro/medusa-orders/:id; nothing on orders that did
 * not come from Allegro.
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame and header of its own, a line while loading and
 * for an order that is not from Allegro instead of nothing.
 */

/** The import list filter that shows this row, as the page reads it. */
function filterOf(imp: AllegroImportDto): string {
  if (imp.attention || imp.totalMismatch) return "attention"
  if (imp.status === "imported" || imp.status === "held" || imp.status === "cancelled" || imp.status === "skipped") return imp.status
  return "pending"
}

const AllegroOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("allegro")
  const lang = i18n.language || "en"
  const q = useAllegroOrderCard(data.id)
  const handled = useAllegroImportHandled()
  const retry = useAllegroOutboxRetry()
  const info = q.data
  if (q.isLoading || !info) return embedded ? <Quiet>{q.isError ? t("orderWidget.failed") : t("orderWidget.loading")}</Quiet> : null
  const imp = info.import
  if (!imp) return embedded ? <Quiet>{t("orderWidget.notAllegro")}</Quiet> : null
  const link = `/allegro?filter=${filterOf(imp)}&q=${encodeURIComponent(imp.checkoutFormId)}`
  const payment = imp.paymentType === "CASH_ON_DELIVERY" ? t("orderWidget.cod") : imp.paid ? t("orderWidget.paid") : t("orderWidget.unpaid")

  const onHandled = () =>
    handled.mutate(imp.id, {
      onSuccess: () => toast.success(t("orderWidget.handledToast")),
      onError: (err) => toast.error(errorMessage(err)),
    })

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <AllegroIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("orderWidget.title")}</Heading>
            {info.mode === "demo" ? (
              <Badge size="2xsmall" color="purple">
                {t("widget.demo")}
              </Badge>
            ) : null}
          </div>
          <Link to={link} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("orderWidget.more")}
          </Link>
        </div>
      }
    >
      {embedded ? (
        <div className="flex items-center justify-between gap-2 px-6 py-2">
          {info.mode === "demo" ? (
            <Badge size="2xsmall" color="purple">
              {t("widget.demo")}
            </Badge>
          ) : (
            <span />
          )}
          <Link to={link} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("orderWidget.more")}
          </Link>
        </div>
      ) : null}
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Line label={t("orderWidget.status")}>
          <Badge size="2xsmall" color={IMPORT_TONE[imp.status] ?? "grey"}>
            {t(`imports.status.${imp.status}`)}
          </Badge>
        </Line>
        <Line label={t("orderWidget.form")}>
          <span className="flex min-w-0 items-center gap-x-1">
            <Text size="xsmall" className="truncate font-mono text-ui-fg-subtle">
              {imp.checkoutFormId}
            </Text>
            <Copy content={imp.checkoutFormId} />
          </span>
        </Line>
        <Line label={t("orderWidget.payment")}>
          <Text size="small">{payment}</Text>
        </Line>
        {imp.buyerLogin ? (
          <Line label={t("orderWidget.buyer")}>
            <Text size="small">{imp.buyerLogin}</Text>
          </Line>
        ) : null}
        {imp.deliveryMethod || imp.pickupPoint ? (
          <Line label={t("orderWidget.delivery")}>
            <span className="flex flex-col items-end">
              {imp.deliveryMethod ? <Text size="small">{imp.deliveryMethod}</Text> : null}
              {imp.pickupPoint ? (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {t("orderWidget.point", { point: imp.pickupPoint })}
                </Text>
              ) : null}
            </span>
          </Line>
        ) : null}
        <Line label={t("orderWidget.total")}>
          <Text size="small" className={imp.totalMismatch ? "tabular-nums text-ui-tag-red-text" : "tabular-nums"}>
            {imp.totalMismatch && imp.medusaTotal
              ? t("orderWidget.totalsDiffer", { allegro: fmtMoney(imp.total, lang), medusa: fmtMoney(imp.medusaTotal, lang) })
              : fmtMoney(imp.total, lang)}
          </Text>
        </Line>
        {imp.status === "held" && imp.reason ? (
          <Text size="xsmall" className="text-ui-tag-orange-text">
            {imp.reason}
          </Text>
        ) : null}
        {imp.attention || imp.totalMismatch ? (
          <div className="flex flex-col gap-y-2 rounded-md bg-ui-bg-subtle px-3 py-2">
            <Text size="xsmall" weight="plus" className="text-ui-tag-red-text">
              {t("orderWidget.attention")}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              {imp.attention ?? imp.reason}
            </Text>
            <div>
              <Button size="small" variant="secondary" isLoading={handled.isPending} onClick={onHandled}>
                {t("orderWidget.handled")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="small" weight="plus">
          {t("orderWidget.sent")}
        </Text>
        {info.outbox.length === 0 ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("orderWidget.noneSent")}
          </Text>
        ) : (
          info.outbox.map((o) => (
            <div key={o.id} className="flex items-start justify-between gap-x-3">
              <div className="flex min-w-0 flex-col">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {t(`outbox.kind.${o.kind}`)}
                </Text>
                <Text size="small" className="truncate">
                  {o.summary}
                </Text>
                {o.lastError && o.status === "failed" ? (
                  <Text size="xsmall" className="text-ui-tag-red-text">
                    {o.lastError}
                  </Text>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-y-1">
                <Badge size="2xsmall" color={OUTBOX_TONE[o.status] ?? "grey"}>
                  {t(`outbox.status.${o.status}`)}
                </Badge>
                {o.status === "failed" ? (
                  <Button
                    size="small"
                    variant="transparent"
                    isLoading={retry.isPending && retry.variables === o.id}
                    onClick={() => retry.mutate(o.id, { onError: (err) => toast.error(errorMessage(err)) })}
                  >
                    {t("actions.retry")}
                  </Button>
                ) : o.doneAt ? (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {fmtDateTime(o.doneAt, lang)}
                  </Text>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
      {info.issues.length > 0 ? (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <Text size="small" weight="plus">
            {t("orderWidget.issues")}
          </Text>
          {info.issues.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-x-3">
              <span className="flex items-center gap-x-2">
                <Badge size="2xsmall" color={i.open ? (i.needsReply ? "orange" : "blue") : "grey"}>
                  {t(`issues.kind.${i.kind}`)}
                </Badge>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {i.status}
                </Text>
              </span>
              <a href={i.link} target="_blank" rel="noreferrer" className="txt-compact-small inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                {t("orderWidget.panel")}
                <ArrowUpRightOnBox />
              </a>
            </div>
          ))}
        </div>
      ) : null}
    </WidgetFrame>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-x-3">
      <Text size="small" className="shrink-0 text-ui-fg-subtle">
        {label}
      </Text>
      <div className="flex min-w-0 justify-end text-right">{children}</div>
    </div>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 py-4">
      <Text size="small" className="text-ui-fg-subtle">
        {children}
      </Text>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable(
  { id: "allegro.order", ns: "allegro", zone: "order.details", name: "Allegro", order: 50, Icon: AllegroIcon, hideWhenNone: true },
  AllegroOrderCard,
)
