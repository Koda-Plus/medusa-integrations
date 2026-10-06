import { useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowUpRightOnBox, CheckCircleSolid, ChevronDownMini, CogSixTooth, InformationCircleSolid, SquareTwoStack } from "@medusajs/icons"
import { Badge, Container, Heading, IconButton, Popover, StatusBadge, Text, clx, toast } from "@medusajs/ui"

/*
 * The page kit of the Koda Plus integrations: the same components in every
 * package (copied as src/admin/lib/<ns>-guide.tsx), so the five integration
 * pages share one look.
 *
 * Header
 *   usePageNav       Panel, Setup guide or Settings, and the settings tab, kept in ?view= and ?tab=
 *   ViewSwitch       "Panel | Setup guide"
 *   SettingsButton   the cog that opens Settings, where the technical parts live
 *   ModeBadge        the mode of the module; in demo mode it opens a note on what is simulated
 *   ReferencesBadge  "Running in N stores", with the rating and its source; opens the list
 * Settings
 *   SettingsView     a title and tabs over the technical sections (account, writers, plans, history)
 * Guide
 *   References       "Running in production" cards, at the end of the guide
 *   GuideIntro       what the setup takes: time, what you need, a short overview
 *   GuideSteps       numbered steps with a live state (done / to do / optional)
 *   GuideDiagram     boxes and arrows for how the parts talk to each other
 *   GuideChecklist   go-live checklist with ticks from the live status
 *   GuideFaq         troubleshooting, one question per row, opens in place
 *
 * Every string comes in through props, already translated by the page.
 */

/* ------------------------------------------------------------------ */
/* The page view, kept in the URL so a link can open the guide or a settings tab */

export type PageView = "panel" | "guide" | "settings"

export type PageNav<T extends string> = {
  view: PageView
  /** The settings tab; the first one when the URL names none. */
  tab: T
  go: (view: PageView, tab?: T) => void
}

export function usePageNav<T extends string>(tabs: readonly T[]): PageNav<T> {
  const [params, setParams] = useSearchParams()
  const raw = params.get("view")
  const view: PageView = raw === "guide" || raw === "settings" ? raw : "panel"
  const asked = params.get("tab") ?? ""
  const tab = ((tabs as readonly string[]).includes(asked) ? asked : tabs[0]) as T
  const go = (next: PageView, nextTab?: T) => {
    const p = new URLSearchParams(params)
    if (next === "panel") p.delete("view")
    else p.set("view", next)
    if (next === "settings") p.set("tab", nextTab ?? tab)
    else p.delete("tab")
    setParams(p, { replace: true })
  }
  return { view, tab, go }
}

/** Panel or guide only, for a page without settings. */
export function usePageView(): [PageView, (v: PageView) => void] {
  const nav = usePageNav(["main"] as const)
  return [nav.view, (v) => nav.go(v)]
}

export function ViewSwitch({ value, onChange, labels }: { value: PageView; onChange: (v: "panel" | "guide") => void; labels: Record<"panel" | "guide", string> }) {
  return (
    <div className="inline-flex rounded-full border border-ui-border-base bg-ui-bg-component p-0.5" role="tablist">
      {(["panel", "guide"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={clx(
            "txt-compact-small-plus rounded-full px-3 py-1 transition-fg",
            value === v ? "bg-ui-bg-interactive text-ui-fg-on-color" : "text-ui-fg-subtle hover:text-ui-fg-base",
          )}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  )
}

export function SettingsButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <IconButton
      type="button"
      size="small"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={clx(active && "bg-ui-bg-component-pressed text-ui-fg-base shadow-borders-interactive-with-active")}
    >
      <CogSixTooth />
    </IconButton>
  )
}

/* ------------------------------------------------------------------ */
/* Header badges */

type BadgeColor = "green" | "orange" | "red" | "blue" | "grey" | "purple"

/**
 * The mode of the module. With `children` (the demo note, a missing setting)
 * the badge opens it in a popover instead of a note across the page.
 */
export function ModeBadge({ color, label, title, children }: { color: BadgeColor; label: string; title?: string; children?: ReactNode }) {
  if (!children) return <StatusBadge color={color}>{label}</StatusBadge>
  return (
    <Popover>
      <Popover.Trigger asChild>
        <button type="button" className="inline-flex rounded-full outline-none transition-fg hover:opacity-80 focus-visible:shadow-borders-focus" aria-label={title ?? label}>
          <StatusBadge color={color} className="cursor-pointer">
            <span className="inline-flex items-center gap-x-1">
              {label}
              <InformationCircleSolid className="h-3 w-3 opacity-70" />
            </span>
          </StatusBadge>
        </button>
      </Popover.Trigger>
      <Popover.Content align="start" sideOffset={8} className="w-[min(440px,calc(100vw-32px))] p-0">
        <div className="border-b border-ui-border-base px-4 py-3">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {title ?? label}
          </Text>
        </div>
        <div className="txt-small flex max-h-[60vh] flex-col gap-y-3 overflow-y-auto px-4 py-3 text-ui-fg-subtle">{children}</div>
      </Popover.Content>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* Running in production */

/** A rating of the work at that store, on a review platform such as Clutch. */
export type ReferenceReview = {
  rating: number
  /** The top of the scale, 5 by default. */
  scale: number
  /** Who rated: the platform, e.g. "Clutch". */
  source: string
  /** The review itself. */
  url?: string | null
  /** The source's mark: a data URI or an https URL, shown on a white chip. */
  icon?: string | null
  quote?: string
  author?: string | null
}

/** One live store, already in the language of the admin (the page picks en or pl from the option). */
export type Reference = {
  name: string
  url: string
  /** The store's own icon (its favicon or logo mark): a data URI or an https URL. Without one the card shows the first letter. */
  icon?: string | null
  description?: string
  since?: string
  metrics?: Array<{ label: string; value: string }>
  /** Pages where the integration can be seen at work, e.g. a product with its Allegro link. */
  links?: Array<{ label: string; url: string }>
  review?: ReferenceReview | null
}

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url
  }
}

const STAR = "M10 1.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L10 14.9l-5.25 2.75 1-5.85L1.5 7.7l5.9-.9L10 1.5z"

/** Stars out of five, filled to the rating (a 4.5 fills four and a half). */
export function Stars({ rating, scale = 5, size = 12 }: { rating: number; scale?: number; size?: number }) {
  const fill = Math.max(0, Math.min(1, rating / (scale || 5))) * 100
  const row = (color: string) => (
    <span className="flex gap-x-px" style={{ color }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 20 20" aria-hidden>
          <path d={STAR} fill="currentColor" />
        </svg>
      ))}
    </span>
  )
  return (
    <span className="relative inline-flex shrink-0" aria-hidden>
      {row("var(--fg-disabled)")}
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill}%` }}>
        {row("#F5A524")}
      </span>
    </span>
  )
}

/** The source of a rating: its mark on a white chip (marks are drawn for light backgrounds), or its name. */
function SourceMark({ review, height = 10 }: { review: ReferenceReview; height?: number }) {
  if (!review.icon) {
    return (
      <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
        {review.source}
      </Text>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-white px-1.5 py-0.5 shadow-borders-base">
      <img src={review.icon} alt={review.source} style={{ height, width: "auto" }} />
    </span>
  )
}

function StoreIcon({ reference, size }: { reference: Reference; size: number }) {
  const box = { width: size, height: size }
  return reference.icon ? (
    <img src={reference.icon} alt="" width={size} height={size} style={box} className="shrink-0 rounded-md bg-white object-contain shadow-borders-base" />
  ) : (
    <span style={box} className="txt-compact-xsmall-plus flex shrink-0 items-center justify-center rounded-md bg-ui-bg-base text-ui-fg-base shadow-borders-base">
      {reference.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export type ReferencesLabels = {
  /** On the badge: "Running in 1 store", "Działa w 3 sklepach". */
  count: string
  title: string
  subtitle: string
  open: string
  /** "Read the review". */
  review: string
  since: (since: string) => string
  /** A rating in the admin's number format, e.g. "5.0" or "5,0". */
  rating: (value: number) => string
}

/** The mean of the ratings, on a five star scale, or null when nobody rated. */
function meanRating(items: Reference[]): { value: number; first: ReferenceReview } | null {
  const reviews = items.map((r) => r.review).filter((r): r is ReferenceReview => Boolean(r))
  if (reviews.length === 0) return null
  const value = reviews.reduce((sum, r) => sum + (r.rating / (r.scale || 5)) * 5, 0) / reviews.length
  return { value: Math.round(value * 10) / 10, first: reviews[0] }
}

/**
 * "Running in N stores" in the page header: the stores' icons, the mean
 * rating with the stars and where it comes from. Opens the list of stores
 * with their numbers, the review and its link.
 */
export function ReferencesBadge({ items, labels }: { items: Reference[]; labels: ReferencesLabels }) {
  if (items.length === 0) return null
  const mean = meanRating(items)
  return (
    <Popover>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-x-2 rounded-full border border-ui-border-base bg-ui-bg-component py-0.5 pl-0.5 pr-2 outline-none transition-fg hover:bg-ui-bg-component-hover focus-visible:shadow-borders-focus"
        >
          <span className="flex shrink-0 items-center">
            {items.slice(0, 3).map((r, i) => (
              <span key={r.url} className={clx("rounded-md", i > 0 && "-ml-1.5")}>
                <StoreIcon reference={r} size={20} />
              </span>
            ))}
          </span>
          <span className="txt-compact-xsmall-plus truncate text-ui-fg-base">{labels.count}</span>
          {mean ? (
            <span className="flex shrink-0 items-center gap-x-1.5">
              <Stars rating={mean.value} />
              <span className="txt-compact-xsmall-plus tabular-nums text-ui-fg-base">{labels.rating(mean.value)}</span>
              <SourceMark review={mean.first} height={9} />
            </span>
          ) : null}
          <ChevronDownMini className="shrink-0 text-ui-fg-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Content align="start" sideOffset={8} className="w-[min(460px,calc(100vw-32px))] p-0">
        <div className="flex flex-col gap-y-0.5 border-b border-ui-border-base px-4 py-3">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {labels.title}
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {labels.subtitle}
          </Text>
        </div>
        <ul className="flex max-h-[60vh] flex-col divide-y divide-ui-border-base overflow-y-auto">
          {items.map((r) => (
            <li key={r.url} className="flex flex-col gap-y-2 px-4 py-3">
              <a href={r.url} target="_blank" rel="noreferrer" className="group flex items-center gap-x-3">
                <StoreIcon reference={r} size={32} />
                <span className="flex min-w-0 flex-col">
                  <Text size="small" weight="plus" className="truncate text-ui-fg-base">
                    {r.name}
                  </Text>
                  <Text size="xsmall" className="truncate text-ui-fg-interactive group-hover:text-ui-fg-interactive-hover">
                    {host(r.url)}
                  </Text>
                </span>
                <ArrowUpRightOnBox className="ml-auto shrink-0 text-ui-fg-muted group-hover:text-ui-fg-interactive" />
              </a>
              {r.review ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Stars rating={r.review.rating} scale={r.review.scale} />
                  <span className="txt-compact-xsmall-plus tabular-nums text-ui-fg-base">{labels.rating((r.review.rating / (r.review.scale || 5)) * 5)}</span>
                  <SourceMark review={r.review} />
                  {r.review.url ? (
                    <a href={r.review.url} target="_blank" rel="noreferrer" className="txt-compact-xsmall-plus inline-flex items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                      {labels.review}
                      <ArrowUpRightOnBox className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>
              ) : null}
              {r.review?.quote ? (
                <Text size="xsmall" className="border-l-2 border-ui-border-strong pl-2 italic text-ui-fg-subtle">
                  {r.review.quote}
                  {r.review.author ? <span className="not-italic text-ui-fg-muted"> {r.review.author}</span> : null}
                </Text>
              ) : null}
              {r.description ? (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {r.description}
                </Text>
              ) : null}
              {r.metrics?.length || r.since ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(r.metrics ?? []).map((m) => (
                    <Badge key={m.label} size="2xsmall" color="green">
                      <span className="tabular-nums">{m.value}</span>&nbsp;{m.label}
                    </Badge>
                  ))}
                  {r.since ? (
                    <Badge size="2xsmall" color="grey">
                      {labels.since(r.since)}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
              {(r.links ?? []).length ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {(r.links ?? []).map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="txt-compact-xsmall-plus inline-flex items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                      {l.label}
                      <ArrowUpRightOnBox className="h-3.5 w-3.5" />
                    </a>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Popover.Content>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* Settings */

export type SettingsTab<T extends string> = {
  id: T
  label: string
  /** A count or a word next to the label, e.g. armed writers or open plans. */
  badge?: string | number | null
  tone?: BadgeColor
}

/** Settings: a title and tabs over the technical sections; the page renders the open tab below. */
export function SettingsView<T extends string>({
  title,
  subtitle,
  tabs,
  value,
  onChange,
  children,
}: {
  title: string
  subtitle: string
  tabs: Array<SettingsTab<T>>
  value: T
  onChange: (tab: T) => void
  children: ReactNode
}) {
  return (
    <>
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-y-1 px-6 py-4">
          <Heading level="h2">{title}</Heading>
          <Text size="small" className="max-w-3xl text-ui-fg-subtle">
            {subtitle}
          </Text>
        </div>
        <div role="tablist" aria-label={title} className="flex gap-x-1 overflow-x-auto px-4 py-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={value === tab.id}
              onClick={() => onChange(tab.id)}
              className={clx(
                "txt-compact-small-plus inline-flex shrink-0 items-center gap-x-1.5 rounded-md px-3 py-1.5 outline-none transition-fg focus-visible:shadow-borders-focus",
                value === tab.id ? "bg-ui-bg-component text-ui-fg-base shadow-borders-base" : "text-ui-fg-subtle hover:bg-ui-bg-component-hover hover:text-ui-fg-base",
              )}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge !== null && tab.badge !== 0 && tab.badge !== "" ? (
                <Badge size="2xsmall" color={tab.tone ?? "grey"}>
                  <span className="tabular-nums">{tab.badge}</span>
                </Badge>
              ) : null}
            </button>
          ))}
        </div>
      </Container>
      {children}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Running in production, as cards at the end of the guide */

export function References({ items, title, subtitle, openLabel, sinceLabel, reviewLabel, ratingLabel }: { items: Reference[]; title: string; subtitle: string; openLabel: string; sinceLabel: (since: string) => string; reviewLabel?: string; ratingLabel?: (value: number) => string }) {
  if (items.length === 0) return null
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {subtitle}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => (
          <div key={r.url} className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-component px-4 py-3">
            <a href={r.url} target="_blank" rel="noreferrer" className="group flex items-center gap-x-3">
              {r.icon ? (
                <img src={r.icon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-md bg-white object-contain shadow-borders-base" />
              ) : (
                <span className="txt-compact-medium-plus flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ui-bg-base text-ui-fg-base shadow-borders-base">
                  {r.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <Text size="small" weight="plus" className="truncate text-ui-fg-base">
                  {r.name}
                </Text>
                <Text size="xsmall" className="truncate text-ui-fg-interactive group-hover:text-ui-fg-interactive-hover">
                  {host(r.url)}
                </Text>
              </span>
              <ArrowUpRightOnBox className="ml-auto shrink-0 text-ui-fg-muted group-hover:text-ui-fg-interactive" />
            </a>
            {r.review ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Stars rating={r.review.rating} scale={r.review.scale} />
                <span className="txt-compact-xsmall-plus tabular-nums text-ui-fg-base">
                  {(ratingLabel ?? ((v: number) => v.toFixed(1)))((r.review.rating / (r.review.scale || 5)) * 5)}
                </span>
                <SourceMark review={r.review} />
                {r.review.url && reviewLabel ? (
                  <a href={r.review.url} target="_blank" rel="noreferrer" className="txt-compact-xsmall-plus inline-flex items-center gap-x-0.5 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                    {reviewLabel}
                    <ArrowUpRightOnBox className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            ) : null}
            {r.description ? (
              <Text size="small" className="text-ui-fg-subtle">
                {r.description}
              </Text>
            ) : null}
            {r.metrics?.length || r.since ? (
              <div className="flex flex-wrap items-center gap-2">
                {(r.metrics ?? []).map((m) => (
                  <Badge key={m.label} size="2xsmall" color="green">
                    <span className="tabular-nums">{m.value}</span>&nbsp;{m.label}
                  </Badge>
                ))}
                {r.since ? (
                  <Badge size="2xsmall" color="grey">
                    {sinceLabel(r.since)}
                  </Badge>
                ) : null}
              </div>
            ) : null}
            <div className="mt-auto flex flex-col gap-y-1 border-t border-ui-border-base pt-2">
              {(r.links ?? []).map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="txt-compact-small inline-flex w-fit items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                  {l.label}
                  <ArrowUpRightOnBox className="shrink-0" />
                </a>
              ))}
              <a href={r.url} target="_blank" rel="noreferrer" className="txt-compact-small-plus inline-flex w-fit items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                {openLabel}
                <ArrowUpRightOnBox className="shrink-0" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </Container>
  )
}

/* ------------------------------------------------------------------ */
/* Guide */

export function GuideIntro({ title, text, time, needs, needsLabel, timeLabel }: { title: string; text: ReactNode; time: string; needs: string[]; needsLabel: string; timeLabel: string }) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {text}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-4 md:grid-cols-[200px_1fr]">
        <div className="flex flex-col gap-y-1">
          <Text size="xsmall" className="text-ui-fg-muted">
            {timeLabel}
          </Text>
          <Text size="small" weight="plus">
            {time}
          </Text>
        </div>
        <div className="flex flex-col gap-y-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {needsLabel}
          </Text>
          <div className="flex flex-wrap gap-2">
            {needs.map((n) => (
              <Badge key={n} size="small" color="grey">
                {n}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </Container>
  )
}

export type StepState = "done" | "todo" | "optional" | "later"

export type GuideStep = {
  id: string
  title: string
  state: StepState
  body: ReactNode
  /** Commands, environment variables or options, shown in a copyable block. */
  code?: string
  link?: { label: string; href: string }
  /** What the person should see when the step worked. */
  check?: string
}

const STATE_TONE: Record<StepState, "green" | "orange" | "grey" | "blue"> = { done: "green", todo: "orange", optional: "grey", later: "blue" }

export function CodeBlock({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-subtle">
      <pre className="txt-compact-small overflow-x-auto px-4 py-3 pr-12 font-mono text-ui-fg-base">{code}</pre>
      <button
        type="button"
        aria-label={copyLabel}
        title={copyLabel}
        className="absolute right-2 top-2 rounded-md p-1.5 text-ui-fg-muted transition-fg hover:bg-ui-bg-component-hover hover:text-ui-fg-base"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => toast.success(copiedLabel))
        }}
      >
        <SquareTwoStack />
      </button>
    </div>
  )
}

export function GuideSteps({
  title,
  subtitle,
  steps,
  stateLabels,
  checkLabel,
  copyLabel,
  copiedLabel,
}: {
  title: string
  subtitle?: string
  steps: GuideStep[]
  stateLabels: Record<StepState, string>
  checkLabel: string
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        {subtitle ? (
          <Text size="small" className="text-ui-fg-subtle">
            {subtitle}
          </Text>
        ) : null}
      </div>
      <ol className="flex flex-col px-6 py-5">
        {steps.map((s, i) => {
          const last = i === steps.length - 1
          return (
            <li key={s.id} className="relative flex gap-x-4 pb-6 last:pb-0">
              {!last ? <span aria-hidden className="absolute left-[13px] top-8 bottom-0 w-px bg-ui-border-base" /> : null}
              <span
                className={clx(
                  "txt-compact-small-plus relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                  s.state === "done" ? "border-ui-tag-green-border bg-ui-tag-green-bg text-ui-tag-green-text" : "border-ui-border-base bg-ui-bg-base text-ui-fg-subtle",
                )}
              >
                {s.state === "done" ? <CheckCircleSolid className="text-ui-tag-green-icon" /> : i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-y-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Text size="base" weight="plus" className="text-ui-fg-base">
                    {s.title}
                  </Text>
                  <Badge size="2xsmall" color={STATE_TONE[s.state]}>
                    {stateLabels[s.state]}
                  </Badge>
                </div>
                <div className="txt-small flex max-w-3xl flex-col gap-y-2 text-ui-fg-subtle">{s.body}</div>
                {s.code ? <CodeBlock code={s.code} copyLabel={copyLabel} copiedLabel={copiedLabel} /> : null}
                {s.link ? (
                  <a href={s.link.href} target="_blank" rel="noreferrer" className="txt-compact-small-plus inline-flex w-fit items-center gap-x-1 text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
                    {s.link.label}
                    <ArrowUpRightOnBox />
                  </a>
                ) : null}
                {s.check ? (
                  <div className="flex max-w-3xl gap-x-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
                    <CheckCircleSolid className="mt-0.5 shrink-0 text-ui-tag-green-icon" />
                    <Text size="small" className="text-ui-fg-subtle">
                      <span className="font-medium text-ui-fg-base">{checkLabel}</span> {s.check}
                    </Text>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </Container>
  )
}

/* Boxes in a row with arrows between them, wrapping on narrow screens. */
export type DiagramNode = { title: string; caption?: string; accent?: boolean }

export function GuideDiagram({ title, subtitle, nodes, links }: { title: string; subtitle?: string; nodes: DiagramNode[]; links: string[] }) {
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        {subtitle ? (
          <Text size="small" className="text-ui-fg-subtle">
            {subtitle}
          </Text>
        ) : null}
      </div>
      <div className="flex flex-col items-stretch gap-2 px-6 py-5 lg:flex-row lg:items-center">
        {nodes.map((n, i) => (
          <div key={n.title} className="contents">
            <div
              className={clx(
                "flex min-w-0 flex-1 flex-col gap-y-1 rounded-lg border px-4 py-3",
                n.accent ? "border-ui-border-interactive bg-ui-bg-highlight" : "border-ui-border-base bg-ui-bg-component",
              )}
            >
              <Text size="small" weight="plus" className="text-ui-fg-base">
                {n.title}
              </Text>
              {n.caption ? (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {n.caption}
                </Text>
              ) : null}
            </div>
            {i < nodes.length - 1 ? (
              <div className="flex shrink-0 flex-col items-center justify-center px-1 text-center lg:w-28">
                <Text size="xsmall" className="text-ui-fg-muted">
                  {links[i] ?? ""}
                </Text>
                <span aria-hidden className="txt-compact-medium text-ui-fg-muted">
                  <span className="hidden lg:inline">&rarr;</span>
                  <span className="lg:hidden">&darr;</span>
                </span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Container>
  )
}

export function GuideChecklist({ title, subtitle, items }: { title: string; subtitle?: string; items: Array<{ label: string; done: boolean; hint?: string }> }) {
  const done = items.filter((i) => i.done).length
  return (
    <Container className="divide-y p-0">
      <div className="flex items-start justify-between gap-4 px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Heading level="h2">{title}</Heading>
          {subtitle ? (
            <Text size="small" className="text-ui-fg-subtle">
              {subtitle}
            </Text>
          ) : null}
        </div>
        <Badge size="small" color={done === items.length ? "green" : "orange"}>
          <span className="tabular-nums">
            {done}/{items.length}
          </span>
        </Badge>
      </div>
      <ul className="flex flex-col gap-y-2 px-6 py-4">
        {items.map((i) => (
          <li key={i.label} className="flex gap-x-2">
            <span
              className={clx(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                i.done ? "border-ui-tag-green-border bg-ui-tag-green-bg" : "border-ui-border-base bg-ui-bg-base",
              )}
            >
              {i.done ? <CheckCircleSolid className="h-4 w-4 text-ui-tag-green-icon" /> : null}
            </span>
            <span className="flex flex-col">
              <Text size="small" className={i.done ? "text-ui-fg-base" : "text-ui-fg-subtle"}>
                {i.label}
              </Text>
              {i.hint ? (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {i.hint}
                </Text>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Container>
  )
}

export function GuideFaq({ title, items }: { title: string; items: Array<{ q: string; a: ReactNode }> }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">{title}</Heading>
      </div>
      {items.map((it, i) => (
        <div key={it.q} className="px-6">
          <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-4 py-3 text-left" aria-expanded={open === i}>
            <Text size="small" weight="plus" className="text-ui-fg-base">
              {it.q}
            </Text>
            <ChevronDownMini className={clx("shrink-0 text-ui-fg-muted transition-transform", open === i && "rotate-180")} />
          </button>
          {open === i ? <div className="txt-small flex max-w-3xl flex-col gap-y-2 pb-4 text-ui-fg-subtle">{it.a}</div> : null}
        </div>
      ))}
    </Container>
  )
}
