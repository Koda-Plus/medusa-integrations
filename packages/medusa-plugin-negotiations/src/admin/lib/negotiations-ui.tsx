import { useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowUpRightMini } from "@medusajs/icons"
import { Badge, StatusBadge, Table, Text, clx } from "@medusajs/ui"
import type { LocalizedTextDto, MessageDto, MoneyDto, ReferenceDto, ReferenceTextDto, RunDto, ThreadDto } from "../../modules/negotiations/lib/contract"
import type { NegotiationStatus } from "../../modules/negotiations/lib/constants"
import { nb, type Reference } from "./negotiations-guide"

type Tone = "green" | "orange" | "red" | "grey" | "blue" | "purple"
type Translate = (key: string, options?: Record<string, unknown>) => string

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

/** "5 minutes ago", "in 3 days", in the admin language. */
export function fmtRelative(value: string | null | undefined, lang: string): string {
  if (!value) return ""
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ""
  const diff = (d.getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 60 ? [diff, "second"] : abs < 3600 ? [diff / 60, "minute"] : abs < 86400 ? [diff / 3600, "hour"] : abs < 86400 * 30 ? [diff / 86400, "day"] : abs < 86400 * 365 ? [diff / (86400 * 30), "month"] : [diff / (86400 * 365), "year"]
  try {
    return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(Math.round(amount), unit)
  } catch {
    return fmtDateTime(value, lang)
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

/** An amount of the API (decimal text) in a currency, in the admin language: "469,00 zł", "PLN 469.00". */
export function fmtMoney(money: MoneyDto | { value: string } | null | undefined, currency: string | null | undefined, lang: string): string {
  if (!money) return ""
  const n = Number(money.value)
  if (!Number.isFinite(n)) return money.value
  const decimals = money.value.includes(".") ? money.value.split(".")[1].length : 0
  if (!currency) return fmtNumber(n, lang)
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
  } catch {
    return `${money.value} ${currency.toUpperCase()}`
  }
}

/**
 * An amount in short form for a tight space: "PLN 10.2M", "10,2 mln zł". Empty
 * when the currency or the browser's Intl cannot do it; show the full form then.
 */
export function fmtMoneyCompact(money: MoneyDto | { value: string } | null | undefined, currency: string | null | undefined, lang: string): string {
  if (!money || !currency) return ""
  const n = Number(money.value)
  if (!Number.isFinite(n)) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: currency.toUpperCase(), notation: "compact", maximumFractionDigits: 1 }).format(n)
  } catch {
    return ""
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

export function fmtRating(value: number, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)
  } catch {
    return value.toFixed(1)
  }
}

/** The text of the admin language, or the other one. Message texts and reference texts alike. */
export function pickText(text: LocalizedTextDto | ReferenceTextDto | null | undefined, lang: string): string | undefined {
  if (!text) return undefined
  const pl = /^pl/i.test(lang)
  return (pl ? text.pl || text.en : text.en || text.pl) || undefined
}

/**
 * The references of the options in the admin language, for the kit's
 * `References` and `ReferencesBadge`: live stores with their address, stores
 * that start soon with the flag (the kit lists them after the live ones,
 * with a "Soon" badge and no link).
 */
export function referencesFor(items: readonly ReferenceDto[], lang: string): Reference[] {
  return items.map((r) => ({
    name: r.name,
    url: r.url ?? undefined,
    soon: r.soon,
    icon: r.icon,
    description: pickText(r.description, lang),
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang) ?? "", value: m.value })).filter((m) => m.label),
    links: r.links.map((l) => ({ label: pickText(l.label, lang) ?? l.url, url: l.url })),
    review: r.review ? { ...r.review, quote: pickText(r.review.quote, lang) || undefined } : null,
  }))
}

export function useDebounced(value: string, ms = 300): string {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value.trim()), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

/* ------------------------------------------------------------------ */
/* What a thread is about, who, how much                               */
/* ------------------------------------------------------------------ */

const STATUS_TONE: Record<NegotiationStatus, Tone> = { open: "orange", counter_offered: "blue", accepted: "green", rejected: "red", expired: "grey" }

export function NegotiationStatusBadge({ status }: { status: NegotiationStatus }) {
  const { t } = useTranslation("negotiations")
  return <StatusBadge color={STATUS_TONE[status] ?? "grey"}>{t(`status.${status}`)}</StatusBadge>
}

/** The customer as a person reads it: the company first, then the person; the demo story's label when it has no customer. */
export function customerLine(thread: ThreadDto, t: Translate, lang: string): { main: string; sub: string | null } {
  const c = thread.customer
  if (c) return { main: c.company || c.name || c.email || c.id, sub: c.company ? c.name || c.email : c.name ? c.email : null }
  const label = pickText(thread.customerLabel, lang)
  if (label) return { main: label, sub: t("queue.sample") }
  return { main: thread.customerId ?? t("queue.guest"), sub: null }
}

/** What the thread is about: the product title and SKU, or the cart and its lines. */
export function subjectLine(thread: ThreadDto, t: Translate): { main: string; sub: string | null } {
  if (thread.subject === "cart") return { main: t("queue.cart"), sub: t("queue.cartLines", { count: thread.items?.length ?? 0 }) }
  const title = thread.title ?? thread.product?.title ?? thread.sku ?? thread.productId ?? ""
  const sub = thread.subject === "product" ? t("queue.anyVariant") : thread.sku
  return { main: title, sub: sub ?? null }
}

export function CustomerCell({ thread }: { thread: ThreadDto }) {
  const { t, i18n } = useTranslation("negotiations")
  const who = customerLine(thread, t, i18n.language || "en")
  return (
    <div className="flex min-w-0 flex-col">
      <Text size="small" leading="compact" className="truncate text-ui-fg-base">
        {who.main}
      </Text>
      {who.sub ? (
        <Text size="xsmall" leading="compact" className="truncate text-ui-fg-muted">
          {who.sub}
        </Text>
      ) : null}
    </div>
  )
}

export function SubjectCell({ thread }: { thread: ThreadDto }) {
  const { t } = useTranslation("negotiations")
  const s = subjectLine(thread, t)
  return (
    <div className="flex min-w-0 flex-col">
      <Text size="small" leading="compact" className="truncate text-ui-fg-base">
        {s.main}
      </Text>
      {s.sub ? (
        <Text size="xsmall" leading="compact" className={clx("truncate text-ui-fg-muted", thread.subject !== "cart" && thread.subject !== "product" && "font-mono")}>
          {s.sub}
        </Text>
      ) : null}
    </div>
  )
}

/** The price on the table, with the list price and how far below it, per unit (or for the cart). */
export function PriceCell({ thread, lang }: { thread: ThreadDto; lang: string }) {
  const { t } = useTranslation("negotiations")
  if (!thread.price) return <Text size="small" className="text-ui-fg-muted">{t("queue.noPrice")}</Text>
  return (
    <div className="flex flex-col items-end">
      <Text size="small" leading="compact" className="tabular-nums text-ui-fg-base">
        {fmtMoney(thread.price, thread.currencyCode, lang)}
      </Text>
      {thread.list && thread.discountPercent !== null ? (
        <Text size="xsmall" leading="compact" className="tabular-nums text-ui-fg-muted" title={t("queue.list", { price: fmtMoney(thread.list, thread.currencyCode, lang) })}>
          {thread.discountPercent > 0 ? t("queue.below", { percent: fmtNumber(thread.discountPercent, lang) }) : t("queue.atList")}
        </Text>
      ) : null}
    </div>
  )
}

/** The dot of a thread where the team has the next move. */
export function WaitingDot({ waiting }: { waiting: boolean }) {
  return <span aria-hidden className={clx("h-2 w-2 shrink-0 rounded-full", waiting ? "bg-ui-tag-red-icon" : "bg-transparent")} />
}

/* ------------------------------------------------------------------ */
/* Messages in the admin language                                      */
/* ------------------------------------------------------------------ */

/**
 * A message's text: the demo story in the admin language, the old Polish
 * system notes translated, everything else as written.
 */
export function messageText(m: MessageDto, lang: string): string {
  return pickText(m.text, lang) ?? m.body
}

/** The line a system-like move adds to the conversation ("Counter offer: 499,00 zł"), or null for a plain message. */
export function moveLine(m: MessageDto, thread: ThreadDto, t: Translate, lang: string): string | null {
  const price = m.price ? fmtMoney(m.price, thread.currencyCode, lang) : null
  const cart = thread.subject === "cart"
  if (m.legacy) {
    const legacyPrice = m.legacy.price ? fmtMoney(m.legacy.price, thread.currencyCode, lang) : null
    if (m.legacy.kind === "counter") return t(cart ? "kind.counterCart" : "kind.counter", { price: legacyPrice ?? "" })
    if (m.legacy.kind === "accepted") return t("kind.acceptedNoPrice")
    return t("kind.rejectedByTeam")
  }
  switch (m.kind) {
    case "counter":
      return t(cart ? "kind.counterCart" : "kind.counter", { price: price ?? "" })
    case "accepted":
      return price ? t(m.authorType === "customer" ? "kind.acceptedByCustomer" : "kind.acceptedByTeam", { price }) : t("kind.acceptedNoPrice")
    case "rejected":
      return t(m.authorType === "customer" ? "kind.rejectedByCustomer" : "kind.rejectedByTeam")
    case "expired":
      return t("kind.expired")
    case "message":
      return m.authorType === "customer" && price ? t(cart ? "kind.proposalCart" : "kind.proposal", { price }) : null
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

/** About how wide one character of a tile value is, in em (Inter with tabular figures, a little to spare). */
const VALUE_CHAR_EM = 0.62

/**
 * The font size that fits a tile value of `chars` characters in one line of
 * the tile: the usual 18 px when there is room, less as the tile narrows
 * (`cqi`: the tile is a size container), never under 12 px. Short values
 * (counts) keep the class size. A browser without container units ignores the
 * declaration and keeps 18 px; the value then wraps instead of overflowing.
 */
export function tileFontSize(chars: number): string | undefined {
  if (!Number.isFinite(chars) || chars <= 8) return undefined
  return `clamp(0.75rem, ${(100 / (VALUE_CHAR_EM * chars)).toFixed(2)}cqi, 1.125rem)`
}

/**
 * A counter. Never clips: the tile is a size container, its label wraps, and a
 * long value (a money amount) shrinks with the tile and wraps as a last
 * resort. `fullValue` is the value written out in full when `value` is a
 * shortened form of it ("PLN 10.2M"); it shows on hover with the hint.
 */
export function StatTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
  hint,
  fullValue,
}: {
  label: string
  value: ReactNode
  tone?: "default" | "green" | "orange" | "red" | "blue" | "purple"
  active?: boolean
  onClick?: () => void
  hint?: string
  fullValue?: string
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
  const text = typeof value === "string" || typeof value === "number" ? String(value) : null
  const title = [fullValue && fullValue !== text ? fullValue : null, hint].filter(Boolean).join("\n") || undefined
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={title}
      style={{ containerType: "inline-size" }}
      className={clx(
        "flex h-full min-w-0 flex-col items-start justify-between gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
        "border-ui-border-base bg-ui-bg-component",
        onClick ? "cursor-pointer hover:bg-ui-bg-component-hover" : "cursor-default",
        active && "border-ui-border-interactive shadow-borders-interactive-with-active",
      )}
    >
      <span className="flex min-w-0 max-w-full items-start gap-x-1.5">
        <span className={clx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
        <Text size="xsmall" className="min-w-0 text-ui-fg-subtle">
          {label}
        </Text>
      </span>
      <Text
        size="xlarge"
        weight="plus"
        className="max-w-full tabular-nums text-ui-fg-base"
        style={{ fontSize: text ? tileFontSize([...text].length) : undefined, overflowWrap: "anywhere" }}
      >
        {value}
      </Text>
    </button>
  )
}

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

export function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <Table.Row>
      <td colSpan={cols} className="px-6 py-6 text-center">
        <Text size="small" className="text-ui-fg-muted">
          {text}
        </Text>
      </td>
    </Table.Row>
  )
}

export function OpenLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="txt-compact-small-plus inline-flex items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
      {label}
      <ArrowUpRightMini />
    </Link>
  )
}

const RUN_TONE: Record<string, Tone> = { ok: "green", partial: "orange", error: "red", skipped: "grey" }

export function RunStatusBadge({ status }: { status: RunDto["status"] }) {
  const { t } = useTranslation("negotiations")
  return <StatusBadge color={RUN_TONE[status] ?? "grey"}>{t(`runs.statuses.${status}`)}</StatusBadge>
}

/** A run in one line, from its counts. */
export function runSummary(run: RunDto, t: Translate): string {
  const c = run.counts ?? {}
  if (run.status === "error" || run.status === "skipped") return run.message ?? ""
  if (run.kind === "expire") return t("runs.summary.expire", { count: c.expired ?? 0 })
  if (run.kind === "demo") return t("runs.summary.demo", { count: c.threads ?? 0 })
  return t("runs.summary.draftOrders", { created: c.created ?? 0, adopted: c.adopted ?? 0, failed: c.failed ?? 0, blocked: c.blocked ?? 0 })
}

export function DemoBadge() {
  const { t } = useTranslation("negotiations")
  return (
    <Badge size="2xsmall" color="purple">
      {t("drawer.demo")}
    </Badge>
  )
}

/** Text a person typed, typeset for Polish (no one-letter word at a line's end). */
export function typed(text: string): string {
  return nb(text)
}
