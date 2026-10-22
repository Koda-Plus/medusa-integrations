import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightMini, Clock, Link as LinkIcon, Tag } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { useBaseLinkerProductCards } from "../lib/baselinker-api"
import { EmptyState, ToneBadge } from "../lib/baselinker-blocks"
import { BaseLinkerIcon } from "../lib/baselinker-icon"
import { KitLoading, WidgetFrame, hostable } from "../lib/baselinker-kit"
import { ConflictBadge, fmtNumber } from "../lib/baselinker-ui"

/**
 * Product page, side column: the BaseLinker cards linked to this product's
 * variants with their BaseLinker stock, the cards that carry one of its SKUs
 * but could not be linked, with the reason, and the main card the variant
 * cards hang under (a container, never linked itself).
 *
 * A host embeds it with `embedded`: no frame and header of its own.
 * Links are plain anchors (no react-router), so the card works in any host.
 */
const SHOWN = 8

const BaseLinkerProductCard = ({ data, embedded }: DetailWidgetProps<AdminProduct> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("baselinker")
  const lang = i18n.language || "en"
  const q = useBaseLinkerProductCards(data.id)
  const cards = q.data?.cards ?? []
  const more = `/app/baselinker?section=cards&q=${encodeURIComponent(data.id)}`

  if (q.isLoading) return embedded ? <KitLoading label={t("productWidget.loading")} /> : null
  if (q.isError) {
    const body = (
      <div className="px-6 py-4">
        <Text size="small" className="text-ui-tag-red-text">
          {t("productWidget.failed")}
        </Text>
      </div>
    )
    return embedded ? body : <WidgetFrame header={null}>{body}</WidgetFrame>
  }

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between gap-x-2 px-6 py-4">
          <div className="flex min-w-0 items-center gap-x-2">
            <BaseLinkerIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("productWidget.title")}</Heading>
            {q.data?.mode === "demo" ? <ToneBadge tone="blue">{t("widget.demo")}</ToneBadge> : null}
          </div>
          <a href={more} className="txt-compact-small-plus inline-flex shrink-0 items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("productWidget.more")}
            <ArrowUpRightMini />
          </a>
        </div>
      }
    >
      {cards.length === 0 ? (
        <EmptyState
          compact
          icon={<Tag />}
          title={t("productWidget.none")}
          points={[
            { icon: <LinkIcon />, text: t("productWidget.points.sku") },
            { icon: <Clock />, text: t("productWidget.points.hourly") },
          ]}
        />
      ) : (
        cards.slice(0, SHOWN).map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-x-3 px-6 py-3">
            <div className="flex min-w-0 flex-col gap-y-1">
              <Text size="small" weight="plus" className="truncate">
                {c.name || c.sku || c.blProductId}
              </Text>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{c.blProductId}</span>
                {c.sku ? <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{c.sku}</span> : null}
                {c.isContainer ? (
                  <ToneBadge tone="blue" title={t("productWidget.containerNote")}>
                    {t("productWidget.container")}
                  </ToneBadge>
                ) : null}
                {c.conflict ? <ConflictBadge conflict={c.conflict} /> : null}
              </span>
            </div>
            {c.isContainer ? null : (
              <div className="flex shrink-0 flex-col items-end gap-y-0.5">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {t("productWidget.stock")}
                </Text>
                <Text size="small" weight="plus" className={c.stock !== null && c.stock < 0 ? "tabular-nums text-ui-tag-red-text" : "tabular-nums"}>
                  {c.stock === null ? t("productWidget.noStock") : fmtNumber(c.stock, lang)}
                </Text>
              </div>
            )}
          </div>
        ))
      )}
      {cards.length > SHOWN ? (
        <div className="px-6 py-3">
          <a href={more} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("productWidget.moreCards", { count: cards.length - SHOWN })}
          </a>
        </div>
      ) : null}
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default hostable(
  { id: "baselinker.product", ns: "baselinker", zone: "product.details", name: "BaseLinker", order: 60, Icon: BaseLinkerIcon },
  BaseLinkerProductCard,
)
