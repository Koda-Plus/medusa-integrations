import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { errorMessage, useBaseLinkerOrder, useBaseLinkerSend } from "../lib/baselinker-api"
import { BaseLinkerIcon } from "../lib/baselinker-icon"
import { OrderStatusBadge, fmtDateTime } from "../lib/baselinker-ui"

/**
 * Order page, side column: the BaseLinker order of this order, its status in
 * BaseLinker, the tracking link, and "Send to BaseLinker now" or "Send again".
 */
const BaseLinkerOrderWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { t, i18n } = useTranslation("baselinker")
  const lang = i18n.language || "en"
  const q = useBaseLinkerOrder(data.id)
  const send = useBaseLinkerSend()
  const info = q.data
  const row = info?.order ?? null
  const canceled = data.status === "canceled"

  const onSend = async () => {
    try {
      await send.mutateAsync(data.id)
      toast.success(t("toast.sent"))
      void q.refetch()
    } catch (err) {
      toast.error(t("toast.error", { error: errorMessage(err) }))
    }
  }

  const showSend = Boolean(info?.canSend) && !canceled && (!row || row.status === "failed" || (row.status === "pending" && row.attempts > 0))

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <BaseLinkerIcon width={18} height={18} className="shrink-0" />
          <Heading level="h2">{t("widget.title")}</Heading>
          {info?.mode === "demo" ? (
            <Badge size="2xsmall" color="purple">
              {t("widget.demo")}
            </Badge>
          ) : null}
        </div>
        <Link to="/baselinker" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("widget.more")}
        </Link>
      </div>

      {q.isLoading ? null : (
        <>
          {!row ? (
            <div className="px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle">
                {!info?.exportOrders ? t("widget.exportOff") : !info?.canSend ? t("widget.notConfigured") : t("widget.none")}
              </Text>
            </div>
          ) : (
            <div className="flex flex-col gap-y-3 px-6 py-4">
              <div className="flex items-center justify-between gap-x-2">
                <Text size="small" className="text-ui-fg-subtle">
                  {t("widget.status")}
                </Text>
                <OrderStatusBadge status={row.status} />
              </div>
              {row.blOrderId ? (
                <div className="flex items-center justify-between gap-x-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    {t("widget.blOrder")}
                  </Text>
                  <span className="text-right">
                    <span className="font-mono txt-compact-small-plus">{row.blOrderId}</span>
                    {row.blStatusName ? <span className="block text-ui-fg-subtle txt-compact-xsmall">{row.blStatusName}</span> : null}
                  </span>
                </div>
              ) : null}
              {row.trackingNumber ? (
                <div className="flex items-center justify-between gap-x-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    {t("widget.tracking")}
                  </Text>
                  {row.trackingUrl ? (
                    <a
                      href={row.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-x-1 text-right text-ui-fg-interactive hover:text-ui-fg-interactive-hover txt-compact-small"
                    >
                      <span>
                        {row.carrier ? `${row.carrier} ` : ""}
                        <span className="font-mono">{row.trackingNumber}</span>
                      </span>
                      <ArrowUpRightOnBox className="shrink-0" />
                    </a>
                  ) : (
                    <span className="txt-compact-small">
                      {row.carrier ? `${row.carrier} ` : ""}
                      <span className="font-mono">{row.trackingNumber}</span>
                    </span>
                  )}
                </div>
              ) : null}
              {row.sentAt ? (
                <div className="flex items-center justify-between gap-x-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    {t("widget.sentAt")}
                  </Text>
                  <Text size="small">{fmtDateTime(row.sentAt, lang)}</Text>
                </div>
              ) : null}
              {row.fulfilledAt && row.lastErrorCode !== "fulfillment_skipped" ? (
                <div className="flex items-center justify-between gap-x-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    {t("widget.fulfilledAt")}
                  </Text>
                  <Text size="small">{fmtDateTime(row.fulfilledAt, lang)}</Text>
                </div>
              ) : null}
              {row.status === "pending" && row.attempts === 0 ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("widget.queued")}
                </Text>
              ) : null}
              {row.lastError ? (
                <Text size="xsmall" className={row.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-muted"}>
                  {row.lastError}
                </Text>
              ) : null}
            </div>
          )}

          {showSend ? (
            <div className="px-6 py-4">
              <Button size="small" variant="secondary" isLoading={send.isPending} onClick={() => void onSend()}>
                {row ? t("actions.sendAgain") : t("actions.sendNow")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default BaseLinkerOrderWidget
