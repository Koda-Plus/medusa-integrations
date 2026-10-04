import type { ReactNode } from "react"
import { Badge, Button, StatusBadge, Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type { RunStatus, SubiektStatusResponse, TaskStatus } from "../../modules/subiekt/lib/contract"

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

type Tone = "green" | "orange" | "red" | "grey" | "blue" | "purple"

const TASK_TONE: Record<TaskStatus, Tone> = {
  waiting: "purple",
  pending: "blue",
  running: "blue",
  succeeded: "green",
  failed: "red",
  canceled: "grey",
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation("subiekt")
  return <StatusBadge color={TASK_TONE[status] ?? "grey"}>{t(`tasks.statuses.${status}`)}</StatusBadge>
}

const RUN_TONE: Record<RunStatus, Tone> = { success: "green", partial: "orange", error: "red", skipped: "grey" }

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation("subiekt")
  return <StatusBadge color={RUN_TONE[status] ?? "grey"}>{t(`runs.statuses.${status}`)}</StatusBadge>
}

export function DocumentStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("subiekt")
  const tone: Tone = status === "canceled" ? "grey" : status === "completed" ? "green" : "blue"
  return <StatusBadge color={tone}>{t(`documents.statuses.${status}`, { defaultValue: status })}</StatusBadge>
}

/** One word for the whole connection: what a person needs to know first. */
export function connectionState(s: SubiektStatusResponse | undefined): { key: string; tone: Tone } {
  if (!s) return { key: "unknown", tone: "grey" }
  if (s.mode === "demo") return { key: "demo", tone: "purple" }
  if (!s.configured) return { key: "notConfigured", tone: "orange" }
  if (!s.connection.checkedAt && !s.connection.lastErrorAt) return { key: "unknown", tone: "grey" }
  if (!s.connection.reachable) return { key: "unreachable", tone: "red" }
  if (s.connection.health && !s.connection.health.subiekt?.connected) return { key: "subiektDown", tone: "orange" }
  return { key: "connected", tone: "green" }
}

export function ModeBadge({ status }: { status: SubiektStatusResponse | undefined }) {
  const { t } = useTranslation("subiekt")
  const state = connectionState(status)
  return <StatusBadge color={state.tone}>{t(`mode.${state.key}`)}</StatusBadge>
}

export function StatTile({ label, value, tone }: { label: string; value: ReactNode; tone?: "attention" | "muted" }) {
  return (
    <div className="flex flex-col gap-y-1 px-6 py-4">
      <Text size="xsmall" leading="compact" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text
        size="xlarge"
        weight="plus"
        leading="compact"
        className={clx("tabular-nums", tone === "attention" ? "text-ui-tag-red-text" : tone === "muted" ? "text-ui-fg-muted" : "text-ui-fg-base")}
      >
        {value}
      </Text>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(120px,1fr)_2fr] items-start gap-x-4 px-6 py-2">
      <Text size="small" leading="compact" className="text-ui-fg-subtle">
        {label}
      </Text>
      <div className="txt-compact-small text-ui-fg-base min-w-0 break-words">{children}</div>
    </div>
  )
}

export function FilterPills<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small-plus rounded-full border px-3 py-1 transition-colors",
            value === o.value ? "border-ui-border-interactive bg-ui-bg-highlight text-ui-fg-interactive" : "border-ui-border-base text-ui-fg-subtle hover:bg-ui-bg-base-hover",
          )}
        >
          {o.label}
          {typeof o.count === "number" && o.count > 0 ? (
            <Badge size="2xsmall" className="ml-2">
              {o.count}
            </Badge>
          ) : null}
        </button>
      ))}
    </div>
  )
}

export function Pager({ offset, limit, count, onChange }: { offset: number; limit: number; count: number; onChange: (offset: number) => void }) {
  const { t } = useTranslation("subiekt")
  if (count <= limit) return null
  return (
    <div className="flex items-center justify-between px-6 py-3">
      <Text size="small" className="text-ui-fg-subtle tabular-nums">
        {t("tasks.page", { from: offset + 1, to: Math.min(offset + limit, count), count })}
      </Text>
      <div className="flex gap-x-2">
        <Button size="small" variant="secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          {t("tasks.prev")}
        </Button>
        <Button size="small" variant="secondary" disabled={offset + limit >= count} onClick={() => onChange(offset + limit)}>
          {t("tasks.next")}
        </Button>
      </div>
    </div>
  )
}

/** Link to an order in the admin. A plain anchor: router links break inside some admin builds. */
export function OrderLink({ orderId, displayId }: { orderId: string | null; displayId: number | null }) {
  if (!orderId) return <span className="text-ui-fg-muted">-</span>
  return (
    <a href={`/app/orders/${orderId}`} className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover tabular-nums">
      {displayId ? `#${displayId}` : orderId.slice(0, 14)}
    </a>
  )
}
