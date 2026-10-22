import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox, Tag } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { EmptyState, ToneBadge } from "../lib/allegro-blocks"
import { useAllegroProductOffers } from "../lib/allegro-api"
import { AllegroIcon } from "../lib/allegro-icon"
import { KitLoading, WidgetFrame, hostable } from "../lib/allegro-kit"
import { OfferStatus, StockCell, fmtMoney } from "../lib/allegro-ui"

/**
 * Product page, side column: the Allegro offers linked to this product's
 * variants, primary first, with the Allegro quantity next to the Medusa one.
 * When there is none, the card says how to link one.
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame and header of its own, a line while loading
 * instead of nothing, the demo badge and the page link at the top.
 */
const AllegroProductCard = ({ data, embedded }: DetailWidgetProps<AdminProduct> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("allegro")
  const lang = i18n.language || "en"
  const q = useAllegroProductOffers(data.id)
  const offers = q.data?.offers ?? []
  const firstSku = data.variants?.find((v) => v.sku)?.sku ?? "SKU"
  /* The page opens on the offers of this product: a search by the first signature. */
  const more = data.variants?.find((v) => v.sku)?.sku ? `/allegro?filter=all&q=${encodeURIComponent(firstSku)}` : "/allegro"
  if (embedded && q.isError) return <Quiet>{t("widget.failed")}</Quiet>
  if (embedded && q.isLoading) return <KitLoading label={t("widget.loading")} />

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <AllegroIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.title")}</Heading>
            {q.data?.mode === "demo" ? (
              <ToneBadge tone="purple">{t("widget.demo")}</ToneBadge>
            ) : null}
          </div>
          <Link to={more} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.more")}
          </Link>
        </div>
      }
    >
      {embedded ? (
        <div className="flex items-center justify-between gap-2 px-6 py-2">
          {q.data?.mode === "demo" ? (
            <ToneBadge tone="purple">{t("widget.demo")}</ToneBadge>
          ) : (
            <span />
          )}
          <Link to={more} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.more")}
          </Link>
        </div>
      ) : null}
      {q.isLoading ? (
        <KitLoading label={t("widget.loading")} />
      ) : offers.length === 0 ? (
        <EmptyState
          compact
          icon={<Tag />}
          title={t("widget.empty")}
          action={
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("widget.hint", { sku: firstSku })}
            </Text>
          }
        />
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
                  <ToneBadge tone="green">{t("offers.primary")}</ToneBadge>
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

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default hostable({ id: "allegro.product", ns: "allegro", zone: "product.details", name: "Allegro", order: 50, Icon: AllegroIcon }, AllegroProductCard)
