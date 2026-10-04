import { Badge, StatusBadge, Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type { OlxAdvertDto, OlxStatusGroup } from "../../modules/olx/lib/contract"

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

export function fmtPrice(price: OlxAdvertDto["price"], lang: string): string {
  if (!price) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: price.currency, maximumFractionDigits: 2 }).format(
      price.value,
    )
  } catch {
    return `${price.value} ${price.currency}`
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

const GROUP_COLOR: Record<OlxStatusGroup, "green" | "orange" | "grey"> = {
  live: "green",
  limited: "orange",
  ended: "grey",
}

/** OLX status as a dot badge; the raw OLX status sits in the tooltip text. */
export function AdvertStatus({ advert }: { advert: Pick<OlxAdvertDto, "status" | "statusGroup"> }) {
  const { t } = useTranslation("olx")
  return (
    <span title={advert.status}>
      <StatusBadge color={GROUP_COLOR[advert.statusGroup]}>{t(`status.${advert.statusGroup}`)}</StatusBadge>
    </span>
  )
}

export function KeyCell({ advert }: { advert: OlxAdvertDto }) {
  const { t } = useTranslation("olx")
  if (!advert.matchKey) {
    return (
      <Text size="small" className="text-ui-fg-muted">
        {t("adverts.noKey")}
      </Text>
    )
  }
  return (
    <div className="flex flex-col items-start gap-y-1">
      <span className="font-mono text-ui-fg-base txt-compact-small">{advert.matchKey}</span>
      <Badge size="2xsmall" color={advert.matchSource === "external_id" ? "blue" : "purple"}>
        {advert.matchSource === "external_id" ? t("adverts.keyExternal") : t("adverts.keyDescription")}
      </Badge>
    </div>
  )
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
  tone?: "default" | "green" | "orange" | "red"
  active?: boolean
  onClick?: () => void
}) {
  const dot =
    tone === "green" ? "bg-ui-tag-green-icon" : tone === "orange" ? "bg-ui-tag-orange-icon" : tone === "red" ? "bg-ui-tag-red-icon" : "bg-ui-fg-muted"
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
