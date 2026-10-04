import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useOlxProductAdverts } from "../lib/olx-api"
import { AdvertStatus, fmtPrice } from "../lib/olx-ui"
import { OlxIcon } from "../lib/olx-icon"

/**
 * Product page, side column: the OLX adverts linked to this product's
 * variants, primary first. When there is none, the widget says how to link one.
 */
const OlxProductAdvertsWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const { t, i18n } = useTranslation("olx")
  const lang = i18n.language || "en"
  const q = useOlxProductAdverts(data.id)
  const adverts = q.data?.adverts ?? []
  const firstSku = data.variants?.find((v) => v.sku)?.sku ?? "SKU"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <OlxIcon width={18} height={18} className="shrink-0" />
          <Heading level="h2">{t("widget.title")}</Heading>
          {q.data?.mode === "demo" ? (
            <Badge size="2xsmall" color="purple">
              {t("widget.demo")}
            </Badge>
          ) : null}
        </div>
        <Link to="/olx" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("widget.more")}
        </Link>
      </div>
      {q.isLoading ? null : adverts.length === 0 ? (
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("widget.empty")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("widget.hint", { sku: firstSku })}
          </Text>
        </div>
      ) : (
        adverts.slice(0, 6).map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-x-3 px-6 py-3">
            <div className="flex min-w-0 flex-col gap-y-1">
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="txt-compact-small-plus inline-flex items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive"
              >
                <span className="truncate">{a.title}</span>
                <ArrowUpRightOnBox className="shrink-0 text-ui-fg-muted" />
              </a>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{a.sku}</span>
                {a.isPrimary ? (
                  <Badge size="2xsmall" color="green">
                    {t("adverts.primary")}
                  </Badge>
                ) : null}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-y-1">
              <AdvertStatus advert={a} />
              <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
                {fmtPrice(a.price, lang)}
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

export default OlxProductAdvertsWidget
