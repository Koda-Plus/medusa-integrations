// GENERATED from kit/admin/guide.tsx (kit 1.0.1) by scripts/kit.mjs. Do not edit here: change the kit and run `npm run kit:sync`.
import { useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowUpRightOnBox, BookOpen, ChartBar, CheckCircleSolid, ChevronDownMini, CogSixTooth, InformationCircleSolid, PaperPlane, PlusMini, Sparkles, SquareTwoStack } from "@medusajs/icons"
import { Badge, Button, Container, DropdownMenu, Heading, Input, Label, Popover, StatusBadge, Text, Textarea, clx, toast } from "@medusajs/ui"
import { KIT_META } from "./emails-kit-meta"

/*
 * The page kit of the Koda Plus integrations: the same components in every
 * package, so all integration pages share one look. GENERATED into each
 * package as src/admin/lib/<ns>-guide.tsx from kit/admin/guide.tsx by
 * `npm run kit:sync`: edit the kit, never a copy.
 *
 * Header
 *   usePageNav       Panel, Setup guide or Settings, and the settings tab, kept in ?view= and ?tab=
 *   IntegrationHeader the whole header in three places: who (name, badges, help), why
 *                    (description, stores), toolbar (view tabs, one main action, the others)
 *   PageTabs         Panel | Setup guide | Settings, every tab with its name
 *   ModeBadge        the mode of the module; in demo mode it opens a note on what is simulated
 *   ReferencesBadge  "Running in N stores", with the rating and its source; opens the list
 *   AddStoreButton   "Add your store" next to it: a request to Koda Plus, by mail
 *   HelpButtons      "Copy prompt" (an AI agent sets the integration up in another
 *                    Medusa project, like here) and help on the Koda Plus Discord
 * Settings
 *   SettingsView     a title and tabs over the technical sections (account, writers, plans, history)
 * Guide
 *   References       "Running in production" cards, at the end of the guide
 *   GuideIntro       what the setup takes: time, what you need, a short overview
 *   GuideSteps       numbered steps with a live state (done / to do / optional)
 *   GuideDiagram     boxes and arrows for how the parts talk to each other
 *   GuideChecklist   go-live checklist with ticks from the live status
 *   GuideFaq         troubleshooting, one question per row, opens in place
 * Typography
 *   nb, typeset      Polish copy with no one-letter word left at the end of a line
 *
 * Every string comes in through props, already translated by the page. Two
 * exceptions, both the same for all five integrations: communityLabels() reads
 * the page's own `community` block, and the setup prompt is written here in
 * English and Polish, because it is one text for every integration.
 */

/* ------------------------------------------------------------------ */
/* Typography: the Koda Plus script against orphans, as on our offers */

const NBSP = "\u00a0"
/* A non-breaking hyphen: "e-mail" never ends a line on "e-". */
const NBHY = "\u2011"
/* A one-letter word or a short conjunction or preposition, with the space after it. */
const SHORT = /(^|[\s("„])(oraz|albo|lub|ale|że|bo|czy|gdy|aby|by|więc|jak|na|do|za|ze|we|od|po|to|[aiouwze])[ \t]+/gi

/**
 * Glues "w", "i", "z", "na", "do", "że" and the like to the next word and a number
 * to its thousands and units, so no short word hangs at the end of a line. Two
 * passes catch runs like "i w domu". Line breaks are left alone.
 */
export function nb(text: string): string {
  let out = text
  for (let k = 0; k < 2; k++) out = out.replace(SHORT, `$1$2${NBSP}`)
  out = out.replace(/(\d) (?=\d{3}\b)/g, `$1${NBSP}`)
  out = out.replace(/\b([eE])-(?=mail)/g, `$1${NBHY}`)
  return out.replace(/(\d) (zł|€|Kč|EUR|USD|PLN|CZK|mln|tys\.|cm|mm|m²|%)/g, `$1${NBSP}$2`)
}

/** nb over every string of a translation dictionary (nested objects and arrays), keys untouched. */
export function typeset<T>(value: T): T {
  if (typeof value === "string") return nb(value) as T
  if (Array.isArray(value)) return value.map((v) => typeset(v)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, typeset(v)])) as T
  }
  return value
}

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

const VIEWS: PageView[] = ["panel", "guide", "settings"]
const VIEW_ICON: Record<PageView, ReactNode> = { panel: <ChartBar />, guide: <BookOpen />, settings: <CogSixTooth /> }

/** Panel, Setup guide and Settings as tabs, each with its icon and its name (never an icon alone). */
export function PageTabs({ value, onChange, labels }: { value: PageView; onChange: (v: PageView) => void; labels: Record<PageView, string> }) {
  return (
    <div role="tablist" className="flex flex-wrap items-center gap-1">
      {VIEWS.map((v) => {
        const on = v === value
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(v)}
            className={clx(
              "txt-compact-small-plus inline-flex items-center gap-x-1.5 rounded-md px-2.5 py-1.5 outline-none transition-fg focus-visible:shadow-borders-focus",
              on ? "bg-ui-bg-base text-ui-fg-base shadow-borders-base" : "text-ui-fg-subtle hover:bg-ui-bg-base-hover hover:text-ui-fg-base",
            )}
          >
            <span className={clx("flex", on ? "text-ui-fg-interactive" : "text-ui-fg-muted")}>{VIEW_ICON[v]}</span>
            {labels[v]}
          </button>
        )
      })}
    </div>
  )
}

/** One action of the page: the main one gets the dark button, the others sit next to it or under "More actions". */
export type HeaderAction = {
  key: string
  label: string
  onClick: () => void
  icon?: ReactNode
  disabled?: boolean
  loading?: boolean
}

export type HeaderLabels = Record<PageView, string> & {
  /** The menu with the other actions, e.g. "More actions". */
  more: string
}

/** The other actions: a plain button when there is one, a menu when there are more. */
function OtherActions({ items, label }: { items: HeaderAction[]; label: string }) {
  if (items.length === 1) {
    const a = items[0]
    return (
      <Button size="small" variant="secondary" isLoading={a.loading} disabled={a.disabled} onClick={a.onClick}>
        {a.icon}
        {a.label}
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <Button size="small" variant="secondary">
          {label}
          <ChevronDownMini />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {items.map((a) => (
          <DropdownMenu.Item key={a.key} disabled={a.disabled || a.loading} onClick={a.onClick} className="gap-x-2">
            {a.icon}
            {a.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}

/**
 * The header of an integration page, the same in all five. Three places, each
 * with one job:
 *   who      icon, name, "by Koda Plus", the state badges; on the right the help
 *            about the integration itself (Copy prompt, Discord)
 *   why      the description, then the stores running it and "Add your store"
 *   toolbar  the views as tabs (Panel, Setup guide, Settings) and the page's
 *            actions: one main button, the others beside it or in "More actions"
 */
export function IntegrationHeader({
  icon,
  title,
  by,
  badges,
  description,
  social,
  help,
  view,
  onView,
  labels,
  primary,
  actions = [],
}: {
  icon: ReactNode
  title: string
  by: string
  badges?: ReactNode
  description: string
  social?: ReactNode
  help?: ReactNode
  view: PageView
  onView: (v: PageView) => void
  labels: HeaderLabels
  primary?: HeaderAction | null
  actions?: HeaderAction[]
}) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-y-3 px-6 pb-5 pt-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="flex shrink-0">{icon}</span>
            <Heading level="h1">{title}</Heading>
            <Text size="small" className="text-ui-fg-muted">
              {by}
            </Text>
            {badges ? <span className="flex flex-wrap items-center gap-1.5">{badges}</span> : null}
          </div>
          {help ? <div className="flex shrink-0">{help}</div> : null}
        </div>
        <Text size="small" className="max-w-3xl text-ui-fg-subtle">
          {description}
        </Text>
        {social ? <div className="flex flex-wrap items-center gap-2 pt-0.5">{social}</div> : null}
      </div>
      <div className="flex flex-col gap-3 border-t border-ui-border-base bg-ui-bg-subtle px-6 py-2.5 md:flex-row md:items-center md:justify-between">
        <PageTabs value={view} onChange={onView} labels={labels} />
        {primary || actions.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions.length ? <OtherActions items={actions} label={labels.more} /> : null}
            {primary ? (
              <Button size="small" variant="primary" isLoading={primary.loading} disabled={primary.disabled} onClick={primary.onClick}>
                {primary.icon}
                {primary.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
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

/**
 * One store, already in the language of the admin (the page picks en or pl
 * from the option): a live store, or one that starts on Medusa soon.
 */
export type Reference = {
  name: string
  /** The live store. A store that starts soon may have one too, but it is never linked. */
  url?: string
  /** The store starts on Medusa soon: listed after the live ones, with a "Soon" badge and no link. */
  soon?: boolean
  /** The store's own icon (its favicon or logo mark): a data URI or an https URL. Without one the card shows the first letter. */
  icon?: string | null
  description?: string
  metrics?: Array<{ label: string; value: string }>
  /** Pages where the integration can be seen at work, e.g. a product with its Allegro link. */
  links?: Array<{ label: string; url: string }>
  review?: ReferenceReview | null
}

type LiveReference = Reference & { url: string }

/** The live stores (each with its address) and, apart, the stores that start soon. An entry that is neither is left out. */
function splitReferences(items: Reference[]): { live: LiveReference[]; soon: Reference[] } {
  return {
    live: items.filter((r): r is LiveReference => !r.soon && typeof r.url === "string" && r.url !== ""),
    soon: items.filter((r) => r.soon === true),
  }
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
    <span className="inline-flex shrink-0 items-center rounded-full bg-white px-2 py-1 shadow-borders-base">
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
  /** On the badge, from the live and the soon stores: "Running in 3 stores", "Działa w 1 sklepie", "Coming to 2 stores". */
  count: (live: number, soon: number) => string
  /** After the count when there are live stores too: "+2 soon", "+2 wkrótce". */
  soonMore: (soon: number) => string
  /** The badge of a store that starts soon: "Soon", "Wkrótce". */
  soon: string
  title: string
  subtitle: string
  open: string
  /** "Read the review". */
  review: string
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
 * with their numbers, the review and its link. Stores that start soon come
 * after the live ones: faded in the icons, "+N soon" after the count, and in
 * the list without a link. Only the live stores make the rating.
 */
export function ReferencesBadge({ items, labels }: { items: Reference[]; labels: ReferencesLabels }) {
  const { live, soon } = splitReferences(items)
  if (live.length + soon.length === 0) return null
  const mean = meanRating(live)
  return (
    <Popover>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-9 max-w-full items-center gap-x-3 rounded-full border border-ui-border-base bg-ui-bg-component py-1 pl-1.5 pr-3 outline-none transition-fg hover:bg-ui-bg-component-hover focus-visible:shadow-borders-focus"
        >
          <span className="flex shrink-0 items-center">
            {[...live, ...soon].slice(0, 3).map((r, i) => (
              <span key={r.url ?? r.name} className={clx("rounded-md", i > 0 && "-ml-2", r.soon && "opacity-50")}>
                <StoreIcon reference={r} size={24} />
              </span>
            ))}
          </span>
          <span className="flex min-w-0 items-center gap-x-1.5">
            <span className="txt-compact-small-plus truncate text-ui-fg-base">{labels.count(live.length, soon.length)}</span>
            {live.length > 0 && soon.length > 0 ? <span className="txt-compact-small shrink-0 text-ui-fg-muted">{labels.soonMore(soon.length)}</span> : null}
          </span>
          {mean ? (
            <span className="flex shrink-0 items-center gap-x-2 border-l border-ui-border-base pl-3">
              <Stars rating={mean.value} size={13} />
              <span className="txt-compact-small-plus tabular-nums text-ui-fg-base">{labels.rating(mean.value)}</span>
              <SourceMark review={mean.first} height={10} />
            </span>
          ) : null}
          <ChevronDownMini className="-ml-1 shrink-0 text-ui-fg-muted" />
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
          {live.map((r) => (
            <li key={r.url ?? r.name} className="flex flex-col gap-y-2 px-4 py-3">
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
                  {nb(r.review.quote)}
                  {r.review.author ? <span className="not-italic text-ui-fg-muted"> {r.review.author}</span> : null}
                </Text>
              ) : null}
              {r.description ? (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {nb(r.description)}
                </Text>
              ) : null}
              {r.metrics?.length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(r.metrics ?? []).map((m) => (
                    <Badge key={m.label} size="2xsmall" color="green">
                      <span className="tabular-nums">{m.value}</span>&nbsp;{m.label}
                    </Badge>
                  ))}
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
          {soon.map((r) => (
            <li key={r.url ?? r.name} className="flex flex-col gap-y-2 px-4 py-3">
              <div className="flex items-center gap-x-3">
                <StoreIcon reference={r} size={32} />
                <span className="flex min-w-0 items-center gap-x-2">
                  <Text size="small" weight="plus" className="truncate text-ui-fg-base">
                    {r.name}
                  </Text>
                  <Badge size="2xsmall" color="blue" className="shrink-0">
                    {labels.soon}
                  </Badge>
                </span>
              </div>
              {r.description ? (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {nb(r.description)}
                </Text>
              ) : null}
            </li>
          ))}
        </ul>
      </Popover.Content>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* Community: add your store, the setup prompt for an AI agent, help on Discord */

/**
 * Koda Plus support: the Discord server, and the address store requests go to.
 * The Discord link is our own redirect, never an invite code: a published
 * version lives forever, an invite does not (and an expired code can be taken
 * over by another server).
 */
export const KODA_DISCORD = "https://koda.plus/discord"
export const KODA_EMAIL = "hello@koda.plus"
/** The Koda Plus demo store, where every integration runs on sample data. */
const KODA_DEMO = "https://medusa.koda.plus"

/** Translated strings carry nb's no-break spaces; text that leaves the admin (a mail, the clipboard) gets plain ones. */
const plain = (text: string) => text.split(NBSP).join(" ")

type Translate = (key: string, options?: Record<string, unknown>) => string

export type AddStoreLabels = {
  button: string
  title: string
  text: string
  name: string
  url: string
  note: string
  send: string
  copy: string
  copied: string
  /** Under the form: where the request goes. */
  hint: string
  subject: string
  /** The first line of the mail. */
  greeting: string
}

export type PromptLabels = {
  button: string
  title: string
  /** Where to paste it and what the agent does. */
  text: string
  copy: string
  copied: string
  failed: string
}

export type CommunityLabels = {
  addStore: AddStoreLabels
  prompt: PromptLabels
  discord: { button: string; title: string }
}

/**
 * The community strings of a page, from its own `community` block (the same
 * keys in all five dictionaries). `integration` names it in the request mail,
 * e.g. "Allegro by Koda Plus".
 */
export function communityLabels(t: Translate, integration: string): CommunityLabels {
  const k = (key: string, options?: Record<string, unknown>) => t(`community.${key}`, options)
  return {
    addStore: {
      button: k("addStore.button"),
      title: k("addStore.title"),
      text: k("addStore.text"),
      name: k("addStore.name"),
      url: k("addStore.url"),
      note: k("addStore.note"),
      send: k("addStore.send"),
      copy: k("addStore.copy"),
      copied: k("addStore.copied"),
      hint: k("addStore.hint", { email: KODA_EMAIL }),
      subject: k("addStore.subject", { integration }),
      greeting: k("addStore.greeting", { integration }),
    },
    prompt: {
      button: k("prompt.button"),
      title: k("prompt.title"),
      text: k("prompt.text"),
      copy: k("prompt.copy"),
      copied: k("prompt.copied"),
      failed: k("prompt.failed"),
    },
    discord: { button: k("discord.button"), title: k("discord.title") },
  }
}

/**
 * "Add your store", next to the stores badge: a short form that opens the
 * reader's mail app with the request to Koda Plus ready to send, or copies it
 * for a webmail. Koda Plus checks the store before it joins the list.
 */
export function AddStoreButton({ labels }: { labels: AddStoreLabels }) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [note, setNote] = useState("")
  const ready = name.trim() !== "" && url.trim() !== ""
  const subject = plain(labels.subject)
  const body = plain(
    [labels.greeting, "", `${labels.name}: ${name.trim()}`, `${labels.url}: ${url.trim()}`, ...(note.trim() ? ["", note.trim()] : [])].join("\n"),
  )

  const send = () => {
    window.location.href = `mailto:${KODA_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${KODA_EMAIL}\n${subject}\n\n${body}`)
      toast.success(labels.copied)
    } catch {
      toast.error(KODA_EMAIL)
    }
  }

  return (
    <Popover>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="txt-compact-small-plus inline-flex h-9 items-center gap-x-1.5 rounded-full px-3 text-ui-fg-subtle outline-none transition-fg hover:bg-ui-bg-base-hover hover:text-ui-fg-base focus-visible:shadow-borders-focus"
        >
          <PlusMini />
          {labels.button}
        </button>
      </Popover.Trigger>
      <Popover.Content align="start" sideOffset={8} className="w-[min(420px,calc(100vw-32px))] p-0">
        <div className="flex flex-col gap-y-1 border-b border-ui-border-base px-4 py-3">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {labels.title}
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {labels.text}
          </Text>
        </div>
        <div className="flex flex-col gap-y-3 px-4 py-4">
          <div className="flex flex-col gap-y-1.5">
            <Label size="xsmall" weight="plus" htmlFor="koda-add-store-name">
              {labels.name}
            </Label>
            <Input id="koda-add-store-name" size="small" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-y-1.5">
            <Label size="xsmall" weight="plus" htmlFor="koda-add-store-url">
              {labels.url}
            </Label>
            <Input id="koda-add-store-url" size="small" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="flex flex-col gap-y-1.5">
            <Label size="xsmall" weight="plus" htmlFor="koda-add-store-note">
              {labels.note}
            </Label>
            <Textarea id="koda-add-store-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-y-3 border-t border-ui-border-base px-4 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {labels.hint}
          </Text>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="small" variant="secondary" disabled={!ready} onClick={() => void copy()}>
              <SquareTwoStack />
              {labels.copy}
            </Button>
            <Button size="small" variant="primary" disabled={!ready} onClick={send}>
              <PaperPlane />
              {labels.send}
            </Button>
          </div>
        </div>
      </Popover.Content>
    </Popover>
  )
}

/** What the setup prompt needs from a page: the same setup its guide shows. */
export type SetupPromptSpec = {
  /** The service, e.g. "Allegro". */
  service: string
  /** The npm package, e.g. "@koda-plus/medusa-plugin-allegro". */
  pkg: string
  /** The version to install; defaults to the version of this build when `pkg` is this package. */
  version?: string
  /** The admin page, e.g. "/app/allegro". */
  route: string
  /** What the integration does: the page subtitle. */
  summary: string
  /** What the store owner prepares first: accounts, keys, a machine. From the guide. */
  needs: string[]
  /** The setup from the guide: .env and medusa-config.ts. */
  config: string
  /** The demo switch as the demo store has it, e.g. `demo: process.env.X_DEMO === "true",`. */
  demo: string
  /** The integration only reads from the service: nothing to arm (no step about writers). */
  readOnly?: boolean
  /** The plugin keeps tables of its own (a step runs the migrations). Default true. */
  migrations?: boolean
}

/** Environment variables a setup names: process.env.X in the code and X= lines of a .env. */
function envNames(code: string): string[] {
  const names = new Set<string>()
  for (const m of code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1])
  for (const m of code.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) names.add(m[1])
  return [...names]
}

/**
 * The prompt behind "Copy prompt", in the admin's language. An AI coding
 * agent working in another Medusa project installs the plugin, sets it up as
 * the guide shows with the demo switch of the demo store, keeps every writer
 * off, and leaves notes (CLAUDE.md or AGENTS.md) for the sessions after it.
 */
/** "@koda-plus/medusa-plugin-x@0.2.0": a pinned version, never whatever `latest` is when the prompt is pasted. */
export function pinnedPackage(spec: SetupPromptSpec): string {
  const version = spec.version ?? (spec.pkg === KIT_META.pkg ? KIT_META.version : null)
  return version && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) ? `${spec.pkg}@${version}` : spec.pkg
}

export function buildSetupPrompt(spec: SetupPromptSpec, lang: string): string {
  const code = (text: string) => "`" + text + "`"
  const pinned = pinnedPackage(spec)
  const env = envNames(`${spec.config}\n${spec.demo}`).map(code).join(", ")
  const needs = spec.needs.map((n) => `- ${plain(n)}`)
  const demoPage = `${KODA_DEMO}${spec.route}`
  const service = spec.service
  const config = ["```ts", spec.config, "```"]

  if (lang.toLowerCase().startsWith("pl")) {
    return [
      `# Dodaj integrację ${service} od Koda Plus do tego sklepu na Medusie`,
      "",
      `Pracujesz w moim projekcie Medusa v2. Dodaj integrację ${service} od Koda Plus (${spec.pkg}) tak, żeby działała i wyglądała tak samo jak w sklepie demo Koda Plus, ${demoPage} (Panel, Przewodnik wdrożenia i Ustawienia), a potem zostaw projekt gotowy do dalszej pracy nad nią.`,
      "",
      "## Co robi integracja",
      plain(spec.summary),
      "",
      "## Czego potrzeba po mojej stronie",
      ...needs,
      "",
      "## Kroki",
      "1. Zanim cokolwiek zmienisz, sprawdź projekt: Medusa 2.12 albo nowsza (tego wymagają strony i tłumaczenia panelu we wtyczce), menedżer pakietów projektu i medusa-config.ts. Jeśli coś blokuje instalację, zatrzymaj się i napisz mi, co.",
      `2. Zainstaluj wtyczkę w tej wersji menedżerem pakietów projektu, na przykład ${code(`npm install ${pinned}`)}. Potem sprawdź pochodzenie paczki: ${code(`npm view ${spec.pkg} dist-tags.latest`)} i ${code("npm audit signatures")}. Jeśli rejestr jej nie znajduje albo podpisy się nie zgadzają, zatrzymaj się i daj mi znać: pomaga Koda Plus (${KODA_EMAIL}, Discord ${KODA_DISCORD}).`,
      "3. Zarejestruj wtyczkę w medusa-config.ts, nie ruszając tego, co już tam jest. Użyj konfiguracji z Przewodnika wdrożenia:",
      "",
      ...config,
      "",
      `4. Dodaj do opcji przełącznik trybu demo, tak jak w sklepie demo: ${code(spec.demo)}. Tryb demo działa tylko po jawnym włączeniu: wtedy moduł pracuje na przykładowych danych i nie łączy się z ${service}; bez niego i bez kluczy mówi „nieskonfigurowane” i nic nie robi.`,
      `5. Wpisz zmienne do .env i do środowiska hostingu, nigdy do kodu ani do gita: ${env}. Jeśli nie podałem Ci wartości, zostaw ją pustą i wypisz mi ją na końcu.`,
      spec.migrations === false
        ? `6. Uruchom sklep i otwórz ${spec.route} w panelu admina (ta wtyczka nie ma własnych tabel, migracje nie są potrzebne). Sprawdź, czy Panel, Przewodnik wdrożenia i Ustawienia otwierają się bez błędów w konsoli przeglądarki i w logu serwera.`
        : `6. Uruchom migracje bazy (${code("npx medusa db:migrate")}), potem sklep, i otwórz ${spec.route} w panelu admina. Sprawdź, czy Panel, Przewodnik wdrożenia i Ustawienia otwierają się bez błędów w konsoli przeglądarki i w logu serwera.`,
      spec.readOnly
        ? `7. Ta integracja tylko czyta z ${service}: nie ma zapisów do uzbrajania. Użyj klucza tylko do odczytu, jeśli ${service} go oferuje.`
        : `7. Nie włączaj żadnego zapisu, czyli niczego, co zmienia dane w ${service} albo w sklepie. Każdy zapis uzbraja człowiek w Ustawieniach, po próbie na sucho; opcje tylko na to pozwalają.`,
      `8. Zaproponuj sekcję o tej integracji do notatek projektu dla agentów AI (CLAUDE.md albo AGENTS.md, zależnie od tego, czego używa projekt; jeśli nie ma żadnego, zaproponuj CLAUDE.md) i pokaż mi jej treść, zanim ją zapiszesz: pakiet i jego wersja, gdzie są jego opcje w medusa-config.ts, zmienne środowiskowe, przełącznik demo, to, że zapisy uzbraja człowiek w Ustawieniach, że wdrożenie krok po kroku jest w panelu w Przewodniku wdrożenia, że pomoc jest na Discordzie (${KODA_DISCORD}) i że wtyczka zmienia się aktualizacją pakietu, nigdy edycją node_modules.`,
      "",
      "Na koniec napisz mi, co zmieniłeś i co zostało po mojej stronie: konta i klucze, pierwsze połączenie w Ustawieniach i uzbrojenie zapisów.",
    ].join("\n")
  }

  return [
    `# Add the ${service} integration by Koda Plus to this Medusa store`,
    "",
    `You are working in my Medusa v2 project. Add the ${service} integration by Koda Plus (${spec.pkg}) so that it works and looks the same as in the Koda Plus demo store, ${demoPage} (Panel, Setup guide and Settings), then leave the project ready for further work on it.`,
    "",
    "## What the integration does",
    plain(spec.summary),
    "",
    "## What it takes on my side",
    ...needs,
    "",
    "## Steps",
    "1. Before you change anything, check the project: Medusa 2.12 or newer (the plugin's admin pages and translations need it), the project's package manager and medusa-config.ts. If something blocks the install, stop and tell me what.",
    `2. Install this version of the plugin with the project's package manager, for example ${code(`npm install ${pinned}`)}. Then check where the package comes from: ${code(`npm view ${spec.pkg} dist-tags.latest`)} and ${code("npm audit signatures")}. If the registry cannot find it or the signatures do not verify, stop and tell me: Koda Plus helps (${KODA_EMAIL}, Discord ${KODA_DISCORD}).`,
    "3. Register the plugin in medusa-config.ts without touching what is already there. Use the setup from the Setup guide:",
    "",
    ...config,
    "",
    `4. Add the demo switch to the options, as the demo store has it: ${code(spec.demo)}. Demo mode runs only when switched on: then the module works on sample data and never calls ${service}; without it and without keys it says "Not configured" and does nothing.`,
    `5. Put the variables in .env and in the hosting's environment, never in code or in git: ${env}. If I did not give you a value, leave it empty and list it for me at the end.`,
    spec.migrations === false
      ? `6. Start the store and open ${spec.route} in the admin (this plugin has no tables of its own, no migrations needed). Check that the Panel, the Setup guide and Settings open with no errors in the browser console or the server log.`
      : `6. Run the database migrations (${code("npx medusa db:migrate")}), then the store, and open ${spec.route} in the admin. Check that the Panel, the Setup guide and Settings open with no errors in the browser console or the server log.`,
    spec.readOnly
      ? `7. This integration only reads from ${service}: there are no writers to arm. Use a read-only key if ${service} offers one.`
      : `7. Do not turn on any writer, that is anything that changes data in ${service} or in the store. A person arms each writer in Settings, after a dry run; the options only allow it.`,
    `8. Propose a section about this integration for the project's notes for AI agents (CLAUDE.md or AGENTS.md, whichever the project uses; if neither exists, propose CLAUDE.md) and show me its text before you save it: the package and its version, where its options sit in medusa-config.ts, the environment variables, the demo switch, that a person arms writers in Settings, that the step by step setup is in the admin under Setup guide, that help is on Discord (${KODA_DISCORD}), and that the plugin changes through package updates, never through edits in node_modules.`,
    "",
    "When you are done, tell me what you changed and what is left for me: accounts and keys, the first connection in Settings and arming the writers.",
  ].join("\n")
}

/**
 * "Copy prompt": the button opens the setup prompt for Claude Code, Cursor or
 * another AI agent opened in the reader's Medusa project; the text goes to the
 * clipboard only from the Copy button under it, after the reader has seen it.
 */
export function PromptButton({ spec, lang, labels }: { spec: SetupPromptSpec; lang: string; labels: PromptLabels }) {
  const prompt = useMemo(() => buildSetupPrompt(spec, lang), [spec, lang])
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setState("copied")
    } catch {
      setState("failed")
    }
  }

  return (
    <Popover>
      <Popover.Trigger asChild>
        <Button size="small" variant="secondary" onClick={() => setState("idle")}>
          <Sparkles />
          {labels.button}
        </Button>
      </Popover.Trigger>
      <Popover.Content align="end" sideOffset={8} className="w-[min(560px,calc(100vw-32px))] p-0">
        <div className="flex items-start gap-x-2.5 border-b border-ui-border-base px-4 py-3">
          {state === "copied" ? <CheckCircleSolid className="mt-px shrink-0 text-ui-tag-green-text" /> : null}
          <div className="flex min-w-0 flex-col gap-y-1">
            <Text size="small" weight="plus" className="text-ui-fg-base">
              {state === "copied" ? labels.copied : state === "failed" ? labels.failed : labels.title}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              {labels.text}
            </Text>
          </div>
        </div>
        <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words bg-ui-bg-subtle px-4 py-3 font-mono text-[11px] leading-[18px] text-ui-fg-subtle">{prompt}</pre>
        <div className="flex items-center justify-between gap-x-3 border-t border-ui-border-base px-4 py-3">
          <span className="truncate font-mono txt-compact-xsmall text-ui-fg-muted">{spec.pkg}</span>
          <Button size="small" variant="secondary" onClick={() => void copy()}>
            <SquareTwoStack />
            {labels.copy}
          </Button>
        </div>
      </Popover.Content>
    </Popover>
  )
}

/** The Discord symbol as published on discord.com/branding (Symbol.svg, 64 by 48), in the current color. */
function DiscordMark({ width = 16 }: { width?: number }) {
  return (
    <svg width={width} height={(width * 48) / 64} viewBox="0 0 64 48" fill="currentColor" aria-hidden>
      <path d="M40.575 0C39.9562 1.09866 39.4006 2.2352 38.8954 3.397C34.0967 2.67719 29.2096 2.67719 24.3982 3.397C23.9057 2.2352 23.3374 1.09866 22.7186 0C18.2104 0.770324 13.8157 2.12155 9.64839 4.02841C1.38951 16.2652 -0.845688 28.1863 0.265599 39.9432C5.10222 43.517 10.5197 46.2447 16.2909 47.9874C17.5916 46.2447 18.7407 44.3883 19.7257 42.4562C17.8568 41.7616 16.0509 40.8903 14.3208 39.88C14.7755 39.5517 15.2175 39.2107 15.6468 38.8824C25.7873 43.6559 37.5316 43.6559 47.6847 38.8824C48.1141 39.236 48.5561 39.577 49.0107 39.88C47.2806 40.9029 45.4748 41.7616 43.5931 42.4688C44.5781 44.4009 45.7273 46.2573 47.028 48C52.7991 46.2573 58.2167 43.5422 63.0533 39.9684C64.3666 26.3299 60.8055 14.5099 53.6452 4.04104C49.4905 2.13418 45.0959 0.782952 40.5876 0.0252565L40.575 0ZM21.1401 32.7072C18.0209 32.7072 15.4321 29.8785 15.4321 26.3804C15.4321 22.8824 17.9199 20.041 21.1275 20.041C24.3351 20.041 26.886 22.895 26.8354 26.3804C26.7849 29.8658 24.3224 32.7072 21.1401 32.7072ZM42.1788 32.7072C39.047 32.7072 36.4834 29.8785 36.4834 26.3804C36.4834 22.8824 38.9712 20.041 42.1788 20.041C45.3864 20.041 47.9246 22.895 47.8741 26.3804C47.8236 29.8658 45.3611 32.7072 42.1788 32.7072Z" />
    </svg>
  )
}

/** "Help on Discord": the Koda Plus server, in Discord's own blurple. */
export function DiscordButton({ label, title }: { label: string; title: string }) {
  return (
    <a
      href={KODA_DISCORD}
      target="_blank"
      rel="noreferrer"
      title={title}
      className="txt-compact-small-plus inline-flex items-center gap-x-2 rounded-md bg-[#5865F2] px-2.5 py-1 text-white outline-none transition-fg hover:bg-[#4752C4] focus-visible:shadow-borders-focus"
    >
      <DiscordMark />
      {label}
    </a>
  )
}

/** The developer side of the header, under the page actions: the setup prompt and help on Discord. */
export function HelpButtons({ spec, lang, labels }: { spec: SetupPromptSpec; lang: string; labels: CommunityLabels }) {
  return (
    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
      <PromptButton spec={spec} lang={lang} labels={labels.prompt} />
      <DiscordButton label={labels.discord.button} title={labels.discord.title} />
    </div>
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

function CardIcon({ reference }: { reference: Reference }) {
  return reference.icon ? (
    <img src={reference.icon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-md bg-white object-contain shadow-borders-base" />
  ) : (
    <span className="txt-compact-medium-plus flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ui-bg-base text-ui-fg-base shadow-borders-base">
      {reference.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** The live stores first, as links; then the stores that start soon, with the soon badge and no link. */
export function References({ items, title, subtitle, openLabel, soonLabel, reviewLabel, ratingLabel }: { items: Reference[]; title: string; subtitle: string; openLabel: string; soonLabel: string; reviewLabel?: string; ratingLabel?: (value: number) => string }) {
  const { live, soon } = splitReferences(items)
  if (live.length + soon.length === 0) return null
  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-y-1 px-6 py-4">
        <Heading level="h2">{title}</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {subtitle}
        </Text>
      </div>
      <div className="grid grid-cols-1 gap-3 px-6 py-4 md:grid-cols-2 xl:grid-cols-3">
        {live.map((r) => (
          <div key={r.url ?? r.name} className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-component px-4 py-3">
            <a href={r.url} target="_blank" rel="noreferrer" className="group flex items-center gap-x-3">
              <CardIcon reference={r} />
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
                {nb(r.description)}
              </Text>
            ) : null}
            {r.metrics?.length ? (
              <div className="flex flex-wrap items-center gap-2">
                {(r.metrics ?? []).map((m) => (
                  <Badge key={m.label} size="2xsmall" color="green">
                    <span className="tabular-nums">{m.value}</span>&nbsp;{m.label}
                  </Badge>
                ))}
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
        {soon.map((r) => (
          <div key={r.url ?? r.name} className="flex flex-col gap-y-3 rounded-lg border border-ui-border-base bg-ui-bg-component px-4 py-3">
            <div className="flex items-center gap-x-3">
              <CardIcon reference={r} />
              <span className="flex min-w-0 items-center gap-x-2">
                <Text size="small" weight="plus" className="truncate text-ui-fg-base">
                  {r.name}
                </Text>
                <Badge size="2xsmall" color="blue" className="shrink-0">
                  {soonLabel}
                </Badge>
              </span>
            </div>
            {r.description ? (
              <Text size="small" className="text-ui-fg-subtle">
                {nb(r.description)}
              </Text>
            ) : null}
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
