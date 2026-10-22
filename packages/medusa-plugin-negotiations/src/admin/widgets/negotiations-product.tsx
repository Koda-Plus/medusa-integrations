import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox, ChatBubbleLeftRight } from "@medusajs/icons"
import { Button, Heading, Text } from "@medusajs/ui"
import { useProductNegotiations } from "../lib/negotiations-api"
import { EmptyState, ToneBadge } from "../lib/negotiations-blocks"
import { NegotiationsIcon } from "../lib/negotiations-icon"
import { KitLoading, WidgetFrame } from "../lib/negotiations-kit"
import { DemoBadge, NegotiationStatusBadge, WaitingDot, customerLine, fmtMoney, fmtNumber, fmtRelative } from "../lib/negotiations-ui"

/**
 * Product page, side column: the latest negotiations about this product,
 * the ones waiting for the team marked, each opening its thread on the
 * Negotiations page. Nothing to show, a single phrase says so. Links are
 * plain anchors: a react-router Link inside a widget breaks in some admins.
 */
const NegotiationsProductWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const { t, i18n } = useTranslation("negotiations")
  const lang = i18n.language || "en"
  const q = useProductNegotiations(data.id)
  const threads = q.data?.threads ?? []
  const waiting = threads.filter((n) => n.waitingFor === "team").length

  return (
    <WidgetFrame
      header={
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
          <div className="flex items-center gap-x-2">
            <NegotiationsIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.product.title")}</Heading>
            {q.data?.mode === "demo" ? <DemoBadge /> : null}
            {waiting > 0 ? <ToneBadge tone="orange">{t("waitingBadge", { count: waiting })}</ToneBadge> : null}
          </div>
          <Button size="small" variant="secondary" asChild>
            <a href="/app/negotiations">
              <ArrowUpRightOnBox />
              {t("widget.all")}
            </a>
          </Button>
        </div>
      }
    >
      {q.isLoading ? (
        <KitLoading />
      ) : threads.length === 0 ? (
        <EmptyState compact icon={<ChatBubbleLeftRight />} title={t("widget.product.empty")} />
      ) : (
        <ul className="flex flex-col divide-y divide-ui-border-base">
          {threads.slice(0, 5).map((n) => {
            const who = customerLine(n, t, lang)
            return (
              <li key={n.id}>
                <a href={`/app/negotiations?thread=${encodeURIComponent(n.id)}`} className="flex items-start gap-x-3 px-6 py-3 transition-fg hover:bg-ui-bg-component-hover">
                  <span className="pt-1.5">
                    <WaitingDot waiting={n.waitingFor === "team"} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-y-0.5">
                    <span className="flex items-center justify-between gap-x-2">
                      <Text size="small" weight="plus" leading="compact" className="truncate">
                        {who.main}
                      </Text>
                      <NegotiationStatusBadge status={n.status} />
                    </span>
                    <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
                      {n.ref} / {t("widget.product.line", { qty: fmtNumber(n.qty, lang), price: fmtMoney(n.price, n.currencyCode, lang) || "-" })}
                    </Text>
                    <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
                      {fmtRelative(n.lastActivityAt, lang)}
                    </Text>
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
      {(q.data?.count ?? 0) > 5 ? (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("widget.more", { count: (q.data?.count ?? 0) - 5 })}
          </Text>
        </div>
      ) : null}
    </WidgetFrame>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.side.after",
})

export default NegotiationsProductWidget
