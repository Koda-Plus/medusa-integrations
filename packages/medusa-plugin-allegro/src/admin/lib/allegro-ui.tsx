import { Badge, StatusBadge, Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type {
  AllegroMoneyDto,
  AllegroOfferDto,
  AllegroOrderDto,
  AllegroStatusGroup,
  AllegroStockState,
} from "../../modules/allegro/lib/contract"

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

export function fmtMoney(price: AllegroMoneyDto | null | undefined, lang: string): string {
  if (!price) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: price.currency, maximumFractionDigits: 2 }).format(price.value)
  } catch {
    return `${price.value} ${price.currency}`
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

const GROUP_COLOR: Record<AllegroStatusGroup, "green" | "blue" | "grey" | "orange"> = {
  live: "green",
  activating: "blue",
  draft: "orange",
  ended: "grey",
}

/** Allegro status as a dot badge; the raw Allegro status sits in the tooltip text. */
export function OfferStatus({ offer }: { offer: Pick<AllegroOfferDto, "status" | "statusGroup"> }) {
  const { t } = useTranslation("allegro")
  return (
    <span title={offer.status}>
      <StatusBadge color={GROUP_COLOR[offer.statusGroup]}>{t(`status.${offer.statusGroup}`)}</StatusBadge>
    </span>
  )
}

const STOCK_COLOR: Record<AllegroStockState, "red" | "orange" | "green" | "grey" | "blue" | "purple"> = {
  oversell: "red",
  sold_out: "red",
  under_listed: "blue",
  ended_in_stock: "orange",
  ok: "green",
  untracked: "grey",
  unknown: "grey",
}

/** Allegro quantity against the Medusa quantity, with the stock check label. */
export function StockCell({ offer }: { offer: AllegroOfferDto }) {
  const { t } = useTranslation("allegro")
  const allegro = offer.available ?? "?"
  return (
    <div className="flex flex-col items-start gap-y-1">
      <span className="tabular-nums txt-compact-small text-ui-fg-base">
        {allegro}
        {offer.variantId && offer.isPrimary ? (
          <span className="text-ui-fg-muted"> / {offer.medusaAvailable ?? "∞"}</span>
        ) : null}
      </span>
      {offer.stockState ? (
        <Badge size="2xsmall" color={STOCK_COLOR[offer.stockState]}>
          {t(`stock.${offer.stockState}`)}
        </Badge>
      ) : null}
    </div>
  )
}

const ORDER_COLOR: Record<AllegroOrderDto["group"], "green" | "orange" | "grey"> = {
  open: "orange",
  sent: "green",
  cancelled: "grey",
}

export function OrderStatus({ order }: { order: AllegroOrderDto }) {
  const { t } = useTranslation("allegro")
  const raw = [order.status, order.fulfillmentStatus].filter(Boolean).join(" / ")
  return (
    <div className="flex flex-col items-start gap-y-1" title={raw}>
      <StatusBadge color={ORDER_COLOR[order.group]}>{t(`orders.group.${order.group}`)}</StatusBadge>
      {order.fulfillmentStatus ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t(`orders.fulfillment.${order.fulfillmentStatus}`, { defaultValue: order.fulfillmentStatus })}
        </Text>
      ) : null}
    </div>
  )
}

export function KeyCell({ offer }: { offer: AllegroOfferDto }) {
  const { t } = useTranslation("allegro")
  if (!offer.matchKey) {
    return (
      <Text size="small" className="text-ui-fg-muted">
        {t("offers.noKey")}
      </Text>
    )
  }
  return <span className="font-mono text-ui-fg-base txt-compact-small">{offer.matchKey}</span>
}

export function StatTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string
  value: number
  tone?: "default" | "green" | "orange" | "red" | "blue"
  active?: boolean
  onClick?: () => void
}) {
  const dot =
    tone === "green"
      ? "bg-ui-tag-green-icon"
      : tone === "orange"
        ? "bg-ui-tag-orange-icon"
        : tone === "red"
          ? "bg-ui-tag-red-icon"
          : tone === "blue"
            ? "bg-ui-tag-blue-icon"
            : "bg-ui-fg-muted"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={clx(
        "flex h-full flex-col items-start justify-between gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
        "border-ui-border-base bg-ui-bg-component",
        onClick ? "hover:bg-ui-bg-component-hover cursor-pointer" : "cursor-default",
        active && "border-ui-border-interactive shadow-borders-interactive-with-active",
      )}
    >
      <span className="flex items-center gap-x-1.5">
        <span className={clx("h-1.5 w-1.5 rounded-full", dot)} />
        <Text size="xsmall" className="text-ui-fg-subtle">
          {label}
        </Text>
      </span>
      <Text size="xlarge" weight="plus" className="tabular-nums text-ui-fg-base">
        {value}
      </Text>
    </button>
  )
}
