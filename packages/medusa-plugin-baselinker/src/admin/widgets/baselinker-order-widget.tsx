import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { Badge, Button, Heading, Text, toast } from "@medusajs/ui"
import type { ImportDto } from "../../modules/baselinker/lib/contract"
import { errorMessage, useBaseLinkerOrder, useBaseLinkerSend } from "../lib/baselinker-api"
import { BaseLinkerIcon } from "../lib/baselinker-icon"
import { WidgetFrame, hostable } from "../lib/baselinker-kit"
import { ImportStatusBadge, OrderStatusBadge, fmtDateTime } from "../lib/baselinker-ui"

/**
 * Order page, side column. For a store order: the BaseLinker order it became,
 * its status there, the tracking link, and "Send to BaseLinker now" or "Send
 * again". For a marketplace order this plugin imported from BaseLinker: where
 * it came from, the BaseLinker order, its status and parcel, and the payment
 * state; such an order never goes back. For a marketplace order another
 * plugin took straight from the marketplace: its reference, and why it is not
 * sent.
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame and header of its own, a line while loading, on
 * an error and when BaseLinker has nothing to say about the order.
 */
const BaseLinkerOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("baselinker")
  const lang = i18n.language || "en"
  const q = useBaseLinkerOrder(data.id)
  const send = useBaseLinkerSend()
  const info = q.data
  const row = info?.order ?? null
  const imported = info?.imported ?? null
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

  const showSend = !imported && Boolean(info?.canSend) && !canceled && (!row || row.status === "failed" || (row.status === "pending" && row.attempts > 0))

  if (q.isLoading) return embedded ? <Quiet>{t("widget.loading")}</Quiet> : null
  if (q.isError || !info) return <Quiet frame={!embedded}>{t("widget.failed")}</Quiet>
  if (embedded && !row && !imported && !info.marketplaceRef && !info.skipCode && !info.canSend) return <Quiet>{t("widget.none")}</Quiet>

  /* The page opens on this order: its import, or its row of the outbox. */
  const more = imported
    ? `/baselinker?section=imports&q=${encodeURIComponent(imported.blOrderId)}`
    : `/baselinker?section=orders&q=${encodeURIComponent(String(data.display_id ?? data.id))}`

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <BaseLinkerIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.title")}</Heading>
            {info.mode === "demo" ? (
              <Badge size="2xsmall" color="purple">
                {t("widget.demo")}
              </Badge>
            ) : null}
          </div>
          <Link to={more} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.more")}
          </Link>
        </div>
      }
    >
      {embedded && info.mode === "demo" ? (
        <div className="px-6 py-2">
          <Badge size="2xsmall" color="purple">
            {t("widget.demo")}
          </Badge>
        </div>
      ) : null}
      {imported ? (
        <ImportedOrder row={imported} lang={lang} />
      ) : (
        <>
          {!row ? (
            <div className="flex flex-col gap-y-3 px-6 py-4">
              {info.marketplaceRef ? (
                <>
                  <Line label={t("widget.marketplaceRef")}>
                    <span className="break-all font-mono txt-compact-small">{info.marketplaceRef}</span>
                  </Line>
                  {!info.canSend ? (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {t("widget.marketplaceNote")}
                    </Text>
                  ) : null}
                </>
              ) : null}
              {info.skipCode && info.skipCode !== "marketplace_order" ? (
                <Text size="small" className="text-ui-fg-subtle">
                  {t(`widget.skip.${info.skipCode}`, { defaultValue: t("widget.none") })}
                </Text>
              ) : !info.marketplaceRef || info.canSend ? (
                <Text size="small" className="text-ui-fg-subtle">
                  {!info.exportOrders ? t("widget.exportOff") : !info.canSend ? t("widget.notConfigured") : t("widget.none")}
                </Text>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-y-3 px-6 py-4">
              <Line label={t("widget.status")}>
                <OrderStatusBadge status={row.status} />
              </Line>
              {row.blOrderId ? (
                <Line label={t("widget.blOrder")}>
                  <span className="text-right">
                    <span className="font-mono txt-compact-small-plus">{row.blOrderId}</span>
                    {row.blStatusName ? <span className="block text-ui-fg-subtle txt-compact-xsmall">{row.blStatusName}</span> : null}
                  </span>
                </Line>
              ) : null}
              {row.trackingNumber ? (
                <Line label={t("widget.tracking")}>
                  <Tracking number={row.trackingNumber} url={row.trackingUrl} carrier={row.carrier} />
                </Line>
              ) : null}
              {row.sentAt ? (
                <Line label={t("widget.sentAt")}>
                  <Text size="small">{fmtDateTime(row.sentAt, lang)}</Text>
                </Line>
              ) : null}
              {row.fulfilledAt && row.lastErrorCode !== "fulfillment_skipped" ? (
                <Line label={t("widget.fulfilledAt")}>
                  <Text size="small">{fmtDateTime(row.fulfilledAt, lang)}</Text>
                </Line>
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
    </WidgetFrame>
  )
}

/** A quiet line instead of nothing: while loading, on an error, or when there is nothing to show. */
function Quiet({ children, frame = false }: { children: ReactNode; frame?: boolean }) {
  const body = (
    <div className="px-6 py-4">
      <Text size="small" className="text-ui-fg-subtle">
        {children}
      </Text>
    </div>
  )
  return frame ? <WidgetFrame header={null}>{body}</WidgetFrame> : body
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-x-2">
      <Text size="small" className="shrink-0 text-ui-fg-subtle">
        {label}
      </Text>
      {children}
    </div>
  )
}

function Tracking({ number, url, carrier }: { number: string; url: string | null; carrier: string | null }) {
  const text = (
    <span>
      {carrier ? `${carrier} ` : ""}
      <span className="font-mono">{number}</span>
    </span>
  )
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-x-1 text-right text-ui-fg-interactive hover:text-ui-fg-interactive-hover txt-compact-small">
      {text}
      <ArrowUpRightOnBox className="shrink-0" />
    </a>
  ) : (
    <span className="txt-compact-small">{text}</span>
  )
}

function ImportedOrder({ row, lang }: { row: ImportDto; lang: string }) {
  const { t } = useTranslation("baselinker")
  return (
    <div className="flex flex-col gap-y-3 px-6 py-4">
      <Line label={t("widget.imported", { source: row.source })}>
        <ImportStatusBadge status={row.status} />
      </Line>
      <Line label={t("widget.blOrder")}>
        <span className="text-right">
          <span className="font-mono txt-compact-small-plus">{row.blOrderId}</span>
          {row.blStatusName ? <span className="block text-ui-fg-subtle txt-compact-xsmall">{row.blStatusName}</span> : null}
        </span>
      </Line>
      {row.marketplaceRef ? (
        <Line label={t("widget.marketplaceRef")}>
          <span className="max-w-[60%] break-all text-right font-mono txt-compact-xsmall">{row.marketplaceRef}</span>
        </Line>
      ) : null}
      {row.paymentState ? (
        <Line label={t("widget.payment")}>
          <Text size="small">{t(`imports.payment.${row.paymentState}`, { defaultValue: row.paymentState })}</Text>
        </Line>
      ) : null}
      {row.trackingNumber ? (
        <Line label={t("widget.tracking")}>
          <Tracking number={row.trackingNumber} url={row.trackingUrl} carrier={row.carrier} />
        </Line>
      ) : null}
      {row.importedAt ? (
        <Line label={t("widget.importedAt")}>
          <Text size="small">{fmtDateTime(row.importedAt, lang)}</Text>
        </Line>
      ) : null}
      {row.flag ? (
        <Text size="xsmall" className="text-ui-tag-orange-text">
          {t(`imports.flags.${row.flag}`, { defaultValue: row.flag })}
        </Text>
      ) : null}
      {row.lastError && row.status !== "imported" ? (
        <Text size="xsmall" className={row.status === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-muted"}>
          {row.lastError}
        </Text>
      ) : null}
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("widget.importedNote")}
      </Text>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable(
  { id: "baselinker.order", ns: "baselinker", zone: "order.details", name: "BaseLinker", order: 60, Icon: BaseLinkerIcon, hideWhenNone: true },
  BaseLinkerOrderCard,
)
