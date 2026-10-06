import type { ReactNode } from "react"
import { Badge, Button, StatusBadge, Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import type { CatalogChangeStatus, ReferenceDto, RunDto, RunStatus, SubiektStatusResponse, TaskStatus } from "../../modules/subiekt/lib/contract"
import type { Reference } from "./subiekt-guide"

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
  unknown: "orange",
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

const CATALOG_TONE: Record<CatalogChangeStatus, Tone> = {
  planned: "blue",
  applied: "green",
  simulated: "purple",
  over_cap: "grey",
  stale: "orange",
  failed: "red",
  quarantined: "red",
  skipped: "grey",
}

export function CatalogStatusBadge({ status }: { status: CatalogChangeStatus }) {
  const { t } = useTranslation("subiekt")
  return <StatusBadge color={CATALOG_TONE[status] ?? "grey"}>{t(`products.statuses.${status}`, { defaultValue: status })}</StatusBadge>
}

/** A labelled row of short codes: SKUs, symbols, conflicts. */
export function SampleList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-y-1">
      <Text size="xsmall" className="text-ui-fg-subtle">
        {label}
      </Text>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} size="2xsmall" className="font-mono">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  )
}

/** Guide copy: `backticks` become inline code, nothing else is parsed. */
export function RichText({ text }: { text: string }) {
  const parts = text.split("`")
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="txt-compact-xsmall rounded border border-ui-border-base bg-ui-bg-subtle px-1 font-mono text-ui-fg-base">
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
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

type Translate = (key: string, options?: Record<string, unknown>) => string

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/**
 * The summary of a run in the admin language, built from its counters. Errors
 * keep the stored message: it is the bridge or network text a person needs.
 */
export function runSummary(run: RunDto, t: Translate): string {
  const s = (run.stats ?? {}) as Record<string, unknown>
  if (run.status === "error" || run.status === "skipped" || !run.stats) return run.message ?? ""
  if (run.kind === "stock") {
    const changes = num(s.toUpdate) + num(s.toCreate)
    return t(run.dryRun ? "runs.summary.stockDry" : "runs.summary.stock", { changes, unchanged: num(s.unchanged) })
  }
  if (run.kind === "tasks") {
    const vars = { succeeded: num(s.succeeded), retry: num(s.retry), failed: num(s.failed) }
    return t(vars.retry || vars.failed ? "runs.summary.tasksIssues" : "runs.summary.tasks", vars)
  }
  if (run.kind === "events") return num(s.read) > 0 ? t("runs.summary.events", { applied: num(s.applied) }) : t("runs.summary.eventsNone")
  if (run.kind === "health" && run.status === "success") return t("runs.summary.health")
  if (run.kind === "products") {
    const applied = num(s.applied) + num(s.simulated)
    return t(run.dryRun ? "runs.summary.productsPlan" : "runs.summary.productsApplied", {
      prices: num(s.priceChanges),
      creates: num(s.toCreate),
      applied,
      failed: num(s.failed),
    })
  }
  return run.message ?? ""
}

export function fmtMoney(value: number | null | undefined, currency: string, lang: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: currency.toUpperCase() }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency.toUpperCase()}`
  }
}

/** 1.2 s, 450 ms. */
export function fmtMs(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "-"
  const abs = Math.abs(ms)
  return abs < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(abs < 10_000 ? 1 : 0)} s`
}

type Localized = string | { en?: string; pl?: string } | undefined

/** A reference text in the admin language, falling back to the other one. */
export function resolveText(value: Localized, lang: string): string | undefined {
  if (!value) return undefined
  if (typeof value === "string") return value
  const pl = lang.toLowerCase().startsWith("pl")
  return (pl ? value.pl ?? value.en : value.en ?? value.pl) || undefined
}

/** Polish needs the genitive after "od": "od kwietnia 2026". */
const PL_GENITIVE = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"]

/** "April 2026" / "kwietnia 2026" for a YYYY-MM, ready for "Since {{date}}" / "Od {{date}}". */
export function monthYear(since: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(since)
  if (!m) return since
  const year = Number(m[1])
  const month = Number(m[2])
  if (lang.toLowerCase().startsWith("pl")) return `${PL_GENITIVE[month - 1] ?? m[2]} ${year}`
  try {
    return new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 15)))
  } catch {
    return since
  }
}

/** The `references` option in the admin language, as the guide kit renders them. */
export function referencesFor(list: ReferenceDto[] | undefined, lang: string): Reference[] {
  return (list ?? []).map((r) => ({
    name: r.name,
    url: r.url,
    icon: r.icon,
    description: resolveText(r.description, lang),
    since: r.since,
    metrics: r.metrics.map((m) => ({ label: resolveText(m.label, lang) ?? "", value: m.value })).filter((m) => m.label),
    links: r.links.map((l) => ({ label: resolveText(l.label, lang) ?? l.url, url: l.url })),
  }))
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
