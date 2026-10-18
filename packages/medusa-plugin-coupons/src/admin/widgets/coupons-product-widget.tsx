import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { Heading, Text } from "@medusajs/ui"
import { useProductCoupons } from "../lib/coupons-api"
import { CouponsIcon } from "../lib/coupons-icon"
import { WidgetFrame, hostable } from "../lib/coupons-kit"
import { couponSentence } from "../lib/coupons-sentence"
import { useFormat } from "../lib/coupons-ui"

/**
 * Product page, side column: active coupons whose discount covers this
 * product (whole-order coupons, and the ones aimed at its categories or at
 * the product itself).
 */
const CouponsProductCard = ({ data, embedded }: DetailWidgetProps<AdminProduct> & { embedded?: boolean }) => {
  const { t } = useTranslation("coupons")
  const fmt = useFormat()
  const q = useProductCoupons(data?.id)
  const r = q.data
  if (!embedded && (!r || r.coupons.length === 0)) return null
  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex flex-col gap-y-0.5 px-6 py-4">
          <div className="flex items-center gap-x-2">
            <CouponsIcon width={18} height={18} />
            <Heading level="h2">{t("widget.product.title")}</Heading>
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {t("widget.product.hint")}
          </Text>
        </div>
      }
    >
      <div className="flex flex-col gap-y-3 px-6 py-4">
        {!r || r.coupons.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            {t("widget.product.none")}
          </Text>
        ) : (
          r.coupons.map((c) => (
            <div key={c.id} className="flex flex-col gap-y-0.5">
              <a href={`/app/coupons?q=${encodeURIComponent(c.code)}`} className="txt-compact-small-plus font-mono text-ui-fg-interactive hover:underline">
                {c.code || t("list.noCode")}
              </a>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {couponSentence(c, r.names, t, fmt, "PLN")}
              </Text>
            </div>
          ))
        )}
      </div>
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default hostable({ id: "coupons.product", ns: "coupons", zone: "product.details", name: "Coupons", order: 95, Icon: CouponsIcon, hideWhenNone: true }, CouponsProductCard)
