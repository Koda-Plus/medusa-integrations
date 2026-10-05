import { useEffect, useState, type ReactNode } from "react"
import { Badge, Heading, StatusBadge, Table, Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type {
  AllegroMoneyDto,
  AllegroOfferDto,
  AllegroOrderDto,
  AllegroStatusGroup,
  AllegroStockState,
} from "../../modules/allegro/lib/contract"

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

export function fmtMoney(price: AllegroMoneyDto | null | undefined, lang: string): string {
  if (!price) return ""
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: price.currency, maximumFractionDigits: 2 }).format(price.value)
  } catch {
    return `${price.value} ${price.currency}`
  }
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

/** The first part of a UUID, enough to tell orders apart in a table. */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : ""
}

const GROUP_COLOR: Record<AllegroStatusGroup, "green" | "blue" | "grey" | "orange"> = {
  live: "green",
  activating: "blue",
  draft: "orange",
  ended: "grey",
}

/** Allegro status as a dot badge; the raw Allegro status sits in the tooltip text. */
export function OfferStatus({ offer }: { offer: Pick<AllegroOfferDto, "status" | "statusGroup"> }) {
  const { t } = useTranslation("allegro")
  return (
    <span title={offer.status}>
      <StatusBadge color={GROUP_COLOR[offer.statusGroup]}>{t(`status.${offer.statusGroup}`)}</StatusBadge>
    </span>
  )
}

const STOCK_COLOR: Record<AllegroStockState, "red" | "orange" | "green" | "grey" | "blue" | "purple"> = {
  oversell: "red",
  sold_out: "red",
  under_listed: "blue",
  ended_in_stock: "orange",
  ok: "green",
  untracked: "grey",
  unknown: "grey",
}

/** Allegro quantity against the Medusa quantity, with the stock check label. */
export function StockCell({ offer }: { offer: AllegroOfferDto }) {
  const { t } = useTranslation("allegro")
  const allegro = offer.available ?? "?"
  return (
    <div className="flex flex-col items-start gap-y-1">
      <span className="tabular-nums txt-compact-small text-ui-fg-base">
        {allegro}
        {offer.variantId && offer.isPrimary ? <span className="text-ui-fg-muted"> / {offer.medusaAvailable ?? "∞"}</span> : null}
      </span>
      {offer.stockState ? (
        <Badge size="2xsmall" color={STOCK_COLOR[offer.stockState]}>
          {t(`stock.${offer.stockState}`)}
        </Badge>
      ) : null}
    </div>
  )
}

const ORDER_COLOR: Record<AllegroOrderDto["group"], "green" | "orange" | "grey"> = {
  open: "orange",
  sent: "green",
  cancelled: "grey",
}

export function OrderStatus({ order }: { order: AllegroOrderDto }) {
  const { t } = useTranslation("allegro")
  const raw = [order.status, order.fulfillmentStatus].filter(Boolean).join(" / ")
  return (
    <div className="flex flex-col items-start gap-y-1" title={raw}>
      <StatusBadge color={ORDER_COLOR[order.group]}>{t(`orders.group.${order.group}`)}</StatusBadge>
      {order.fulfillmentStatus ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {t(`orders.fulfillment.${order.fulfillmentStatus}`, { defaultValue: order.fulfillmentStatus })}
        </Text>
      ) : null}
    </div>
  )
}

export function KeyCell({ offer }: { offer: AllegroOfferDto }) {
  const { t } = useTranslation("allegro")
  if (!offer.matchKey) {
    return (
      <Text size="small" className="text-ui-fg-muted">
        {t("offers.noKey")}
      </Text>
    )
  }
  return <span className="font-mono text-ui-fg-base txt-compact-small">{offer.matchKey}</span>
}

export function StatTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
  hint,
}: {
  label: string
  value: number | string
  tone?: "default" | "green" | "orange" | "red" | "blue"
  active?: boolean
  onClick?: () => void
  hint?: string
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
            : "bg-ui-fg-muted"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={hint}
      className={clx(
        "flex h-full flex-col items-start justify-between gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
        "border-ui-border-base bg-ui-bg-component",
        onClick ? "hover:bg-ui-bg-component-hover cursor-pointer" : "cursor-default",
        active && "border-ui-border-interactive shadow-borders-interactive-with-active",
      )}
    >
      <span className="flex items-center gap-x-1.5">
        <span className={clx("h-1.5 w-1.5 rounded-full", dot)} />
        <Text size="xsmall" className="text-ui-fg-subtle">
          {label}
        </Text>
      </span>
      <Text size="xlarge" weight="plus" className="tabular-nums text-ui-fg-base">
        {value}
      </Text>
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </button>
  )
}

export function Pills<F extends string>({
  filters,
  value,
  onChange,
  label,
  count,
}: {
  filters: readonly F[]
  value: F
  onChange: (f: F) => void
  label: (f: F) => string
  count?: (f: F) => number | null
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((f) => {
        const n = count ? count(f) : null
        return (
          <button
            key={f}
            type="button"
            onClick={() => onChange(f)}
            className={clx(
              "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-full border px-3 py-1 transition-fg",
              value === f
                ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
                : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-component-hover",
            )}
          >
            {label(f)}
            {n === null ? null : <span className="tabular-nums opacity-80">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function useDebounced(value: string): string {
  const [q, setQ] = useState("")
  useEffect(() => {
    const id = window.setTimeout(() => setQ(value.trim()), 300)
    return () => window.clearTimeout(id)
  }, [value])
  return q
}

export function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-6 py-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading level="h2">{title}</Heading>
        {subtitle ? (
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {subtitle}
          </Text>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Pager({ count, page, size, onPage }: { count: number; page: number; size: number; onPage: (p: number) => void }) {
  const { t } = useTranslation("allegro")
  const pageCount = Math.max(1, Math.ceil(count / size))
  return (
    <Table.Pagination
      count={count}
      pageSize={size}
      pageIndex={page}
      pageCount={pageCount}
      canPreviousPage={page > 0}
      canNextPage={page + 1 < pageCount}
      previousPage={() => onPage(Math.max(0, page - 1))}
      nextPage={() => onPage(page + 1)}
      translations={{
        of: t("pagination.of"),
        results: t("pagination.results"),
        pages: t("pagination.pages"),
        prev: t("pagination.prev"),
        next: t("pagination.next"),
      }}
    />
  )
}

export function EmptyRow({ span, loading, text }: { span: number; loading: boolean; text: string }) {
  return (
    <Table.Row>
      <td colSpan={span} className="py-6 text-center">
        <Text size="small" className="text-ui-fg-muted">
          {loading ? "" : text}
        </Text>
      </td>
    </Table.Row>
  )
}

export type Tone = "green" | "orange" | "red" | "grey" | "blue" | "purple"

export const PLAN_TONE: Record<string, Tone> = {
  planned: "blue",
  deferred: "grey",
  quarantined: "red",
  skipped: "grey",
  in_sync: "green",
  applied: "green",
  failed: "red",
  unknown: "orange",
}

export const IMPORT_TONE: Record<string, Tone> = {
  pending: "blue",
  importing: "blue",
  imported: "green",
  held: "red",
  skipped: "grey",
  cancelled: "grey",
  unknown: "orange",
}

export const OUTBOX_TONE: Record<string, Tone> = {
  pending: "blue",
  sending: "blue",
  done: "green",
  failed: "red",
  unknown: "orange",
  skipped: "grey",
}
