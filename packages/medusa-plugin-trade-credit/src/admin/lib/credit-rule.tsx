import { useTranslation } from "react-i18next"
import { Buildings, Calendar, Cash, CheckCircle, ExclamationCircle, InformationCircle, LockClosedSolid, Receipt } from "@medusajs/icons"
import { InlineTip, Text } from "@medusajs/ui"
import type { ReactNode } from "react"
import type { RuleIcon, StatusResponse } from "../../modules/credit/lib/contract"
import { KeyPoints } from "./credit-guide"

const ICONS: Record<RuleIcon, ReactNode> = {
  debt: <Receipt />,
  calendar: <Calendar />,
  warning: <ExclamationCircle />,
  lock: <LockClosedSolid />,
  cash: <Cash />,
  salon: <Buildings />,
  info: <InformationCircle />,
  check: <CheckCircle />,
}

/**
 * How the store counts credit (store mode). Phrases with icons when the store
 * gives `rulePoints`, the store's sentence otherwise.
 */
export function StoreRule({ status }: { status: Pick<StatusResponse, "ruleText" | "rulePoints"> }) {
  const { t } = useTranslation("credit")
  const points = status.rulePoints ?? []
  if (points.length) {
    return (
      <div className="flex min-w-0 flex-col gap-y-1.5">
        <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
          {t("ui.rule")}
        </Text>
        <KeyPoints label={status.ruleText ?? t("ui.rule")} items={points.map((p) => ({ icon: ICONS[p.icon], text: p.text, tone: p.tone }))} />
      </div>
    )
  }
  if (!status.ruleText) return null
  return (
    <InlineTip variant="info" label={t("ui.rule")}>
      {status.ruleText}
    </InlineTip>
  )
}
