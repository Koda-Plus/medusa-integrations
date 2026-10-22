import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox, ChatBubbleLeftRight, DocumentText, Hashtag, Tag } from "@medusajs/icons"
import { Heading, Text } from "@medusajs/ui"
import { useOlxProductAdverts } from "../lib/olx-api"
import { EmptyState, RowActions, ToneBadge } from "../lib/olx-blocks"
import { OlxIcon } from "../lib/olx-icon"
import { KitLoading, WidgetFrame } from "../lib/olx-kit"
import { AdvertStatus, AlertBadge, ProblemList, PublicationStateBadge, fmtNumber, fmtPrice } from "../lib/olx-ui"

/**
 * Product page, side column: the OLX adverts linked to this product's
 * variants (primary first, with statistics and unread messages), the alerts
 * the product raises and its publish plan. When there is no advert, the
 * card says how to link one.
 */
const OlxProductAdvertsWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const { t, i18n } = useTranslation("olx")
  const lang = i18n.language || "en"
  const q = useOlxProductAdverts(data.id)
  const adverts = q.data?.adverts ?? []
  const alerts = q.data?.alerts ?? []
  const publications = (q.data?.publications ?? []).filter((p) => p.state !== "published")
  const firstSku =
    data.variants?.find((v) => v.sku)?.sku ?? alerts.find((a) => a.sku)?.sku ?? q.data?.publications.find((p) => p.sku)?.sku ?? "SKU"
  const pageLink = `/app/olx?q=${encodeURIComponent(data.variants?.find((v) => v.sku)?.sku ?? data.title ?? "")}`

  const header = (
    <div className="flex items-center justify-between gap-x-2 px-6 py-4">
      <div className="flex min-w-0 items-center gap-x-2">
        <OlxIcon width={18} height={18} className="shrink-0" />
        <Heading level="h2">{t("widget.title")}</Heading>
        {q.data?.mode === "demo" ? <ToneBadge tone="purple">{t("widget.demo")}</ToneBadge> : null}
      </div>
      <RowActions actions={[{ key: "page", label: t("widget.more"), icon: <ArrowUpRightOnBox />, href: pageLink }]} />
    </div>
  )

  return (
    <WidgetFrame header={header}>
      {alerts.length > 0 ? (
        <div className="flex flex-col gap-y-2 px-6 py-3">
          {alerts.map((a) => (
            <div key={a.id} className="flex flex-col items-start gap-y-1">
              <AlertBadge kind={a.kind} />
              <Text size="xsmall" className="text-ui-fg-subtle">
                {t(`alerts.hint.${a.kind}`)}
              </Text>
            </div>
          ))}
        </div>
      ) : null}

      {q.isLoading ? (
        <KitLoading className="min-h-0 py-4" />
      ) : adverts.length === 0 ? (
        <EmptyState
          compact
          icon={<Tag />}
          title={t("widget.empty")}
          points={[
            { icon: <Hashtag />, text: t("widget.points.external") },
            { icon: <DocumentText />, text: t("widget.points.description", { sku: firstSku }) },
          ]}
        />
      ) : (
        adverts.slice(0, 6).map((a) => (
          <div key={a.id} className="flex flex-col gap-y-1.5 px-6 py-3">
            <div className="flex items-start justify-between gap-x-3">
              <div className="flex min-w-0 flex-col gap-y-1">
                <span className="txt-compact-small-plus truncate text-ui-fg-base" title={a.title}>
                  {a.title}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{a.sku}</span>
                  {a.isPrimary ? <ToneBadge tone="green">{t("adverts.primary")}</ToneBadge> : null}
                  {a.unread > 0 ? <ToneBadge tone="blue">{t("adverts.unread", { count: a.unread })}</ToneBadge> : null}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-y-1">
                <AdvertStatus advert={a} />
                <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
                  {fmtPrice(a.price, lang)}
                </Text>
              </div>
            </div>
            <div className="flex items-center justify-between gap-x-2">
              <Text size="xsmall" className="tabular-nums text-ui-fg-muted">
                {a.stats
                  ? t("widget.stats", {
                      views: fmtNumber(a.stats.views ?? 0, lang),
                      phone: fmtNumber(a.stats.phoneViews ?? 0, lang),
                      observers: fmtNumber(a.stats.observers ?? 0, lang),
                    })
                  : ""}
              </Text>
              <RowActions
                actions={[
                  { key: "chat", label: t("actions.openChat"), icon: <ChatBubbleLeftRight />, href: q.data?.chatUrl, external: true, hidden: !(a.unread > 0 && q.data?.chatUrl) },
                  { key: "olx", label: t("actions.openOlx"), icon: <ArrowUpRightOnBox />, href: a.url, external: true },
                ]}
              />
            </div>
          </div>
        ))
      )}

      {publications.length > 0 ? (
        <div className="flex flex-col gap-y-2 px-6 py-3">
          <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
            {t("widget.publication")}
          </Text>
          {publications.map((p) => (
            <div key={p.id} className="flex flex-col items-start gap-y-1">
              <span className="flex items-center gap-x-2">
                <PublicationStateBadge state={p.state} />
                <span className="font-mono text-ui-fg-muted txt-compact-xsmall">{p.sku}</span>
              </span>
              <ProblemList problems={p.missing} />
            </div>
          ))}
        </div>
      ) : null}
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default OlxProductAdvertsWidget
