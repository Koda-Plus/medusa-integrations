import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useBaseLinkerProductCards } from "../lib/baselinker-api"
import { BaseLinkerIcon } from "../lib/baselinker-icon"
import { ConflictBadge, fmtNumber } from "../lib/baselinker-ui"

/**
 * Product page, side column: the BaseLinker cards linked to this product's
 * variants with their BaseLinker stock, and the cards that carry one of its
 * SKUs but could not be linked, with the reason.
 */
const BaseLinkerProductWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const { t, i18n } = useTranslation("baselinker")
  const lang = i18n.language || "en"
  const q = useBaseLinkerProductCards(data.id)
  const cards = q.data?.cards ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <BaseLinkerIcon width={18} height={18} className="shrink-0" />
          <Heading level="h2">{t("productWidget.title")}</Heading>
          {q.data?.mode === "demo" ? (
            <Badge size="2xsmall" color="purple">
              {t("widget.demo")}
            </Badge>
          ) : null}
        </div>
        <Link to="/baselinker" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("productWidget.more")}
        </Link>
      </div>
      {q.isLoading ? null : cards.length === 0 ? (
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("productWidget.none")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("productWidget.hint")}
          </Text>
        </div>
      ) : (
        cards.slice(0, 8).map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-x-3 px-6 py-3">
            <div className="flex min-w-0 flex-col gap-y-1">
              <Text size="small" weight="plus" className="truncate">
                {c.name || c.sku || c.blProductId}
              </Text>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-ui-fg-muted txt-compact-xsmall">#{c.blProductId}</span>
                {c.sku ? <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{c.sku}</span> : null}
                {c.conflict ? <ConflictBadge conflict={c.conflict} /> : null}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-y-0.5">
              <Text size="xsmall" className="text-ui-fg-subtle">
                {t("productWidget.stock")}
              </Text>
              <Text size="small" weight="plus" className={c.stock !== null && c.stock < 0 ? "tabular-nums text-ui-tag-red-text" : "tabular-nums"}>
                {c.stock === null ? t("productWidget.noStock") : fmtNumber(c.stock, lang)}
              </Text>
            </div>
          </div>
        ))
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default BaseLinkerProductWidget
