import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import type { ParcelDto } from "../../modules/inpost/lib/contract"
import { useInpostOrder } from "../lib/inpost-api"
import { InpostIcon } from "../lib/inpost-icon"
import { History, ParcelActions } from "../lib/inpost-plan"
import { KindBadges, LockerLines, ParcelStatus, ProblemList, TrackingCell, fmtDateTime, fmtMoney } from "../lib/inpost-ui"

/**
 * Order page, side column: the InPost option and the locker the customer
 * chose (with a map link), then each shipment of the order: its status, the
 * tracking number and link, the cash on delivery, the label, the plan and
 * "Create" (when the shipment writer is armed), the cancel while ShipX allows
 * it, a new locker before sending, and the history. Hidden on orders that do
 * not go with InPost.
 */
const InpostOrderWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const { t, i18n } = useTranslation("inpost")
  const lang = i18n.language || "en"
  const q = useInpostOrder(data.id)
  const info = q.data
  if (q.isLoading || !info) return null
  if (!info.chosen && info.parcels.length === 0) return null
  const chosen = info.chosen

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-2">
          <InpostIcon width={18} height={18} className="shrink-0" />
          <Heading level="h2">{t("widget.title")}</Heading>
          {info.mode === "demo" ? (
            <Badge size="2xsmall" color="purple">
              {t("demo.badge")}
            </Badge>
          ) : null}
        </div>
        <Link to="/inpost" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
          {t("widget.more")}
        </Link>
      </div>

      {chosen ? (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <div className="flex items-center justify-between gap-2">
            <Text size="small" weight="plus" className="text-ui-fg-base">
              {t("widget.chosen")}
            </Text>
            <KindBadges parcel={{ kind: chosen.kind, cod: chosen.cod, size: null }} />
          </div>
          {chosen.methodName ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {chosen.methodName}
            </Text>
          ) : null}
          {chosen.kind === "locker" ? (
            chosen.locker ? (
              <LockerLines locker={chosen.locker} />
            ) : (
              <Text size="small" className="text-ui-tag-red-text">
                {t("plan.noLocker")}
              </Text>
            )
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              {t("widget.courier")}
            </Text>
          )}
        </div>
      ) : null}

      {info.parcels.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {!info.configured ? t("widget.notConfigured") : t("widget.none")}
          </Text>
        </div>
      ) : (
        info.parcels.map((p) => <ParcelBlock key={p.id} parcel={p} lang={lang} writers={info.writers} events={info.events.filter((e) => e.parcelId === p.id)} />)
      )}
    </Container>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-x-3">
      <Text size="small" className="shrink-0 text-ui-fg-subtle">
        {label}
      </Text>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  )
}

function ParcelBlock({ parcel: p, lang, writers, events }: { parcel: ParcelDto; lang: string; writers: Parameters<typeof ParcelActions>[0]["writers"]; events: Parameters<typeof History>[0]["events"] }) {
  const { t } = useTranslation("inpost")
  const [showHistory, setShowHistory] = useState(false)
  return (
    <div className="flex flex-col gap-y-3 px-6 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <KindBadges parcel={p} />
        <ParcelStatus parcel={p} />
      </div>
      {p.locker && p.locker.code !== undefined && p.kind === "locker" ? (
        <Line label={t("detail.locker")}>
          <LockerLines locker={p.locker} />
        </Line>
      ) : null}
      {p.trackingNumber ? (
        <Line label={t("detail.tracking")}>
          <TrackingCell parcel={p} />
        </Line>
      ) : null}
      {p.codAmount ? (
        <Line label={t("detail.cod")}>
          <Text size="small" className="tabular-nums">
            {fmtMoney(p.codAmount, p.currency, lang)}
          </Text>
        </Line>
      ) : null}
      {p.statusAt ? (
        <Line label={t("widget.statusAt")}>
          <Text size="small">{fmtDateTime(p.statusAt, lang)}</Text>
        </Line>
      ) : null}
      {p.error && (p.state === "failed" || p.state === "unknown") ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {p.error}
        </Text>
      ) : null}
      {p.problems.length > 0 && (p.state === "pending" || p.state === "failed") ? <ProblemList items={p.problems} /> : null}
      {p.state === "pending" && !writers?.shipment?.armed ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("widget.waitingForArm")}
        </Text>
      ) : null}
      {p.fulfillmentCanceledAt && p.state === "created" ? (
        <Text size="xsmall" className="text-ui-tag-orange-text">
          {t("detail.fulfillmentCanceledText")}
        </Text>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? t("widget.hideHistory") : t("widget.showHistory", { count: events.length })}
        </button>
        <ParcelActions parcel={p} lang={lang} writers={writers} />
      </div>
      {showHistory ? <History events={events} lang={lang} /> : null}
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default InpostOrderWidget
