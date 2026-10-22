// GENERATED from kit/admin/blocks.tsx (kit 1.3.0) by scripts/kit.mjs. Do not edit here: change the kit and run `npm run kit:sync`.
import { useEffect, useState, type MouseEvent, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeftMini, ArrowPath, CheckCircleSolid, Clock, Sparkles, TriangleRightMini, XCircleSolid } from "@medusajs/icons"
import { Badge, Button, Container, Heading, IconButton, InlineTip, Input, Text, clx } from "@medusajs/ui"
import { KeyPoints, nb, type KeyPointItem } from "./coupons-guide"

/*
 * The building blocks of a plugin page, under the header (IntegrationHeader,
 * in the page kit): the same look in every Koda Plus plugin. GENERATED into
 * each package as src/admin/lib/<ns>-blocks.tsx from kit/admin/blocks.tsx by
 * `npm run kit:sync`: edit the kit, never a copy. The rules behind them:
 * kit/STYLE.md.
 *
 * Lists
 *   FilterBar        the grey row of filters under a section heading
 *   FilterButton     icon, name and count in one button; the active one filled, `attention` paints the count orange
 *   FilterDivider    a thin line between groups of filters
 *   SearchInput      the search field (type="search": Medusa draws the magnifier), with an optional delay
 *   RowActions       a row's actions as icons with a title, never a menu
 *   EmptyState       an icon and a short phrase instead of an empty table (EmptyTableRow inside a table)
 * Status
 *   Tone, ToneBadge  one palette of meaning: green ok, orange attention, red error, blue info, grey neutral, purple special
 *   toneOfStatus     a status word (paid, failed, pending...) to its tone
 * Layout
 *   Section          a card: icon, title, key points under it, actions on the right, then the content
 *   SubpageHeader    the header of a detail page: back link, icon, title, badges, key points, actions
 *   StatTiles        the grid of counters; StatTile one counter, clickable as a filter
 * Waiting
 *   StagedLoader     a long run told in stages: ring with percent, the current stage, tiles, log
 *
 * Copy comes in through props, already translated by the page. The few words
 * the blocks write themselves (the loader's "Now", "Try again") are below in
 * English and Polish, picked from the admin's language.
 */

/* ------------------------------------------------------------------ */
/* The kit's own words */

const TEXT = {
  en: {
    search: "Search",
    empty: "Nothing here yet",
    now: "Now",
    next: "In a moment",
    counted: "Done",
    stopped: "Stopped",
    queued: "Waiting for a free slot on the server",
    ready: "Ready",
    error: "Error",
    pctDone: "done",
    pctError: "error",
    pctQueued: "queued",
    pctRunning: "working",
    running: (time: string) => `running ${time}`,
    left: (time: string) => `about ${time} left`,
    clean: "no errors",
    of: "of",
    waiting: "waiting",
    log: "Log",
    retry: "Try again",
  },
  pl: {
    search: "Szukaj",
    empty: "Na razie pusto",
    now: "Teraz",
    next: "Za chwilę",
    counted: "Gotowe",
    stopped: "Przerwane",
    queued: "Czekam na wolne miejsce na serwerze",
    ready: "Gotowe",
    error: "Błąd",
    pctDone: "gotowe",
    pctError: "błąd",
    pctQueued: "w kolejce",
    pctRunning: "liczę",
    running: (time: string) => `trwa ${time}`,
    left: (time: string) => nb(`zostało ok. ${time}`),
    clean: "bez błędów",
    of: "z",
    waiting: "czeka",
    log: "Przebieg",
    retry: "Spróbuj ponownie",
  },
}

type KitText = (typeof TEXT)["en"]

function useKitText(): { text: KitText; locale: string } {
  const { i18n } = useTranslation()
  const pl = String(i18n?.language ?? "en").startsWith("pl")
  return { text: pl ? TEXT.pl : TEXT.en, locale: pl ? "pl-PL" : "en-GB" }
}

/* ------------------------------------------------------------------ */
/* One palette of meaning */

/**
 * The colour of a state, the same in every plugin and in both themes (the
 * ui-tag-* classes of @medusajs/ui):
 *   green   done, paid, connected, OK
 *   orange  needs a look, waiting, pending, a warning
 *   red     failed, rejected, an error, money at risk
 *   blue    information, scheduled, running, demo
 *   grey    neutral, off, draft, canceled, unknown
 *   purple  special only (premium, a sample row); never a state
 * Colour only when it means something: a plain label stays grey.
 */
export type Tone = "green" | "orange" | "red" | "blue" | "grey" | "purple"

const TONE_WORDS: Array<[Tone, RegExp]> = [
  ["red", /^(failed|failure|error|errored|rejected|declined|blocked|disputed|lost|overdue|invalid|bounced|complained)$/],
  ["orange", /^(pending|waiting|attention|warning|review|requires_action|requires_capture|partially_paid|partial|held|on_hold|paused|expiring|retry|retrying|queued|not_sent|unpaid)$/],
  ["green", /^(ok|done|paid|captured|succeeded|success|sent|delivered|completed|active|connected|approved|accepted|published|ready|live|valid|verified|refunded)$/],
  ["blue", /^(info|scheduled|running|processing|in_progress|open|new|draft_sent|demo|test|sandbox|authorized)$/],
  ["grey", /^(off|none|draft|canceled|cancelled|archived|expired|unknown|disabled|inactive|skipped|closed|not_configured)$/],
]

/** A status word to its tone (`paid` green, `pending` orange, `failed` red); grey when the word is unknown. */
export function toneOfStatus(status: string | null | undefined): Tone {
  const s = String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  for (const [tone, words] of TONE_WORDS) if (words.test(s)) return tone
  return "grey"
}

const DOT: Record<Tone, string> = {
  green: "bg-ui-tag-green-icon",
  orange: "bg-ui-tag-orange-icon",
  red: "bg-ui-tag-red-icon",
  blue: "bg-ui-tag-blue-icon",
  grey: "bg-ui-tag-neutral-icon",
  purple: "bg-ui-tag-purple-icon",
}

const ICON: Record<Tone, string> = {
  green: "text-ui-tag-green-icon",
  orange: "text-ui-tag-orange-icon",
  red: "text-ui-tag-red-icon",
  blue: "text-ui-tag-blue-icon",
  grey: "text-ui-fg-muted",
  purple: "text-ui-tag-purple-icon",
}

/**
 * A badge in the palette of meaning. `icon` puts a small icon before the text;
 * `dot` draws the quieter form (a coloured dot and the text, no pill) for
 * tables with many rows. The page names the state, the badge only paints it.
 */
export function ToneBadge({ tone = "grey", children, icon, dot = false, title, size = "2xsmall" }: { tone?: Tone; children: ReactNode; icon?: ReactNode; dot?: boolean; title?: string; size?: "2xsmall" | "xsmall" | "small" }) {
  if (dot) {
    return (
      <span title={title} className="txt-compact-small inline-flex items-center gap-x-1.5 whitespace-nowrap text-ui-fg-subtle">
        <span aria-hidden className={clx("size-1.5 shrink-0 rounded-full", DOT[tone])} />
        {children}
      </span>
    )
  }
  return (
    <Badge size={size} color={tone} title={title} className="whitespace-nowrap">
      {icon ? (
        <span className="inline-flex items-center gap-x-1 [&_svg]:size-3 [&_svg]:shrink-0">
          {icon}
          {children}
        </span>
      ) : (
        children
      )}
    </Badge>
  )
}

/* ------------------------------------------------------------------ */
/* Lists: filters, search, row actions, empty state */

/** The grey row of filters between a section heading and its table. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clx("flex flex-wrap items-center gap-2 bg-ui-bg-subtle px-6 py-2.5", className)}>{children}</div>
}

/**
 * A filter above a list: icon, name and count in one button (never a pill
 * with words and a separate count). The active one is the dark button; a
 * second click on it should clear the filter (the page decides).
 * `attention` paints the count orange while it is above zero (things to do).
 */
export function FilterButton({
  icon,
  label,
  count,
  active,
  attention,
  onClick,
  title,
  disabled,
}: {
  icon: ReactNode
  label: ReactNode
  count?: number | null
  active: boolean
  attention?: boolean
  onClick: () => void
  title?: string
  disabled?: boolean
}) {
  return (
    <Button size="small" variant={active ? "primary" : "secondary"} aria-pressed={active} onClick={onClick} title={title} disabled={disabled} className="shrink-0 gap-x-1.5 whitespace-nowrap [&_svg]:size-4">
      {icon}
      {label}
      {typeof count === "number" ? (
        <span
          className={clx(
            "txt-compact-xsmall-plus rounded-full px-1.5 tabular-nums",
            active ? "bg-white/20" : attention && count > 0 ? "bg-ui-tag-orange-bg text-ui-tag-orange-text" : "bg-ui-bg-component text-ui-fg-muted",
          )}
        >
          {count}
        </span>
      ) : null}
    </Button>
  )
}

/** A thin vertical line between groups of filters (all, kinds, states). */
export function FilterDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-ui-border-base" />
}

/** A value that follows `value` after `ms` without changes: search a list without a request per letter. */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

/**
 * The search field of a list: `type="search"`, so Medusa's Input draws its
 * magnifier and a clear button (never an icon of our own laid over the field).
 * The placeholder names what it finds: "Order, invoice number, e-mail".
 */
export function SearchInput({ value, onChange, placeholder, className, autoFocus, label }: { value: string; onChange: (value: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; label?: string }) {
  const { text } = useKitText()
  return (
    <Input
      size="small"
      type="search"
      autoFocus={autoFocus}
      aria-label={label ?? placeholder ?? text.search}
      placeholder={placeholder ?? text.search}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clx("w-full sm:w-64", className)}
    />
  )
}

/** One action of a row: an icon with its name as the tooltip. A link when `href` is set. */
export type RowAction = {
  key: string
  /** The name of the action: the tooltip and what a screen reader says. */
  label: string
  icon: ReactNode
  onClick?: () => void
  href?: string
  /** Opens `href` in a new tab (a page outside the admin). */
  external?: boolean
  disabled?: boolean
  loading?: boolean
  /** Red icon: the action removes or cancels something. */
  danger?: boolean
  /** Leave the action out (lets a page write conditions in the list). */
  hidden?: boolean
}

/**
 * The actions of a table row, each visible as an icon button with a title:
 * never a "..." menu. A click on an action does not open the row.
 */
export function RowActions({ actions, className }: { actions: RowAction[]; className?: string }) {
  const shown = actions.filter((a) => !a.hidden)
  if (!shown.length) return null
  const stop = (e: MouseEvent) => e.stopPropagation()
  return (
    <span className={clx("inline-flex items-center justify-end gap-0.5", className)} onClick={stop}>
      {shown.map((a) => {
        const icon = a.loading ? <ArrowPath className="animate-spin" /> : a.icon
        const tone = a.danger ? "text-ui-tag-red-icon" : "text-ui-fg-subtle"
        if (a.href && !a.disabled) {
          return (
            <a
              key={a.key}
              href={a.href}
              title={a.label}
              aria-label={a.label}
              {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}
              className={clx("inline-flex size-7 items-center justify-center rounded-md outline-none transition-fg hover:bg-ui-bg-base-hover focus-visible:shadow-borders-focus", tone)}
            >
              {icon}
            </a>
          )
        }
        return (
          <IconButton key={a.key} size="small" variant="transparent" title={a.label} aria-label={a.label} disabled={a.disabled || a.loading} onClick={() => a.onClick?.()} className={tone}>
            {icon}
          </IconButton>
        )
      })}
    </span>
  )
}

/**
 * What a list says when it has nothing to show: an icon and a short phrase
 * ("No payments in 30 days"), optional key points (why, what next) and one
 * action. Never an empty table, never a paragraph.
 */
export function EmptyState({ icon, title, points, action, compact = false, className }: { icon?: ReactNode; title?: ReactNode; points?: KeyPointItem[]; action?: ReactNode; compact?: boolean; className?: string }) {
  const { text } = useKitText()
  return (
    <div className={clx("flex flex-col items-center justify-center gap-y-2 px-6 text-center", compact ? "py-5" : "py-10", className)}>
      {icon ? <span className="flex size-9 items-center justify-center rounded-lg border border-ui-border-base bg-ui-bg-component text-ui-fg-muted shadow-elevation-card-rest [&_svg]:size-5">{icon}</span> : null}
      <Text size="small" weight="plus" className="text-ui-fg-subtle">
        {title ?? text.empty}
      </Text>
      {points ? <KeyPoints items={points} className="max-w-full justify-center" /> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}

/** EmptyState inside a table body: one cell across the columns. */
export function EmptyTableRow({ cols, ...props }: { cols: number } & Parameters<typeof EmptyState>[0]) {
  return (
    <tr>
      <td colSpan={cols}>
        <EmptyState compact {...props} />
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/* Layout: sections, the detail page header, counters */

/**
 * A section of a page: a card with its heading (the icon, the title, key
 * points under it) and the actions on the right; under it the content
 * (`FilterBar`, a table, `StatTiles`). The heading takes the whole width:
 * no max-width on the points.
 */
export function Section({
  id,
  icon,
  title,
  badges,
  points,
  pointsLabel,
  description,
  actions,
  children,
  className,
}: {
  id?: string
  icon?: ReactNode
  title: ReactNode
  badges?: ReactNode
  points?: KeyPointItem[]
  /** The sentence the points stand for: their tooltip and accessible label. */
  pointsLabel?: string
  /** A plain line instead of points, only where a phrase cannot say it. */
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <Container id={id} className={clx("scroll-mt-4 divide-y p-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {icon ? <span className="flex shrink-0 text-ui-fg-subtle [&_svg]:size-[18px]">{icon}</span> : null}
            <Heading level="h2">{title}</Heading>
            {badges ? <span className="flex flex-wrap items-center gap-1.5">{badges}</span> : null}
          </div>
          {points ? <KeyPoints items={points} label={pointsLabel} /> : null}
          {description ? <div className="txt-small min-w-0 text-ui-fg-subtle">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </Container>
  )
}

/**
 * The header of a detail page (one record: an order of the plugin, a task, a
 * negotiation), the top of IntegrationHeader without the view tabs: a back
 * link, the icon, the title and its badges, the key points, and the actions
 * in the grey bar under it. `back.href` is a plain link (no react-router, so
 * it works in widgets too).
 */
export function SubpageHeader({
  icon,
  title,
  badges,
  points,
  pointsLabel,
  back,
  actions,
  children,
}: {
  icon?: ReactNode
  title: ReactNode
  badges?: ReactNode
  points?: KeyPointItem[]
  pointsLabel?: string
  back?: { href: string; label: string }
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-3 px-6 pb-5 pt-5">
        {back ? (
          <a href={back.href} className="txt-compact-small-plus inline-flex w-fit items-center gap-x-1 text-ui-fg-subtle transition-fg hover:text-ui-fg-base">
            <ArrowLeftMini />
            {back.label}
          </a>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {icon ? <span className="flex shrink-0">{icon}</span> : null}
          <Heading level="h1">{title}</Heading>
          {badges ? <span className="flex flex-wrap items-center gap-1.5">{badges}</span> : null}
        </div>
        {points ? <KeyPoints items={points} label={pointsLabel} /> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-end gap-2 bg-ui-bg-subtle px-6 py-2.5">{actions}</div> : null}
      {children}
    </Container>
  )
}

const GRID: Record<2 | 3 | 4 | 5 | 6 | 7, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-3 xl:grid-cols-5",
  6: "md:grid-cols-3 xl:grid-cols-6",
  7: "md:grid-cols-4 xl:grid-cols-7",
}

/** The grid of counters under the header or a section heading. */
export function StatTiles({ children, columns = 4, className }: { children: ReactNode; columns?: 2 | 3 | 4 | 5 | 6 | 7; className?: string }) {
  return <div className={clx("grid grid-cols-2 gap-3 px-6 py-4", GRID[columns], className)}>{children}</div>
}

/**
 * A counter: a coloured dot (or an icon) with its name, the number, a short
 * hint. With `onClick` it is a filter of the list below: the active one has
 * the blue frame, a second click clears it. The tone follows the palette:
 * orange or red only while there is something to do (`tone={n > 0 ? "orange" : "grey"}`).
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "grey",
  icon,
  active = false,
  onClick,
  title,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
  icon?: ReactNode
  active?: boolean
  onClick?: () => void
  title?: string
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-x-2">
        {icon ? <span className={clx("flex shrink-0 [&_svg]:size-3.5", ICON[tone])}>{icon}</span> : <span aria-hidden className={clx("size-1.5 shrink-0 rounded-full", DOT[tone])} />}
        <Text size="xsmall" className="truncate text-ui-fg-subtle">
          {label}
        </Text>
      </span>
      <span className="txt-xlarge-plus max-w-full break-words tabular-nums text-ui-fg-base">{value}</span>
      {hint ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          {hint}
        </Text>
      ) : null}
    </>
  )
  const cls = clx(
    "flex h-full min-w-0 flex-col items-start gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
    active ? "border-ui-border-interactive bg-ui-bg-base shadow-borders-interactive-with-active" : "border-ui-border-base bg-ui-bg-subtle",
  )
  return onClick ? (
    <button type="button" aria-pressed={active} title={title} onClick={onClick} className={clx(cls, !active && "hover:bg-ui-bg-base-hover")}>
      {body}
    </button>
  ) : (
    <div title={title} className={cls}>
      {body}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Waiting: a long run in stages */

export type StageStatus = "queued" | "running" | "done" | "error"

/** One stage as the server (or the page) reports it: `done` of `total` while it runs. */
export type StageState = { status: StageStatus; done?: number; total?: number; note?: string }

/** The whole run: the server keeps it, the page polls it. */
export type StageRun = {
  status: StageStatus
  started_at: string
  finished_at?: string | null
  steps: Record<string, StageState>
  log?: Array<{ at: string; text: string }>
  error?: string | null
}

export type StageDef = {
  key: string
  /** The full name, shown as "Now: ...". */
  name: string
  /** The short name on the stage tile. */
  short: string
  icon: ReactNode
  /** The share of the stage in the whole run; the weights need not add up to 100. */
  weight: number
}

/**
 * A run made on the page itself (several requests in a row): the run's
 * status follows the steps (an error wins, then running, then done).
 */
export function runFromSteps(steps: Record<string, StageState>, startedAt: string | number | Date, log: StageRun["log"] = []): StageRun {
  const all = Object.values(steps)
  const status: StageStatus = all.some((s) => s.status === "error") ? "error" : all.some((s) => s.status === "running") ? "running" : all.length && all.every((s) => s.status === "done") ? "done" : all.some((s) => s.status === "done") ? "running" : "queued"
  return {
    status,
    started_at: new Date(startedAt).toISOString(),
    finished_at: status === "done" || status === "error" ? new Date().toISOString() : null,
    steps,
    log,
    error: all.find((s) => s.status === "error")?.note ?? null,
  }
}

/** "42 s", "3 min 05 s". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`
}

const GRID_STAGES: Record<3 | 4 | 5 | 6, string> = {
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-3 lg:grid-cols-6",
}

/**
 * The loader of a long run (a report, an import, a sync): a ring with the
 * percent, the current stage with its icon and its own bar, the stage tiles
 * (waiting, running, done, error), the time it takes and about how long is
 * left, the log to open, and "Try again" after an error. For a short read
 * use KitLoading or KitSkeletonRows (kit.tsx) instead.
 */
export function StagedLoader({ run, stages, doneTitle, columns = 6, onRetry }: { run: StageRun; stages: StageDef[]; doneTitle?: string; columns?: 3 | 4 | 5 | 6; onRetry?: () => void }) {
  const { text, locale } = useKitText()
  const [openLog, setOpenLog] = useState(false)
  const [now, setNow] = useState(Date.now())
  const live = run.status === "running" || run.status === "queued"
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [live])

  const share = (key: string) => {
    const s = run.steps[key] ?? { status: "queued" }
    if (s.status === "done" || s.status === "error") return 1
    if (s.status === "running") return s.total ? Math.min(1, (s.done ?? 0) / s.total) : 0.3
    return 0
  }
  const weights = stages.reduce((sum, e) => sum + e.weight, 0) || 1
  const pct = Math.round((stages.reduce((sum, e) => sum + e.weight * share(e.key), 0) / weights) * 100)
  const start = new Date(run.started_at).getTime()
  const end = run.finished_at ? new Date(run.finished_at).getTime() : now
  const elapsed = Math.max(0, end - start)
  const left = run.status === "running" && pct >= 5 && pct < 100 ? (elapsed * (100 - pct)) / pct : null
  const current = stages.find((e) => run.steps[e.key]?.status === "running")
  const cs = current ? run.steps[current.key] : null
  const log = run.log ?? []
  const number = (n: number) => new Intl.NumberFormat(locale).format(n)

  const R = 46
  const C = 2 * Math.PI * R
  const ring = run.status === "error" ? "var(--tag-red-icon)" : run.status === "done" ? "var(--tag-green-icon)" : "var(--fg-interactive)"

  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-y-4 px-6 py-5">
      <div className="flex flex-col items-center gap-6 rounded-xl border border-ui-border-base bg-ui-bg-subtle p-5 sm:flex-row">
        <div className="relative size-32 shrink-0">
          <svg viewBox="0 0 110 110" className="size-32 -rotate-90" aria-hidden>
            <circle cx="55" cy="55" r={R} fill="none" stroke="var(--border-base)" strokeWidth="9" />
            <circle cx="55" cy="55" r={R} fill="none" stroke={ring} strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .6s ease" }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="txt-xlarge-plus tabular-nums text-ui-fg-base">{pct}%</span>
            <span className="txt-compact-xsmall text-ui-fg-muted">{run.status === "done" ? text.pctDone : run.status === "error" ? text.pctError : run.status === "queued" ? text.pctQueued : text.pctRunning}</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-y-2">
          <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
            {run.status === "running" ? text.now : run.status === "queued" ? text.next : run.status === "done" ? text.counted : text.stopped}
          </Text>
          <span className="flex min-w-0 items-center gap-2 [&_svg]:size-5">
            <span className={clx("flex shrink-0", run.status === "error" ? "text-ui-tag-red-icon" : run.status === "done" ? "text-ui-tag-green-icon" : "text-ui-fg-interactive")}>
              {current ? current.icon : run.status === "error" ? <XCircleSolid /> : run.status === "queued" ? <Clock /> : <CheckCircleSolid />}
            </span>
            <Text size="large" weight="plus" className="truncate">
              {current ? current.name : run.status === "done" ? doneTitle ?? text.ready : run.status === "queued" ? text.queued : run.error ?? text.error}
            </Text>
          </span>
          {cs?.total ? (
            <div className="flex flex-col gap-1">
              <div className="h-2 overflow-hidden rounded-full bg-ui-bg-component">
                <div className="h-full rounded-full bg-ui-fg-interactive transition-all" style={{ width: `${Math.min(100, Math.round(((cs.done ?? 0) / cs.total) * 100))}%` }} />
              </div>
              <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">
                {number(cs.done ?? 0)} {text.of} {number(cs.total)}
                {cs.note ? `, ${cs.note}` : ""}
              </Text>
            </div>
          ) : cs?.note ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {cs.note}
            </Text>
          ) : null}
          <KeyPoints
            items={[
              { icon: <Clock />, text: text.running(formatDuration(elapsed)) },
              left !== null && { icon: <Sparkles />, text: text.left(formatDuration(left)), tone: "blue" },
              run.status === "done" && { icon: <CheckCircleSolid />, text: text.clean, tone: "green" },
            ]}
          />
        </div>
      </div>

      <ol className={clx("grid gap-2", GRID_STAGES[columns])}>
        {stages.map((e) => {
          const s = run.steps[e.key] ?? { status: "queued" as const }
          const p = s.total ? Math.min(100, Math.round(((s.done ?? 0) / s.total) * 100)) : s.status === "done" ? 100 : 0
          return (
            <li
              key={e.key}
              className={clx(
                "relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-lg border px-3 py-2.5",
                s.status === "running"
                  ? "border-ui-border-interactive bg-ui-bg-highlight shadow-borders-interactive-with-active"
                  : s.status === "done"
                    ? "border-ui-tag-green-border bg-ui-tag-green-bg"
                    : s.status === "error"
                      ? "border-ui-tag-red-border bg-ui-tag-red-bg"
                      : "border-ui-border-base bg-ui-bg-base opacity-70",
              )}
            >
              <span className="flex items-center justify-between gap-1">
                <span className={clx("flex [&_svg]:size-4", s.status === "running" ? "text-ui-fg-interactive" : s.status === "done" ? "text-ui-tag-green-icon" : s.status === "error" ? "text-ui-tag-red-icon" : "text-ui-fg-muted")}>{e.icon}</span>
                {s.status === "done" ? (
                  <CheckCircleSolid className="size-4 text-ui-tag-green-icon" />
                ) : s.status === "running" ? (
                  <ArrowPath className="size-4 animate-spin text-ui-fg-interactive" />
                ) : s.status === "error" ? (
                  <XCircleSolid className="size-4 text-ui-tag-red-icon" />
                ) : null}
              </span>
              <Text size="xsmall" weight="plus" className="truncate">
                {e.short}
              </Text>
              <Text size="xsmall" className="truncate tabular-nums text-ui-fg-subtle">
                {s.total ? `${number(s.done ?? 0)} / ${number(s.total)}` : s.done !== undefined ? number(s.done) : s.status === "queued" ? text.waiting : s.note ?? ""}
              </Text>
              {s.status === "running" ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-ui-fg-interactive transition-all" style={{ width: `${p}%` }} /> : null}
            </li>
          )
        })}
      </ol>

      {log.length ? (
        <div className="rounded-lg border border-ui-border-base">
          <button type="button" aria-expanded={openLog} onClick={() => setOpenLog((v) => !v)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-ui-bg-base-hover">
            <Text size="xsmall" weight="plus" className="uppercase tracking-wide text-ui-fg-muted">
              {text.log} ({log.length})
            </Text>
            <TriangleRightMini className={clx("text-ui-fg-muted transition-transform", openLog && "rotate-90")} />
          </button>
          {openLog ? (
            <div className="txt-compact-xsmall flex max-h-56 flex-col gap-y-0.5 overflow-y-auto rounded-b-lg border-t border-ui-border-base bg-ui-bg-subtle px-3 py-2 font-mono text-ui-fg-subtle">
              {log.map((l, i) => (
                <span key={i}>
                  <span className="text-ui-fg-muted">{new Date(l.at).toLocaleTimeString(locale)}</span> {l.text}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {run.status === "error" && (run.error || onRetry) ? (
        <InlineTip variant="error" label={text.error}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{run.error}</span>
            {onRetry ? (
              <Button size="small" variant="secondary" onClick={onRetry}>
                <ArrowPath />
                {text.retry}
              </Button>
            ) : null}
          </span>
        </InlineTip>
      ) : null}
    </div>
  )
}
