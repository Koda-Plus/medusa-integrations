import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox, ArrowRightOnRectangle, FolderOpen, SquaresPlus } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { useProductCeneo } from "../lib/ceneo-api"
import { EmptyState, RowActions } from "../lib/ceneo-blocks"
import { CeneoPath } from "../lib/ceneo-categories"
import { CeneoIcon } from "../lib/ceneo-icon"
import { KitLoading, WidgetFrame } from "../lib/ceneo-kit"
import { ProblemList, StateBadge, fmtPln, useTakeOverAction } from "../lib/ceneo-offers"

/**
 * Product page, side column: what Ceneo gets from this product. The Ceneo
 * category it maps to, and per variant the offer after the last build with
 * the reasons it stays out of the file.
 */
const CeneoProductWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const { t, i18n } = useTranslation("ceneo")
  const lang = i18n.language || "en"
  const q = useProductCeneo(data.id)
  const takeOver = useTakeOverAction()
  const offers = q.data?.offers ?? []
  const category = q.data?.category ?? null

  const header = (
    <div className="flex items-center justify-between gap-x-2 px-6 py-4">
      <div className="flex min-w-0 items-center gap-x-2">
        <CeneoIcon width={18} height={18} className="shrink-0" />
        <Heading level="h2">{t("widget.title")}</Heading>
      </div>
      <RowActions actions={[{ key: "page", label: t("widget.more"), icon: <ArrowUpRightOnBox />, href: "/app/ceneo" }]} />
    </div>
  )

  return (
    <WidgetFrame header={header}>
      <div className="flex flex-col gap-y-1 px-6 py-3">
        <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
          {t("widget.category")}
        </Text>
        {category?.ceneo ? (
          <CeneoPath category={category.ceneo} />
        ) : (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("widget.noCategory")}
          </Text>
        )}
      </div>
      {q.isLoading ? (
        <KitLoading className="min-h-0 py-4" />
      ) : offers.length === 0 ? (
        <EmptyState compact icon={<SquaresPlus />} title={t("widget.empty")} points={[{ icon: <FolderOpen />, text: t("widget.points.build") }]} />
      ) : (
        offers.slice(0, 10).map((o) => (
          <div key={o.id} className="flex flex-col gap-y-1.5 px-6 py-3">
            <div className="flex items-start justify-between gap-x-3">
              <div className="flex min-w-0 flex-col gap-y-1">
                <span className="txt-compact-small-plus truncate text-ui-fg-base" title={o.title}>
                  {o.title}
                </span>
                <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{o.offerId ?? t("offers.noId")}</span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-y-1">
                <StateBadge state={o.state} />
                <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
                  {fmtPln(o.price, lang)}
                </Text>
              </div>
            </div>
            <ProblemList problems={o.problems} />
            {o.canTakeOver ? (
              <RowActions actions={[{ key: "take", label: t("offers.takeOver.action"), icon: <ArrowRightOnRectangle />, onClick: () => void takeOver.run(o), loading: takeOver.pending }]} />
            ) : null}
          </div>
        ))
      )}
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default CeneoProductWidget
