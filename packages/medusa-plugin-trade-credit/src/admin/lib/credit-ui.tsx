import { useTranslation } from "react-i18next"
import { ToneBadge } from "./credit-blocks"

export function fmtMoney(amount: number | null | undefined, currency: string | null | undefined, lang?: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "-"
  const code = (currency || "PLN").toUpperCase()
  try {
    return new Intl.NumberFormat((lang ?? "en").startsWith("pl") ? "pl-PL" : "en-GB", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

/** Sample data (demo mode): the one purple badge, a highlight and never a state. */
export function SampleBadge() {
  const { t } = useTranslation("credit")
  return <ToneBadge tone="purple">{t("mode.demo")}</ToneBadge>
}
