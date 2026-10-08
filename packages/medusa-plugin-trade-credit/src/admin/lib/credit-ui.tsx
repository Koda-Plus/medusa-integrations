import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Text, clx } from "@medusajs/ui"

export function fmtMoney(amount: number | null | undefined, currency: string | null | undefined, lang?: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "-"
  const code = (currency || "PLN").toUpperCase()
  try {
    return new Intl.NumberFormat((lang ?? "en").startsWith("pl") ? "pl-PL" : "en-GB", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

export function StatTile({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "green" | "orange" | "red" | "blue" | "purple" }) {
  const color = tone === "green" ? "text-ui-tag-green-text" : tone === "orange" ? "text-ui-tag-orange-text" : tone === "red" ? "text-ui-tag-red-text" : tone === "blue" ? "text-ui-tag-blue-text" : tone === "purple" ? "text-ui-tag-purple-text" : "text-ui-fg-base"
  return (
    <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle px-4 py-3">
      <Text size="xsmall" className="truncate text-ui-fg-muted">
        {label}
      </Text>
      <Text size="large" weight="plus" className={clx("mt-0.5 tabular-nums", color)}>
        {value}
      </Text>
    </div>
  )
}

export function SampleBadge() {
  const { t } = useTranslation("credit")
  return (
    <Badge size="2xsmall" color="purple">
      {t("mode.demo")}
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
