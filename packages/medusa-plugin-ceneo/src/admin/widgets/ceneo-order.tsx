import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { useCeneoOrderLink } from "../lib/ceneo-api"
import { RowActions } from "../lib/ceneo-blocks"
import { CeneoIcon } from "../lib/ceneo-icon"
import { WidgetFrame } from "../lib/ceneo-kit"
import { ImportPanel } from "../lib/ceneo-kup-teraz"

/**
 * Order page, side column: for an order imported from Ceneo Kup Teraz, the
 * Ceneo order number and what Ceneo was told (shop number, confirmation,
 * parcel number, sent, cancellation). Renders nothing for other orders.
 */
const CeneoOrderWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { t, i18n } = useTranslation("ceneo")
  const lang = i18n.language || "en"
  const q = useCeneoOrderLink(data.id)
  const o = q.data?.order ?? null
  if (!o) return null
  const header = (
    <div className="flex items-center justify-between gap-x-2 px-6 py-4">
      <div className="flex min-w-0 items-center gap-x-2">
        <CeneoIcon width={18} height={18} className="shrink-0" />
        <Heading level="h2">{t("kupTeraz.widgetTitle")}</Heading>
      </div>
      <RowActions actions={[{ key: "page", label: t("widget.more"), icon: <ArrowUpRightOnBox />, href: "/app/ceneo" }]} />
    </div>
  )
  return (
    <WidgetFrame header={header}>
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex flex-col gap-y-0.5">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            {t("kupTeraz.ceneoNumber")}
          </Text>
          <span className="font-mono txt-compact-small text-ui-fg-base">{o.number ?? o.ceneoOrderId}</span>
        </div>
        <ImportPanel o={o} lang={lang} showOrderLink={false} />
      </div>
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default CeneoOrderWidget
