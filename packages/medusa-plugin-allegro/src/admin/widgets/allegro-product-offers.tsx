import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { useAllegroProductOffers } from "../lib/allegro-api"
import { OfferStatus, StockCell, fmtMoney } from "../lib/allegro-ui"
import { AllegroIcon } from "../lib/allegro-icon"

/**
 * Product page, side column: the Allegro offers linked to this product's
 * variants, primary first, with the Allegro quantity next to the Medusa one.
 * When there is none, the widget says how to link one.
 */
const AllegroProductOffersWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const { t, i18n } = useTranslation("allegro")
  const lang = i18n.language || "en"
  const q = useAllegroProductOffers(data.id)
  const offers = q.data?.offers ?? []
  const firstSku = data.variants?.find((v) => v.sku)?.sku ?? "SKU"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <AllegroIcon width={18} height={18} className="shrink-0" />
          <Heading level="h2">{t("widget.title")}</Heading>
          {q.data?.mode === "demo" ? (
            <Badge size="2xsmall" color="purple">
              {t("widget.demo")}
            </Badge>
          ) : null}
        </div>
        <Link to="/allegro" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("widget.more")}
        </Link>
      </div>
      {q.isLoading ? null : offers.length === 0 ? (
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t("widget.empty")}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("widget.hint", { sku: firstSku })}
          </Text>
        </div>
      ) : (
        offers.slice(0, 6).map((o) => (
          <div key={o.id} className="flex items-start justify-between gap-x-3 px-6 py-3">
            <div className="flex min-w-0 flex-col gap-y-1">
              <a
                href={o.url}
                target="_blank"
                rel="noreferrer"
                className="txt-compact-small-plus inline-flex items-center gap-x-1 text-ui-fg-base hover:text-ui-fg-interactive"
              >
                <span className="truncate">{o.name}</span>
                <ArrowUpRightOnBox className="shrink-0 text-ui-fg-muted" />
              </a>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{o.sku}</span>
                {o.isPrimary ? (
                  <Badge size="2xsmall" color="green">
                    {t("offers.primary")}
                  </Badge>
                ) : null}
              </span>
              <StockCell offer={o} />
            </div>
            <div className="flex shrink-0 flex-col items-end gap-y-1">
              <OfferStatus offer={o} />
              <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
                {fmtMoney(o.price, lang)}
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

export default AllegroProductOffersWidget
