import type { ComponentProps, ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge, Text, clx } from "@medusajs/ui"
import type { CouponStatus } from "../../modules/coupons/lib/contract"
import type { SentenceFormat } from "./coupons-sentence"
import { StatTile as KitStatTile, type Tone } from "./coupons-blocks"

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

const STATUS_COLOR: Record<CouponStatus, "green" | "blue" | "grey" | "orange" | "red" | "purple"> = {
  active: "green",
  scheduled: "blue",
  expired: "grey",
  paused: "orange",
  draft: "grey",
  used_up: "purple",
}

export function StatusBadge({ status }: { status: CouponStatus }) {
  const { t } = useTranslation("coupons")
  return (
    <Badge size="2xsmall" color={STATUS_COLOR[status]}>
      {t(`status.${status}`)}
    </Badge>
  )
}

/** The kit's counter tile (coupons-blocks); "default" is the kit's grey. */
export function StatTile({ tone = "grey", ...props }: Omit<ComponentProps<typeof KitStatTile>, "tone"> & { tone?: Tone | "default" }) {
  return <KitStatTile tone={tone === "default" ? "grey" : tone} {...props} />
}

/** A segmented choice: the options as small buttons, the chosen one filled. */
export function Segment<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small rounded-md border px-2.5 py-1 transition-fg",
            value === o.value ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color" : "border-ui-border-base bg-ui-bg-base text-ui-fg-subtle hover:bg-ui-bg-base-hover",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
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
