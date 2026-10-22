import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Text, clx } from "@medusajs/ui"
import type { BasketDto, StatusResponse } from "../../modules/inpostpay/lib/contract"
import { ToneBadge, type Tone } from "./inpostpay-blocks"

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

/** "199.99" and "pln" in the admin's format: "199,99 zł" or "PLN 199.99". */
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

/** The mode of the plugin in one word, for the header badge. */
export function modeOf(s: StatusResponse | undefined): { key: string; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "blue" }
  if (s.mode === "off") return { key: "notConfigured", tone: "orange" }
  if (s.mode === "sandbox") return { key: "sandbox", tone: "orange" }
  return { key: "live", tone: "green" }
}

const STATUS_TONE: Record<BasketDto["status"], Tone> = { created: "blue", linked: "blue", rejected: "grey", ordered: "green", failed: "red", unbound: "grey" }

export function BasketStatusBadge({ basket }: { basket: Pick<BasketDto, "status"> }) {
  const { t } = useTranslation("inpostpay")
  return <ToneBadge tone={STATUS_TONE[basket.status] ?? "grey"}>{t(`status.${basket.status}`)}</ToneBadge>
}

const PAYMENT_TONE: Record<string, Tone> = { AUTHORIZED: "green", COD: "blue", UNPAID: "orange", STARTED: "blue", PENDING: "blue", DECLINED: "red", CANCELLED: "red", ERROR: "red" }

export function PaymentBadge({ status }: { status: string | null }) {
  const { t } = useTranslation("inpostpay")
  if (!status) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("payment.none")}
      </Text>
    )
  }
  return (
    <ToneBadge tone={PAYMENT_TONE[status] ?? "grey"} title={status}>
      {t(`payment.${status}`, { defaultValue: status })}
    </ToneBadge>
  )
}

/** A label over a value. */
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

/** The history of one basket, newest first. */
export function EventList({ events, lang }: { events: BasketDto["events"]; lang: string }) {
  const { t } = useTranslation("inpostpay")
  return (
    <ol className="flex flex-col gap-y-1.5">
      {[...events].reverse().map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
          <Text size="xsmall" className="shrink-0 tabular-nums text-ui-fg-muted">
            {fmtDateTime(e.at, lang)}
          </Text>
          <Text size="xsmall" className={clx(e.kind === "failed" ? "text-ui-tag-red-text" : "text-ui-fg-subtle")}>
            {e.message}
          </Text>
          {e.demo ? <ToneBadge tone="purple">{t("demo.badge")}</ToneBadge> : null}
        </li>
      ))}
    </ol>
  )
}
