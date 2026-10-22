import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Text, clx } from "@medusajs/ui"
import type { CouponStatus } from "../../modules/coupons/lib/contract"
import type { SentenceFormat } from "./coupons-sentence"
import { ToneBadge, type Tone } from "./coupons-blocks"

/** Money and dates in the admin's language. */
export function useFormat(): SentenceFormat & { lang: string; number: (n: number) => string } {
  const { i18n } = useTranslation("coupons")
  const lang = (i18n.language || "en").startsWith("pl") ? "pl-PL" : "en-GB"
  return {
    lang,
    money: (n: number, currency: string) => {
      try {
        return new Intl.NumberFormat(lang, { style: "currency", currency: (currency || "PLN").toUpperCase(), maximumFractionDigits: 2 }).format(n || 0)
      } catch {
        return `${(n || 0).toFixed(2)} ${(currency || "").toUpperCase()}`
      }
    },
    date: (iso: string) => new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)),
    number: (n: number) => new Intl.NumberFormat(lang).format(n || 0),
  }
}

/* One palette (kit Tone): an ended coupon is grey whether its dates or its uses ran out; purple is never a state. */
const STATUS_TONE: Record<CouponStatus, Tone> = {
  active: "green",
  scheduled: "blue",
  expired: "grey",
  paused: "orange",
  draft: "grey",
  used_up: "grey",
}

export function StatusBadge({ status }: { status: CouponStatus }) {
  const { t } = useTranslation("coupons")
  return <ToneBadge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</ToneBadge>
}

/** A choice card: an option with a line of description, the chosen one outlined. */
export function OptionCard({ on, title, hint, onClick, icon }: { on: boolean; title: string; hint: string; onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={clx(
        "flex items-start gap-x-2.5 rounded-lg border px-3 py-2.5 text-left transition-fg",
        on ? "border-ui-border-interactive bg-ui-bg-highlight shadow-borders-interactive-with-active" : "border-ui-border-base bg-ui-bg-base hover:bg-ui-bg-base-hover",
      )}
    >
      {icon ? <span className="mt-0.5 text-ui-fg-interactive">{icon}</span> : null}
      <span className="flex flex-col">
        <Text size="small" weight="plus">
          {title}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {hint}
        </Text>
      </span>
    </button>
  )
}
