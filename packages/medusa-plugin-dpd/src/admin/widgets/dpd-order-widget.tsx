import { useState, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { ArchiveBox, History as HistoryIcon, TruckFast } from "@medusajs/icons"
import { Button, Heading, Text } from "@medusajs/ui"
import { STATUS_HISTORY_ACTIONS, type DispatchDto, type EventDto, type ShipmentDto, type StatusSource, type WriterDto } from "../../modules/dpd/lib/contract"
import { WRITER_OPTION } from "../../modules/dpd/lib/writers"
import { useDpdOrder, useDpdStatus } from "../lib/dpd-api"
import { EmptyState, ToneBadge } from "../lib/dpd-blocks"
import { nb } from "../lib/dpd-guide"
import { DpdIcon, DpdMark } from "../lib/dpd-icon"
import { KitLoading, WidgetFrame, hostable } from "../lib/dpd-kit"
import { DispatchBadges, useCourierText } from "../lib/dpd-dispatch"
import { customerChoseOther, latestProtocol } from "../lib/dpd-logic"
import { PlanDrawer, ShipmentActionBar } from "../lib/dpd-plan"
import { Destination, ErrorText, KindBadges, ProblemList, ShipmentStatus, StatusLine, TrackingList, WaybillCell, WriterErrorText, fmtDateTime, fmtMoney } from "../lib/dpd-ui"

/**
 * Order page, side column: the DPD option the customer chose (courier or
 * Pickup point, cash on delivery, the point id), then each DPD shipment or
 * return of the order with its state, waybills, cash on delivery, problems
 * and history, with the actions of each shipment and the same plan drawer as
 * the Panel; a shipment in a handover shows the handover, its protocol and
 * its courier, one click from the handover drawer of the Panel. Once DPD
 * reports the parcel, each shipment shows its stage, the last DPD event in
 * words, its waybills with their stages and what the plugin wrote to Medusa.
 * Hidden on orders that do not go with DPD.
 *
 * A host (an app that shows every integration as tabs of one card) embeds it
 * with `embedded`: no frame and header of its own, a line while loading and
 * an empty state instead of nothing.
 */
const DpdOrderCard = ({ data, embedded }: DetailWidgetProps<AdminOrder> & { embedded?: boolean }) => {
  const { t, i18n } = useTranslation("dpd")
  const lang = i18n.language || "en"
  const q = useDpdOrder(data.id)
  /* Where the statuses come from (GET /admin/dpd, the query the page keeps); the order answer does not carry it. */
  const status = useDpdStatus()
  const navigate = useNavigate()
  /* The shipment whose plan is open in the drawer. */
  const [planFor, setPlanFor] = useState<string | null>(null)
  const info = q.data
  if (q.isLoading) return embedded ? <KitLoading label={t("widget.loading")} /> : null
  if (!info) return embedded ? <EmptyState compact icon={<TruckFast />} title={t("widget.failed")} /> : null
  if (!info.chosen && info.shipments.length === 0) return embedded ? <EmptyState compact icon={<TruckFast />} title={t("widget.notDpd")} /> : null
  const chosen = info.chosen

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-2">
            <DpdMark size="card" />
            <Heading level="h2">{t("widget.title")}</Heading>
            {info.mode === "demo" ? <ToneBadge tone="blue">{t("demo.badge")}</ToneBadge> : null}
          </div>
          <Link to={`/dpd?q=${data.display_id ?? ""}`} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.more")}
          </Link>
        </div>
      }
    >
      {embedded && info.mode === "demo" ? (
        <div className="px-6 py-2">
          <ToneBadge tone="blue">{t("demo.badge")}</ToneBadge>
        </div>
      ) : null}

      {chosen ? (
        <div className="flex flex-col gap-y-2 px-6 py-4">
          <div className="flex items-center justify-between gap-2">
            <Text size="small" weight="plus" className="text-ui-fg-base">
              {t("widget.chosen")}
            </Text>
            <KindBadges shipment={{ kind: chosen.optionKind === "return" ? "return" : "outbound", optionKind: chosen.optionKind, cod: chosen.cod }} />
          </div>
          {chosen.methodName ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {chosen.methodName}
            </Text>
          ) : null}
          <Destination shipment={{ kind: "outbound", optionKind: chosen.optionKind, pudoId: chosen.pudoId, country: chosen.country }} />
        </div>
      ) : null}

      {info.shipments.length === 0 ? (
        <EmptyState
          compact
          icon={<ArchiveBox />}
          title={!info.configured ? t("widget.notConfigured") : t("widget.none")}
          points={info.configured ? [{ icon: <TruckFast />, text: t("widget.noneHint") }] : undefined}
        />
      ) : (
        info.shipments.map((s) => (
          <ShipmentBlock
            key={s.id}
            shipment={s}
            lang={lang}
            writerArmed={info.writers.shipment.armed}
            writerAllowed={info.writers.shipment.allowed}
            pickupWriter={info.writers.pickup}
            dispatch={s.dispatchId ? info.dispatches.find((d) => d.id === s.dispatchId) : undefined}
            chosenPudoId={chosen?.pudoId ?? null}
            onPlan={() => setPlanFor(s.id)}
            onOpenDispatch={(id) => navigate(`/dpd?dispatch=${encodeURIComponent(id)}`)}
            events={info.events.filter((e) => e.shipmentId === s.id)}
            statusSource={status.data?.statuses.source ?? null}
            statusWriter={info.writers.fulfillmentStatus}
          />
        ))
      )}
      {planFor ? <PlanDrawer shipmentId={planFor} lang={lang} writer={info.writers.shipment} onClose={() => setPlanFor(null)} onSettings={() => navigate("/dpd?view=settings&tab=writers")} /> : null}
    </WidgetFrame>
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

function ShipmentBlock({
  shipment: s,
  lang,
  writerArmed,
  writerAllowed,
  pickupWriter,
  dispatch,
  chosenPudoId,
  onPlan,
  onOpenDispatch,
  events,
  statusSource,
  statusWriter,
}: {
  shipment: ShipmentDto
  lang: string
  writerArmed: boolean
  /** The options allow the shipment writer: when not, arming it would not help and the badge says so. */
  writerAllowed: boolean
  /** The pickup writer: taking the shipment out of an ordered handover changes the courier order. */
  pickupWriter: WriterDto
  /** The handover the shipment is in, from the order card (undefined when free). */
  dispatch: DispatchDto | undefined
  /** Opens the handover in the drawer of the Panel. */
  onOpenDispatch: (id: string) => void
  /** The Pickup point of the customer's order; the shipment may go to another one after a change in the admin. */
  chosenPudoId: string | null
  onPlan: () => void
  events: EventDto[]
  /** Where statuses come from; null while GET /admin/dpd loads. */
  statusSource: StatusSource | null
  /** The fulfillment status writer: writing the status to Medusa again needs it armed. */
  statusWriter: WriterDto
}) {
  const { t } = useTranslation("dpd")
  const courierText = useCourierText()
  const [showHistory, setShowHistory] = useState(false)
  /* The order keeps the customer's point; a person may have changed the shipment's since. */
  const chose = customerChoseOther(chosenPudoId, s)
  const protocol = dispatch ? latestProtocol(dispatch) : null
  /* The waybills with their stages once DPD said something of one, or moved the parcel; before that the plain numbers. */
  const tracked = s.tracking.some((e) => e.lastCode !== null || e.supersededBy !== null || e.from !== null)
  return (
    <div className="flex flex-col gap-y-3 px-6 py-4">
      <div className="flex items-center justify-between gap-x-2">
        <KindBadges shipment={s} />
        <ShipmentStatus shipment={s} />
      </div>
      <StatusLine shipment={s} lang={lang} source={statusSource} />
      {s.optionKind === "pickup" || s.kind === "return" ? (
        <Line label={t("widget.destination")}>
          <span className="flex flex-col items-end gap-y-0.5">
            <Destination shipment={s} />
            {chose ? (
              <Text size="xsmall" className="text-ui-tag-orange-text">
                {t("pudo.customerChose", { id: chose })}
              </Text>
            ) : null}
          </span>
        </Line>
      ) : null}
      {s.waybills.length > 0 || tracked ? (
        <Line label={t("widget.waybills")}>{tracked ? <TrackingList shipment={s} lang={lang} /> : <WaybillCell shipment={s} />}</Line>
      ) : null}
      {s.codAmount ? (
        <Line label={t("widget.cod")}>
          <Text size="small" className="tabular-nums">
            {fmtMoney(s.codAmount, s.currency, lang)}
          </Text>
        </Line>
      ) : null}
      {s.handedOverAt ? (
        <Line label={t("widget.handedOver")}>
          <Text size="small">{fmtDateTime(s.handedOverAt, lang)}</Text>
        </Line>
      ) : null}
      {s.shippedMarkedAt ? (
        <Line label={t("statuses.markedShipped")}>
          <Text size="small">{fmtDateTime(s.shippedMarkedAt, lang)}</Text>
        </Line>
      ) : null}
      {s.deliveredMarkedAt ? (
        <Line label={t("statuses.markedDelivered")}>
          <Text size="small">{fmtDateTime(s.deliveredMarkedAt, lang)}</Text>
        </Line>
      ) : null}
      {dispatch ? (
        <>
          <Line label={t("widget.dispatch")}>
            <DispatchBadges dispatch={dispatch} />
          </Line>
          <Line label={t("widget.protocol")}>
            <Text size="small" className={protocol ? undefined : "text-ui-fg-muted"}>
              {protocol ? fmtDateTime(protocol.createdAt, lang) : t("widget.protocolNone")}
            </Text>
          </Line>
          <Line label={t("widget.courier")}>
            <Text size="small" className={dispatch.pickupDate ? undefined : "text-ui-fg-muted"}>
              {courierText(dispatch, lang, { window: "widget.courierWindow", none: "widget.courierNone" })}
            </Text>
          </Line>
          <Button size="small" variant="secondary" className="w-fit" onClick={() => onOpenDispatch(dispatch.id)}>
            <TruckFast />
            {t("actions.openDispatch")}
          </Button>
        </>
      ) : null}
      {s.state === "excluded" ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("integration.order.excluded")}
        </Text>
      ) : null}
      <ErrorText shipment={s} />
      <WriterErrorText shipment={s} />
      {s.problems.length > 0 ? <ProblemList items={s.problems} /> : null}
      {s.state === "pending" ? (
        <ToneBadge tone="orange" title={writerAllowed ? undefined : t("writers.blockedHint", { option: `${WRITER_OPTION.shipment}: true` })}>
          {!writerAllowed ? t("actionError.writer_off") : writerArmed ? t("widget.toCreate") : t("widget.waitingForArm")}
        </ToneBadge>
      ) : null}
      <ShipmentActionBar
        shipment={s}
        writerArmed={writerArmed}
        writer={{ allowed: writerAllowed }}
        onPlan={onPlan}
        pickupWriter={pickupWriter}
        dispatch={dispatch}
        onOpenDispatch={onOpenDispatch}
        statusSource={statusSource}
        statusWriter={statusWriter}
      />
      {events.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="small" variant="transparent" onClick={() => setShowHistory(!showHistory)}>
            <HistoryIcon />
            {showHistory ? t("widget.hideHistory") : t("widget.showHistory", { count: events.length })}
          </Button>
        </div>
      ) : null}
      {showHistory ? <History events={events} lang={lang} /> : null}
    </div>
  )
}

const STATUS_ACTIONS: readonly string[] = STATUS_HISTORY_ACTIONS

/**
 * The history of one shipment, newest first: what DPD reported and what a
 * person or the plugin did. A DPD status shows the DPD description, its code
 * and waybill, and whether it was simulated; a status action of the plugin
 * (a refresh, a repin, a write to Medusa) its own words.
 */
function History({ events, lang }: { events: EventDto[]; lang: string }) {
  const { t } = useTranslation("dpd")
  const sorted = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  return (
    <ul className="flex flex-col gap-y-2 border-l border-ui-border-base pl-3">
      {sorted.map((e) => {
        const statusAction = e.kind === "action" && e.action !== null && STATUS_ACTIONS.includes(e.action)
        const ref = e.kind === "status" ? [e.status, e.waybill].filter((p): p is string => Boolean(p)).join(" / ") : ""
        return (
          <li key={e.id} className="flex flex-col">
            <Text size="xsmall" className="text-ui-fg-muted">
              {fmtDateTime(e.occurredAt, lang)}
              {e.actor ? ` / ${e.actor === "system" ? t("history.system") : e.actor}` : ""}
            </Text>
            <Text size="small" className="text-ui-fg-base">
              {statusAction ? t(`history.status.${e.action}`) : e.message ? nb(e.message) : e.status ? e.status : t(`history.kinds.${e.kind}`, { defaultValue: e.kind })}
            </Text>
            {ref || (e.kind === "status" && e.source === "simulated") ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {ref ? (
                  <Text size="xsmall" className="font-mono text-ui-fg-muted">
                    {ref}
                  </Text>
                ) : null}
                {e.kind === "status" && e.source === "simulated" ? <ToneBadge tone="blue">{t("statuses.simulated")}</ToneBadge> : null}
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default hostable({ id: "dpd.order", ns: "dpd", zone: "order.details", name: "DPD", order: 41, Icon: DpdIcon, hideWhenNone: true }, DpdOrderCard)
