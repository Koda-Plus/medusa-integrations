import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  ArrowUpRightMini,
  ArrowUturnLeft,
  Cash,
  CheckCircle,
  DocumentText,
  ExclamationCircle,
  HandTruck,
  ListBullet,
  MapPin,
  PaperPlane,
  TruckFast,
  XCircle,
} from "@medusajs/icons"
import { Copy, Text, clx } from "@medusajs/ui"
import type { ProblemDto, SenderProblemDto, ShipmentDto, ShipmentFilter, ShipmentStage, ShipmentState, StatusResponse } from "../../modules/dpd/lib/contract"
import { ToneBadge, type Tone } from "./dpd-blocks"
import { nb } from "./dpd-guide"

export function fmtDateTime(value: string | null | undefined, lang: string): string {
  if (!value) return ""
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ")
  }
}

export function fmtNumber(value: unknown, lang: string): string {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "0"
  try {
    return new Intl.NumberFormat(lang).format(n)
  } catch {
    return String(n)
  }
}

/** "199.99" and "PLN" in the admin's format: "199,99 zł" or "PLN 199.99". */
export function fmtMoney(amount: string | null | undefined, currency: string | null | undefined, lang: string): string {
  if (amount === null || amount === undefined || amount === "") return ""
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: (currency || "PLN").toUpperCase() }).format(n)
  } catch {
    return `${amount} ${currency ?? ""}`.trim()
  }
}

/** The mode of the plugin in one word, for the header badge: demo, not configured, sandbox or live. */
export function modeOf(s: StatusResponse | undefined): { key: "demo" | "sandbox" | "live" | "notConfigured" | "unknown"; tone: Exclude<Tone, "purple"> } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "blue" }
  if (!s.configured) return { key: "notConfigured", tone: "orange" }
  if (s.mode === "sandbox") return { key: "sandbox", tone: "orange" }
  return { key: "live", tone: "green" }
}

/** The icon of each list, the same on the counters under the header and on the filter buttons. */
export const GROUP_ICON: Record<ShipmentFilter, ReactNode> = {
  all: <ListBullet />,
  to_create: <PaperPlane />,
  labeled: <DocumentText />,
  handed_over: <HandTruck />,
  in_transit: <TruckFast />,
  delivered: <CheckCircle />,
  problems: <ExclamationCircle />,
  canceled: <XCircle />,
  returns: <ArrowUturnLeft />,
}

/* One meaning per colour: orange waits for a person, red went wrong, green is done. */
const STATE_TONE: Record<ShipmentState, Tone> = {
  pending: "orange",
  creating: "blue",
  created: "blue",
  labeling: "blue",
  labeled: "green",
  failed: "red",
  unknown: "red",
  ambiguous: "red",
  abandoned_unknown: "red",
  skipped: "grey",
  canceled: "grey",
}

const STAGE_TONE: Record<ShipmentStage, Tone> = {
  preparing: "blue",
  ready: "blue",
  in_transit: "blue",
  in_point: "blue",
  delivered: "green",
  problem: "red",
  returned: "red",
  canceled: "grey",
}

/** One badge for a row: the state of the row until DPD reports the parcel, then where the parcel is. */
export function ShipmentStatus({ shipment }: { shipment: Pick<ShipmentDto, "state" | "stage" | "status"> }) {
  const { t } = useTranslation("dpd")
  if (shipment.state === "labeled" && shipment.stage) {
    return (
      <ToneBadge tone={STAGE_TONE[shipment.stage]} title={shipment.status ?? undefined}>
        {t(`stage.${shipment.stage}`)}
      </ToneBadge>
    )
  }
  return <ToneBadge tone={STATE_TONE[shipment.state]}>{t(`state.${shipment.state}`)}</ToneBadge>
}

/** Courier, Pickup point or return, and cash on delivery. */
export function KindBadges({ shipment }: { shipment: Pick<ShipmentDto, "kind" | "optionKind" | "cod"> }) {
  const { t } = useTranslation("dpd")
  const kind = shipment.kind === "return" ? "return" : shipment.optionKind
  return (
    <span className="flex flex-wrap items-center gap-1">
      {kind ? (
        <ToneBadge icon={kind === "pickup" ? <MapPin /> : kind === "return" ? <ArrowUturnLeft /> : <TruckFast />}>{t(`kind.${kind}`)}</ToneBadge>
      ) : (
        <ToneBadge>{t("kind.unknown")}</ToneBadge>
      )}
      {shipment.cod ? (
        <ToneBadge tone="blue" icon={<Cash />}>
          {t("kind.cod")}
        </ToneBadge>
      ) : null}
    </span>
  )
}

/** Where the parcel goes: the Pickup point, the order's address (not kept here), or back to the store. */
export function Destination({ shipment }: { shipment: Pick<ShipmentDto, "kind" | "optionKind" | "pudoId" | "country"> }) {
  const { t } = useTranslation("dpd")
  if (shipment.kind === "return") {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        {t("shipments.toStore")}
      </Text>
    )
  }
  if (shipment.optionKind === "pickup") {
    return shipment.pudoId ? (
      <span className="flex flex-col">
        <span className="txt-compact-small-plus font-mono text-ui-fg-base">{shipment.pudoId}</span>
        <span className="txt-compact-xsmall text-ui-fg-subtle">{t("shipments.point", { country: shipment.country ?? "" })}</span>
      </span>
    ) : (
      <ToneBadge tone="red" icon={<MapPin />}>
        {t("shipments.noPoint")}
      </ToneBadge>
    )
  }
  return (
    <Text size="small" className="text-ui-fg-subtle">
      {shipment.country ? t("shipments.toAddressIn", { country: shipment.country }) : t("shipments.toAddress")}
    </Text>
  )
}

/** The Medusa mark (the hexagon of the admin's own login screen), in the text colour. */
export function MedusaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 38" fill="none" aria-hidden className={className}>
      <path
        d="M30.85 6.16832L22.2453 1.21782C19.4299 -0.405941 15.9801 -0.405941 13.1648 1.21782L4.52043 6.16832C1.74473 7.79208 0 10.802 0 14.0099V23.9505C0 27.198 1.74473 30.1683 4.52043 31.7921L13.1251 36.7822C15.9405 38.4059 19.3903 38.4059 22.2056 36.7822L30.8103 31.7921C33.6257 30.1683 35.3307 27.198 35.3307 23.9505V14.0099C35.41 10.802 33.6653 7.79208 30.85 6.16832ZM17.6852 27.8317C12.8079 27.8317 8.8426 23.8713 8.8426 19C8.8426 14.1287 12.8079 10.1683 17.6852 10.1683C22.5625 10.1683 26.5674 14.1287 26.5674 19C26.5674 23.8713 22.6022 27.8317 17.6852 27.8317Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** The Medusa order of a row, one click away; a return without its order yet shows a dash. */
export function OrderCell({ orderId, displayId }: { orderId: string | null; displayId: number | null }) {
  const { t } = useTranslation("dpd")
  if (!orderId) return <span className="text-ui-fg-muted">-</span>
  return (
    <Link to={`/orders/${orderId}`} className="group flex items-center gap-x-2.5" title={t("actions.openOrder")}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ui-bg-component shadow-borders-base transition-fg group-hover:bg-ui-bg-component-hover">
        <MedusaMark className="h-3.5 w-3.5 text-ui-fg-base" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="txt-compact-small-plus truncate text-ui-fg-base group-hover:text-ui-fg-interactive">{displayId !== null ? `#${displayId}` : orderId}</span>
        <span className="txt-compact-xsmall-plus inline-flex items-center gap-x-0.5 whitespace-nowrap text-ui-fg-interactive">
          {t("actions.openOrder")}
          <ArrowUpRightMini />
        </span>
      </span>
    </Link>
  )
}

/** The waybill of each box with a copy button; two are shown, the rest as "+n". */
export function WaybillCell({ shipment }: { shipment: Pick<ShipmentDto, "waybills" | "demo"> }) {
  const { t } = useTranslation("dpd")
  if (shipment.waybills.length === 0) return <span className="text-ui-fg-muted">&nbsp;</span>
  const shown = shipment.waybills.slice(0, 2)
  const more = shipment.waybills.length - shown.length
  return (
    <span className="flex flex-col gap-y-0.5">
      {shown.map((w) => (
        <span key={w} className="flex items-center gap-x-1">
          <span className="txt-compact-small font-mono text-ui-fg-subtle" title={shipment.demo ? t("shipments.sampleWaybill") : undefined}>
            {w}
          </span>
          <Copy content={w} className="text-ui-fg-muted" />
        </span>
      ))}
      {more > 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t("shipments.moreWaybills", { count: more })}
        </Text>
      ) : null}
    </span>
  )
}

/** Problems of a row, translated; an unknown code falls back to the code and its detail. */
export function ProblemList({ items }: { items: ProblemDto[] }) {
  const { t, i18n } = useTranslation("dpd")
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-y-0.5">
      {items.map((p, i) => {
        const key = `problem.${p.code}`
        const text = i18n.exists(key, { ns: "dpd" }) ? t(key, { detail: p.detail ?? p.field ?? "" }) : nb(`${p.code}${p.detail ? `: ${p.detail}` : ""}`)
        return (
          <li key={`${p.code}-${i}`} className="flex gap-x-1.5">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ui-tag-red-icon" />
            <Text size="xsmall" className="text-ui-fg-subtle">
              {text}
            </Text>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A sender problem in plain words: who (the sender, the orderer, the sender
 * of a stock location), which field, what is wrong.
 */
export function useSenderProblemText(): (p: SenderProblemDto) => string {
  const { t } = useTranslation("dpd")
  return (p) => {
    if (p.code === "missing") return t("sender.problem.missing")
    const parts = p.path.split(".")
    const location = parts[0] === "senders" ? (parts[1] ?? "") : ""
    const field = (parts[0] === "senders" ? parts[2] : parts[1]) ?? ""
    const who = parts[0] === "senders" ? t("sender.who.location", { location }) : parts[0] === "orderer" ? t("sender.who.orderer") : t("sender.who.sender")
    const fieldName = field ? t(`sender.fields.${field}`, { defaultValue: field }) : who
    return t(`sender.problem.${p.code}`, { who, field: fieldName, max: p.max ?? 0 })
  }
}

/** A label over a value, for facts in sections and cards. */
export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-small text-ui-fg-base", mono && "break-all font-mono")}>{children}</div>
    </div>
  )
}
