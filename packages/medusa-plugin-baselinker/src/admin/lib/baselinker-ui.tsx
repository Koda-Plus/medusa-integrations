import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { Badge, StatusBadge, Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type {
  CardConflict,
  OrderRowStatus,
  RunDto,
  RunStatus,
  StatusResponse,
  StockChangeStatus,
} from "../../modules/baselinker/lib/contract"

type Tone = "green" | "orange" | "red" | "grey" | "blue" | "purple"

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

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 s"
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
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

/** Units with their sign, so a plan reads at a glance: +3, -1. */
export function fmtDelta(value: number, lang: string): string {
  if (value > 0) return `+${fmtNumber(value, lang)}`
  if (value < 0) return `-${fmtNumber(-value, lang)}`
  return "0"
}

/** One word for the whole connection: what a person needs to know first. */
export function connectionState(s: StatusResponse | undefined): { key: string; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "purple" }
  if (!s.configured) return { key: "notConfigured", tone: "orange" }
  const last = s.lastRuns.catalog
  if (s.lastCheck && !s.lastCheck.ok) return { key: "error", tone: "red" }
  if (last?.status === "error") return { key: "error", tone: "red" }
  if (last || s.lastCheck?.ok) return { key: "connected", tone: "green" }
  return { key: "unknown", tone: "grey" }
}

export function ModeBadge({ status }: { status: StatusResponse | undefined }) {
  const { t } = useTranslation("baselinker")
  const state = connectionState(status)
  return <StatusBadge color={state.tone}>{t(`mode.${state.key}`)}</StatusBadge>
}

const ORDER_TONE: Record<OrderRowStatus, Tone> = { pending: "blue", sent: "green", failed: "red", skipped: "grey" }

export function OrderStatusBadge({ status }: { status: OrderRowStatus }) {
  const { t } = useTranslation("baselinker")
  return <StatusBadge color={ORDER_TONE[status] ?? "grey"}>{t(`orders.statuses.${status}`)}</StatusBadge>
}

const RUN_TONE: Record<RunStatus, Tone> = { ok: "green", partial: "orange", error: "red" }

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation("baselinker")
  return <StatusBadge color={RUN_TONE[status] ?? "grey"}>{t(`runs.statuses.${status}`)}</StatusBadge>
}

const CHANGE_TONE: Record<StockChangeStatus, Tone> = { planned: "blue", applied: "green", over_cap: "orange", failed: "red" }

export function ChangeStatusBadge({ status }: { status: StockChangeStatus }) {
  const { t } = useTranslation("baselinker")
  return <StatusBadge color={CHANGE_TONE[status] ?? "grey"}>{t(`stock.statuses.${status}`)}</StatusBadge>
}

export function ConflictBadge({ conflict }: { conflict: CardConflict }) {
  const { t } = useTranslation("baselinker")
  return (
    <Badge size="2xsmall" color="red">
      {t(`cards.conflict.${conflict}`)}
    </Badge>
  )
}

export function StatTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string
  value: ReactNode
  tone?: "default" | "green" | "orange" | "red"
  active?: boolean
  onClick?: () => void
}) {
  const dot =
    tone === "green" ? "bg-ui-tag-green-icon" : tone === "orange" ? "bg-ui-tag-orange-icon" : tone === "red" ? "bg-ui-tag-red-icon" : "bg-ui-fg-muted"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
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
    </button>
  )
}

export function FilterPills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string; count?: number }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-full border px-3 py-1 transition-fg",
            value === o.value
              ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-color"
              : "border-ui-border-base bg-ui-bg-component text-ui-fg-subtle hover:bg-ui-bg-component-hover",
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
    <div className="flex flex-col gap-y-0.5">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className={clx("txt-compact-small text-ui-fg-base min-w-0 break-words", mono && "font-mono")}>{children}</div>
    </div>
  )
}

export function OrderLink({ orderId, displayId }: { orderId: string; displayId: number | null }) {
  return (
    <Link to={`/orders/${orderId}`} className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover tabular-nums">
      {displayId ? `#${displayId}` : orderId.slice(0, 14)}
    </Link>
  )
}

type Translate = (key: string, options?: Record<string, unknown>) => string

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/**
 * The summary of a run in the admin language, built from its counters. Errors
 * and incomplete reads keep the stored message: it is the BaseLinker or
 * network text a person needs.
 */
export function runSummary(run: RunDto, t: Translate): string {
  const c = run.counts ?? {}
  if (run.status === "error") return run.message ?? ""
  if (run.kind === "catalog") {
    if (!run.complete) return run.message ?? ""
    return t("runs.summary.catalog", {
      cards: num(c.cards),
      linked: num(c.linked),
      conflicts: num(c.conflicts),
      onlyInMedusa: num(c.onlyInMedusa),
    })
  }
  if (run.kind === "stock") {
    if (c.skipped) return run.message ?? ""
    if (c.mode === "write") return t("runs.summary.stockWrite", { applied: num(c.applied), overCap: num(c.overCap) })
    return t("runs.summary.stockPlan", { changes: num(c.toChange), added: num(c.unitsAdded), removed: num(c.unitsRemoved) })
  }
  if (run.kind === "orders") return t("runs.summary.orders", { sent: num(c.sent), retry: num(c.retry), failed: num(c.failed) })
  if (run.kind === "statuses") {
    if (run.status === "partial" && run.message && num(c.read) === 0) return run.message
    return t("runs.summary.statuses", { read: num(c.read), changed: num(c.changed), fulfilled: num(c.fulfilled) })
  }
  return run.message ?? ""
}
