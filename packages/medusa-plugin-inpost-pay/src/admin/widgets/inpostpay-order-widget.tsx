import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { History as HistoryIcon, ShoppingCart } from "@medusajs/icons"
import { Button, Heading, Text } from "@medusajs/ui"
import { useInpostPayOrder } from "../lib/inpostpay-api"
import { InpostPayIcon } from "../lib/inpostpay-icon"
import { EmptyState, ToneBadge } from "../lib/inpostpay-blocks"
import { KitLoading, WidgetFrame, hostable } from "../lib/inpostpay-kit"
import { BasketStatusBadge, EventList, PaymentBadge } from "../lib/inpostpay-ui"

/**
 * Order page, side column: whether the order came through InPost Pay, the
 * app user (masked phone), the delivery and the parcel locker chosen in the
 * app, InPost's payment and order status, and the history. Hidden on orders
 * that did not come through InPost Pay.
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame of its own, a line while loading and when empty.
 * Plain links (no router Link): a widget may render outside the dashboard's router.
 */
const InpostPayOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("inpostpay")
  const lang = i18n.language || "en"
  const q = useInpostPayOrder(data.id)
  const [history, setHistory] = useState(false)
  const info = q.data
  if (q.isLoading) return embedded ? <KitLoading label={t("widget.loading")} /> : null
  if (!info) return embedded ? <EmptyState compact icon={<ShoppingCart />} title={t("widget.failed")} /> : null
  const b = info.basket
  if (!b) return embedded ? <EmptyState compact icon={<ShoppingCart />} title={info.configured ? t("widget.none") : t("widget.notConfigured")} /> : null

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <InpostPayIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.title")}</Heading>
            {b.demo ? <ToneBadge tone="blue">{t("demo.badge")}</ToneBadge> : null}
          </div>
          <a href={`/app/inpostpay?q=${encodeURIComponent(data.id)}`} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.more")}
          </a>
        </div>
      }
    >
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BasketStatusBadge basket={b} />
          <PaymentBadge status={b.payment_status} />
        </div>
        {b.demo ? (
          <span className="w-fit">
            <ToneBadge tone="blue">{t("widget.demoNote")}</ToneBadge>
          </span>
        ) : null}
        {b.masked_phone ? <Line label={t("widget.phone")}>{b.masked_phone}</Line> : null}
        <Line label={t("widget.delivery")}>{b.delivery_type ? t(`delivery.${b.delivery_type}`) : t("delivery.none")}</Line>
        {b.delivery_point ? <Line label={t("widget.point")}>{b.delivery_point}</Line> : null}
        {b.payment_type ? <Line label={t("widget.paymentType")}>{b.payment_type}</Line> : null}
        {b.order_status ? <Line label={t("widget.orderStatus")}>{b.order_status}</Line> : null}
        {b.events.length > 0 ? (
          <Button size="small" variant="transparent" className="self-start" onClick={() => setHistory(!history)}>
            <HistoryIcon />
            {history ? t("table.hideEvents") : t("table.showEvents", { count: b.events.length })}
          </Button>
        ) : null}
        {history ? <EventList events={b.events} lang={lang} /> : null}
      </div>
    </WidgetFrame>
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
  { id: "inpostpay.order", ns: "inpostpay", zone: "order.details", name: "InPost Pay", order: 15, Icon: InpostPayIcon, hideWhenNone: true },
  InpostPayOrderCard,
)
