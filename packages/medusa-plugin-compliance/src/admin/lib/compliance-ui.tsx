import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Text, clx } from "@medusajs/ui"
import type { DsrStatus, OperatorKind } from "../../modules/compliance/lib/constants"

/** A price in the store's units (the same units as `price.amount`, major units in the demo). */
export function fmtAmount(amount: number | null | undefined, currency: string | null | undefined, lang?: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "-"
  const code = (currency || "PLN").toUpperCase()
  try {
    return new Intl.NumberFormat((lang ?? "en").startsWith("pl") ? "pl-PL" : "en-GB", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

export function StatTile({ label, value, tone = "default", onClick }: { label: string; value: ReactNode; tone?: "default" | "green" | "orange" | "red" | "blue" | "purple"; onClick?: () => void }) {
  const color = tone === "green" ? "text-ui-tag-green-text" : tone === "orange" ? "text-ui-tag-orange-text" : tone === "red" ? "text-ui-tag-red-text" : tone === "blue" ? "text-ui-tag-blue-text" : tone === "purple" ? "text-ui-tag-purple-text" : "text-ui-fg-base"
  const content = (
    <div className={clx("rounded-lg border border-ui-border-base bg-ui-bg-subtle px-4 py-3", onClick ? "cursor-pointer transition-fg hover:bg-ui-bg-base-hover" : "")}>
      <Text size="xsmall" className="truncate text-ui-fg-muted">
        {label}
      </Text>
      <Text size="large" weight="plus" className={clx("mt-0.5 tabular-nums", color)}>
        {value}
      </Text>
    </div>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="text-left">
      {content}
    </button>
  ) : (
    content
  )
}

export function SampleBadge() {
  const { t } = useTranslation("compliance")
  return (
    <Badge size="2xsmall" color="purple">
      {t("mode.demo")}
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: OperatorKind }) {
  const { t } = useTranslation("compliance")
  return (
    <Badge size="2xsmall" color={kind === "manufacturer" ? "blue" : "grey"}>
      {t(`kind.${kind}`)}
    </Badge>
  )
}

export function DsrStatusBadge({ status }: { status: DsrStatus }) {
  const { t } = useTranslation("compliance")
  const color = status === "completed" ? "green" : status === "rejected" ? "red" : status === "in_progress" ? "orange" : "blue"
  return (
    <Badge size="2xsmall" color={color}>
      {t(`status.${status}`)}
    </Badge>
  )
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <Text size="small" className="px-6 py-4 text-ui-fg-subtle">
      {children}
    </Text>
  )
}
