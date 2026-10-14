import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Heading, Text } from "@medusajs/ui"
import { useOrderCoupons } from "../lib/coupons-api"
import { CouponsIcon } from "../lib/coupons-icon"
import { WidgetFrame, hostable } from "../lib/coupons-kit"
import { useFormat } from "../lib/coupons-ui"

/**
 * Order page, side column: which coupons worked in this order and what each
 * gave, read from the promotion adjustments Medusa keeps on the order's
 * lines and delivery. Facts never come from order metadata. Links are plain
 * anchors: a react-router Link inside a widget breaks in some admins.
 */
const CouponsOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const q = useOrderCoupons(data?.id)
  const r = q.data
  if (!embedded && (!r || r.applied.length === 0)) return null
  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center gap-x-2 px-6 py-4">
          <CouponsIcon width={18} height={18} />
          <Heading level="h2">{t("widget.order.title")}</Heading>
        </div>
      }
    >
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {!r || r.applied.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("widget.order.none")}
          </Text>
        ) : (
          <>
            {r.applied.map((a, i) => (
              <div key={`${a.code ?? "auto"}-${i}`} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  {a.code ? (
                    <a href={`/app/coupons?q=${encodeURIComponent(a.code)}`} className="txt-compact-small-plus font-mono text-ui-fg-interactive hover:underline">
                      {a.code}
                    </a>
                  ) : (
                    <Badge size="2xsmall" color="blue">
                      {t("widget.order.automatic")}
                    </Badge>
                  )}
                  {a.on === "shipping" ? (
                    <Badge size="2xsmall" color="grey">
                      {t("widget.order.shipping")}
                    </Badge>
                  ) : null}
                </span>
                <Text size="small" className="tabular-nums">
                  -{fmt.money(a.discount, r.currency)}
                </Text>
              </div>
            ))}
            {r.applied.length > 1 ? (
              <div className="flex items-center justify-between border-t border-ui-border-base pt-2">
                <Text size="small" className="text-ui-fg-subtle">
                  {t("widget.order.total")}
                </Text>
                <Text size="small" weight="plus" className="tabular-nums">
                  -{fmt.money(r.total, r.currency)}
                </Text>
              </div>
            ) : null}
          </>
        )}
      </div>
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable({ id: "coupons.order", ns: "coupons", zone: "order.details", name: "Coupons", order: 95, Icon: CouponsIcon, hideWhenNone: true }, CouponsOrderCard)
