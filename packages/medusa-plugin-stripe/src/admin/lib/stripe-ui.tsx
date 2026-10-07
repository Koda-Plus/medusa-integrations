import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightMini, ArrowUpRightOnBox, CheckCircleSolid, EllipseMiniSolid, ExclamationCircleSolid, InformationCircleSolid, XCircleSolid } from "@medusajs/icons"
import { Badge, StatusBadge, Text, clx } from "@medusajs/ui"
import type {
  DisputeUrgency,
  MethodDetailDto,
  MethodKey,
  MoneyDto,
  OrderLinkDto,
  PaymentRowDto,
  PaymentStatus,
  ReferenceDto,
  Verdict,
} from "../../modules/stripe/lib/contract"
import { bankName, brandName } from "../../modules/stripe/lib/methods"
import { formatMoney } from "../../modules/stripe/lib/money"
import { pickText } from "../../modules/stripe/lib/references"
import type { Reference } from "./stripe-guide"

type Tone = "green" | "orange" | "red" | "grey" | "blue" | "purple"

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

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

export function fmtDate(value: string | null | undefined, lang: string): string {
  if (!value) return ""
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ""
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** "3 min ago" style, for the freshness line. */
export function fmtAgo(value: string | null | undefined, lang: string, now = Date.now()): string {
  if (!value) return ""
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return ""
  const seconds = Math.round((t - now) / 1000)
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" })
    if (Math.abs(seconds) < 60) return rtf.format(seconds, "second")
    if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), "minute")
    if (Math.abs(seconds) < 86_400) return rtf.format(Math.round(seconds / 3600), "hour")
    return rtf.format(Math.round(seconds / 86_400), "day")
  } catch {
    return fmtDateTime(value, lang)
  }
}

export function fmtMoney(value: MoneyDto | null | undefined, lang: string): string {
  return value ? formatMoney(value.amount, value.currency, lang) : ""
}

/** Amounts in several currencies side by side, never added: "1 234,56 zł, 12,00 €". */
export function fmtMoneyList(values: readonly MoneyDto[] | null | undefined, lang: string, empty = ""): string {
  if (!values || values.length === 0) return empty
  return values.map((m) => formatMoney(m.amount, m.currency, lang)).join(", ")
}

export function fmtPercent(value: number | null | undefined, lang: string, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  } catch {
    return `${(value * 100).toFixed(digits)}%`
  }
}

export function fmtNumber(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang).format(value)
  } catch {
    return String(value)
  }
}

/** A rating in the admin's number format: 5.0 or 5,0. */
export function fmtRating(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
  } catch {
    return value.toFixed(1)
  }
}

/** The references of the options in the admin language, for the kit. */
export function referencesFor(items: readonly ReferenceDto[], lang: string): Reference[] {
  return items.map((r) => ({
    name: r.name,
    url: r.url ?? undefined,
    soon: r.soon,
    icon: r.icon,
    description: pickText(r.description, lang) || undefined,
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang), value: m.value })).filter((m) => m.label),
    links: r.links.map((l) => ({ label: pickText(l.label, lang) || l.url, url: l.url })),
    review: r.review ? { ...r.review, quote: pickText(r.review.quote, lang) || undefined } : null,
  }))
}

/* ------------------------------------------------------------------ */
/* Marks                                                               */
/* ------------------------------------------------------------------ */

/** The Medusa mark (the hexagon of the admin's own login screen), in the text colour. */
export function MedusaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 38" fill="none" aria-hidden className={className}>
      <path
        d="M30.85 6.16832L22.2453 1.21782C19.4299 -0.405941 15.9801 -0.405941 13.1648 1.21782L4.52043 6.16832C1.74473 7.79208 0 10.802 0 14.0099V23.9505C0 27.198 1.74473 30.1683 4.52043 31.7921L13.1251 36.7822C15.9405 38.4059 19.3903 38.4059 22.2056 36.7822L30.8103 31.7921C33.6257 30.1683 35.3307 27.198 35.3307 23.9505V14.0099C35.41 10.802 33.6653 7.79208 30.85 6.16832ZM17.6852 27.8317C12.8079 27.8317 8.8426 23.8713 8.8426 19C8.8426 14.1287 12.8079 10.1683 17.6852 10.1683C22.5625 10.1683 26.5674 14.1287 26.5674 19C26.5674 23.8713 22.6022 27.8317 17.6852 27.8317Z"
        fill="currentColor"
      />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Small blocks                                                        */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  onClick,
  active = false,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: "default" | "green" | "orange" | "red" | "blue" | "purple"
  onClick?: () => void
  active?: boolean
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
            : tone === "purple"
              ? "bg-ui-tag-purple-icon"
              : "bg-ui-fg-muted"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={clx(
        "flex h-full min-w-0 flex-col items-start justify-start gap-y-1.5 rounded-lg border px-4 py-3 text-left transition-fg",
        "border-ui-border-base bg-ui-bg-component",
        onClick ? "cursor-pointer hover:bg-ui-bg-component-hover" : "cursor-default",
        active && "border-ui-border-interactive shadow-borders-interactive-with-active",
      )}
    >
      <span className="flex items-center gap-x-1.5">
        <span className={clx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
        <Text size="xsmall" className="text-ui-fg-subtle">
          {label}
        </Text>
      </span>
      <span className="txt-large-plus max-w-full break-words tabular-nums text-ui-fg-base">{value}</span>
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </button>
  )
}

/** Pills with counts, the same look as the other Koda Plus integrations. */
export function FilterPills<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-full border px-3 py-1 transition-fg",
            value === o.value ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color" : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-component-hover",
          )}
        >
          {o.label}
          {typeof o.count === "number" ? <span className="tabular-nums opacity-80">{o.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Fact({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-compact-small min-w-0 break-words text-ui-fg-base", mono && "font-mono")}>{children}</div>
    </div>
  )
}

/** An external link to the Stripe Dashboard (or any https page), opening in a new tab. */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={clx("txt-compact-small inline-flex items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover", className)}>
      {children}
      <ArrowUpRightOnBox className="shrink-0" />
    </a>
  )
}

export function SampleBadge() {
  const { t } = useTranslation("stripe")
  return (
    <Badge size="2xsmall" color="purple">
      {t("demo.sample")}
    </Badge>
  )
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

const STATUS_TONE: Record<PaymentStatus, Tone> = {
  succeeded: "green",
  processing: "blue",
  authorized: "blue",
  requires_action: "orange",
  failed: "red",
  canceled: "grey",
  incomplete: "grey",
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { t } = useTranslation("stripe")
  return (
    <StatusBadge color={STATUS_TONE[status] ?? "grey"} className="whitespace-nowrap">
      {t(`payments.status.${status}`)}
    </StatusBadge>
  )
}

/** The method as people say it: "BLIK", "Apple Pay", "Card". */
export function methodLabel(t: (k: string) => string, method: MethodKey | null | undefined): string {
  return method ? t(`methods.${method}`) : t("payments.notChosen")
}

/** A decline as people say it: our words for Stripe's well-known codes, Stripe's own (English) message for any other. */
export function declineText(t: (k: string, o?: Record<string, unknown>) => string, failure: { code: string | null; message: string | null } | null | undefined): string {
  if (!failure) return ""
  const own = failure.message ?? failure.code ?? ""
  return failure.code ? t(`declines.${failure.code}`, { defaultValue: own }) : own
}

/** Why a refund failed, from Stripe's `failure_reason`. */
export function refundFailureText(t: (k: string, o?: Record<string, unknown>) => string, reason: string | null | undefined): string {
  return reason ? t(`refunds.failure.${reason}`, { defaultValue: reason }) : ""
}

/** The detail under the method: "Visa, ending 4242", "PKO Bank Polski, P24-ABC-DEF-GHI". Translated parts only. */
export function methodDetail(t: (k: string, o?: Record<string, unknown>) => string, detail: MethodDetailDto | null | undefined): string {
  if (!detail) return ""
  const bank = bankName(detail.bank)
  if (bank) return detail.reference ? `${bank}, ${detail.reference}` : bank
  const brand = brandName(detail.brand)
  const ending = detail.last4 ? t("payments.ending", { last4: detail.last4 }) : ""
  return [brand, ending].filter(Boolean).join(", ")
}

export function MethodCell({ method, detail }: { method: MethodKey | null; detail: MethodDetailDto | null }) {
  const { t } = useTranslation("stripe")
  const sub = methodDetail(t, detail)
  return (
    <div className="flex min-w-0 flex-col">
      <Text size="small" weight="plus" className={clx("truncate", method ? "text-ui-fg-base" : "text-ui-fg-muted")}>
        {methodLabel(t, method)}
      </Text>
      {sub ? (
        <Text size="xsmall" className="truncate text-ui-fg-muted" title={sub}>
          {sub}
        </Text>
      ) : null}
    </div>
  )
}

/**
 * The Medusa side of a payment: its order, one click away, or why there is
 * none (a paid cart without an order stands out in red).
 */
export function OrderCell({ order, payment }: { order: OrderLinkDto | null; payment?: Pick<PaymentRowDto, "fromMedusa" | "status" | "cartId"> & Partial<Pick<PaymentRowDto, "session">> }) {
  const { t } = useTranslation("stripe")
  if (order) {
    return (
      <Link to={`/orders/${order.id}`} className="group flex min-w-0 items-center gap-x-2.5" title={t("actions.openOrder")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ui-bg-component shadow-borders-base transition-fg group-hover:bg-ui-bg-component-hover">
          <MedusaMark className="h-4 w-4 text-ui-fg-base" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="txt-compact-small-plus truncate tabular-nums text-ui-fg-base group-hover:text-ui-fg-interactive">{order.displayId ? `#${order.displayId}` : order.id}</span>
          <span className="txt-compact-xsmall-plus inline-flex shrink-0 items-center gap-x-0.5 text-ui-fg-interactive">
            {t("actions.openOrder")}
            <ArrowUpRightMini />
          </span>
        </span>
      </Link>
    )
  }
  if (payment && !payment.fromMedusa) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("payments.outside")}
      </Text>
    )
  }
  /* Another Medusa on the same Stripe account: its payment, never this store's order. */
  if (payment?.session === "foreign") {
    return (
      <Badge size="2xsmall" color="grey">
        {t("payments.foreign")}
      </Badge>
    )
  }
  if (payment?.status === "succeeded" && payment.session !== "replaced") {
    return (
      <div className="flex flex-col items-start gap-y-0.5">
        <Badge size="2xsmall" color="red">
          {t("payments.paidNoOrder")}
        </Badge>
        {payment.cartId ? <span className="txt-compact-xsmall truncate font-mono text-ui-fg-muted">{t("payments.cart", { id: payment.cartId })}</span> : null}
      </div>
    )
  }
  return (
    <Text size="xsmall" className="text-ui-fg-muted">
      {t("payments.noOrder")}
    </Text>
  )
}

/* ------------------------------------------------------------------ */
/* Verdicts and disputes                                               */
/* ------------------------------------------------------------------ */

export const VERDICT_TONE: Record<Verdict, Tone> = { pass: "green", warn: "orange", fail: "red", info: "blue", off: "grey", unknown: "grey" }

export function VerdictIcon({ verdict, className }: { verdict: Verdict; className?: string }) {
  const cls = clx("shrink-0", className)
  switch (verdict) {
    case "pass":
      return <CheckCircleSolid className={clx(cls, "text-ui-tag-green-icon")} />
    case "warn":
      return <ExclamationCircleSolid className={clx(cls, "text-ui-tag-orange-icon")} />
    case "fail":
      return <XCircleSolid className={clx(cls, "text-ui-tag-red-icon")} />
    case "info":
      return <InformationCircleSolid className={clx(cls, "text-ui-tag-blue-icon")} />
    default:
      return <EllipseMiniSolid className={clx(cls, "text-ui-fg-muted")} />
  }
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const { t } = useTranslation("stripe")
  return <StatusBadge color={VERDICT_TONE[verdict]}>{t(`health.verdict.${verdict}`)}</StatusBadge>
}

const URGENCY_TONE: Record<DisputeUrgency, "red" | "orange" | "blue" | "grey"> = { overdue: "red", urgent: "red", soon: "orange", ok: "blue", waiting: "grey" }

/** The evidence deadline: date and days left, coloured by urgency. */
export function DisputeDue({ dueBy, daysLeft, urgency, lang }: { dueBy: string | null; daysLeft: number | null; urgency: DisputeUrgency; lang: string }) {
  const { t } = useTranslation("stripe")
  const label = urgency === "overdue" ? t("disputes.overdue") : urgency === "waiting" ? t("disputes.waiting") : t("disputes.daysLeft", { count: daysLeft ?? 0 })
  return (
    <div className="flex flex-col items-start gap-y-0.5">
      {dueBy && urgency !== "waiting" ? <span className="txt-compact-small whitespace-nowrap text-ui-fg-base">{fmtDateTime(dueBy, lang)}</span> : null}
      <Badge size="2xsmall" color={URGENCY_TONE[urgency]}>
        {label}
      </Badge>
    </div>
  )
}
