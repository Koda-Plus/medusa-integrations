import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Heading, Text } from "@medusajs/ui"
import { useVonHalskyOrigin } from "../lib/vonhalsky-api"
import { VonHalskyIcon } from "../lib/vonhalsky-icon"
import { WidgetFrame, hostable } from "../lib/vonhalsky-kit"
import { EventList, ImportBadge, TrackingBadge } from "../lib/vonhalsky-ui"

/**
 * Order page, side column: whether the order came from InPost Von Halsky,
 * the marketplace order id, the delivery and the parcel locker, the payment
 * and the tracking sent back, with the history. Hidden on every other order.
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame of its own, a line while loading and when empty.
 * Plain links (no router Link): a widget may render outside the dashboard's router.
 */
const VonHalskyOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("vonhalsky")
  const lang = i18n.language || "en"
  const q = useVonHalskyOrigin(data.id)
  const [history, setHistory] = useState(false)
  const info = q.data
  if (q.isLoading || !info) return embedded ? <Quiet>{q.isError ? t("widget.failed") : t("widget.loading")}</Quiet> : null
  const o = info.order
  if (!o) return embedded ? <Quiet>{info.configured ? t("widget.none") : t("widget.notConfigured")}</Quiet> : null

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <VonHalskyIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.title")}</Heading>
            {o.demo ? (
              <Badge size="2xsmall" color="purple">
                {t("demo.badge")}
              </Badge>
            ) : null}
          </div>
          <a href={`/app/vonhalsky?section=orders&q=${encodeURIComponent(o.marketplace_order_id)}`} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.more")}
          </a>
        </div>
      }
    >
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ImportBadge status={o.status} />
          <TrackingBadge order={o} />
        </div>
        {o.demo ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("widget.demoNote")}
          </Text>
        ) : null}
        <Line label={t("widget.orderId")}>{o.marketplace_order_id}</Line>
        <Line label={t("widget.delivery")}>{o.delivery_type ? t(`delivery.${o.delivery_type}`, { defaultValue: o.delivery_type }) : t("delivery.none")}</Line>
        {o.delivery_point ? <Line label={t("widget.point")}>{o.delivery_point}</Line> : null}
        <Line label={t("widget.payment")}>{o.payment_type === "CASH_ON_DELIVERY" ? t("payment.cod") : t("payment.paid")}</Line>
        {o.tracking_numbers.length > 0 ? <Line label={t("widget.tracking")}>{o.tracking_numbers.join(", ")}</Line> : null}
        {o.error ? (
          <Text size="xsmall" className="text-ui-tag-red-text">
            {o.error}
          </Text>
        ) : null}
        {o.events.length > 0 ? (
          <button type="button" className="txt-compact-small self-start text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={() => setHistory(!history)}>
            {t("orders.events")}
          </button>
        ) : null}
        {history ? <EventList events={o.events} lang={lang} /> : null}
      </div>
    </WidgetFrame>
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

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-x-3">
      <Text size="small" className="shrink-0 text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="small" className="min-w-0 break-all text-right font-mono text-ui-fg-base">
        {children}
      </Text>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable(
  { id: "vonhalsky.order", ns: "vonhalsky", zone: "order.details", name: "InPost Von Halsky", order: 55, Icon: VonHalskyIcon, hideWhenNone: true },
  VonHalskyOrderCard,
)
