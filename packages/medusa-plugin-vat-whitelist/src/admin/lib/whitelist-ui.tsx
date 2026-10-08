import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Text, clx } from "@medusajs/ui"
import type { CheckState } from "../../modules/whitelist/lib/constants"

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
  const { t } = useTranslation("whitelist")
  return (
    <Badge size="2xsmall" color="purple">
      {t("mode.demo")}
    </Badge>
  )
}

export function StateBadge({ state }: { state: CheckState }) {
  const { t } = useTranslation("whitelist")
  const color = state === "active" ? "green" : state === "exempt" ? "orange" : state === "unavailable" ? "grey" : "red"
  return (
    <Badge size="2xsmall" color={color}>
      {t(`state.${state}`)}
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
