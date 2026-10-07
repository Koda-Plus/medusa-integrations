import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Link as RouterLink } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Avatar, Badge, StatusBadge, Text, clx } from "@medusajs/ui"
import { ArrowUpRightMini, ShoppingCart, Sparkles, Tag as TagIcon, User, XMarkMini } from "@medusajs/icons"
import type { ActivityDto, CommentDto, LinkDto, NamedPersonDto, PersonDto, SampleText, TaskDto } from "../../modules/tasks/lib/contract"
import type { LinkType, TaskPriority, TaskStatus } from "../../modules/tasks/lib/constants"
import { describeActivity } from "../../modules/tasks/lib/activity"
import { isOverdue, utcDay } from "../../modules/tasks/lib/dates"
import { personKey } from "../../modules/tasks/lib/people"
import { pickText, type TasksReference } from "../../modules/tasks/lib/references"
import { nb, type Reference } from "./tasks-guide"

/*
 * Shared pieces of the Tasks page and widgets: formatting, labels in the
 * admin's language, avatars, badges, tiles and chips.
 */

export type Tone = "grey" | "blue" | "orange" | "purple" | "green" | "red"

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

export function fmtDateTime(value: string | Date | null | undefined, lang: string): string {
  const d = asDate(value)
  if (!d) return ""
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ")
  }
}

/** A due day ("12 Oct", "12 Oct 2027" in another year), read as the calendar day it was set to. */
export function fmtDay(day: string | null, lang: string): string {
  if (!day) return ""
  const d = new Date(`${day}T12:00:00.000Z`)
  try {
    const sameYear = d.getUTCFullYear() === new Date().getFullYear()
    return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(d)
  } catch {
    return day
  }
}

export function fmtMonth(day: string, lang: string): string {
  const d = new Date(`${day}T12:00:00.000Z`)
  try {
    const label = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric", timeZone: "UTC" }).format(d)
    return label.charAt(0).toUpperCase() + label.slice(1)
  } catch {
    return day.slice(0, 7)
  }
}

/** "3 hours ago", "in 2 days": the distance a person reads first. */
export function fmtRelative(value: string | Date | null | undefined, lang: string, now = Date.now()): string {
  const d = asDate(value)
  if (!d) return ""
  const diff = (d.getTime() - now) / 1000
  const abs = Math.abs(diff)
  const steps: Array<[number, Intl.RelativeTimeFormatUnit, number]> = [
    [45, "second", 1],
    [3600, "minute", 60],
    [86400, "hour", 3600],
    [86400 * 7, "day", 86400],
    [86400 * 30, "week", 86400 * 7],
    [86400 * 365, "month", 86400 * 30],
  ]
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" })
    if (abs < 45) return rtf.format(0, "second")
    const step = steps.find(([limit]) => abs < limit)
    const [unit, size] = step ? [step[1], step[2]] : (["year", 86400 * 365] as const)
    return rtf.format(Math.round(diff / size), unit)
  } catch {
    return fmtDateTime(d, lang)
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

/** References of the option in the admin language, shaped for the kit. */
export function kitReferences(refs: TasksReference[], lang: string): Reference[] {
  return refs.map((r) => ({
    name: r.name,
    url: r.url ?? undefined,
    soon: r.soon,
    icon: r.icon,
    description: pickText(r.description, lang) || undefined,
    metrics: r.metrics.map((m) => ({ label: pickText(m.label, lang), value: m.value })),
    links: r.links.map((l) => ({ label: pickText(l.label, lang), url: l.url })),
    review: r.review ? { ...r.review, quote: pickText(r.review.quote, lang) || undefined } : null,
  }))
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

/* ------------------------------------------------------------------ */
/* Tasks in the admin's language                                       */
/* ------------------------------------------------------------------ */

const isPl = (lang: string) => /^pl\b/i.test(lang)

/** The sample text in the admin's language, or the stored text. */
export function sampleOr(sample: SampleText | null | undefined, stored: string, lang: string): string {
  if (!sample) return stored
  return (isPl(lang) ? sample.pl || sample.en : sample.en || sample.pl) || stored
}

export function taskTitle(task: Pick<TaskDto, "title" | "sample">, lang: string): string {
  return sampleOr(task.sample?.title, task.title, lang)
}

export function taskDescription(task: Pick<TaskDto, "description" | "sample">, lang: string): string | null {
  const stored = task.description ?? ""
  const text = sampleOr(task.sample?.description, stored, lang)
  return text ? text : null
}

export function commentBody(comment: Pick<CommentDto, "body" | "sample">, lang: string): string {
  return sampleOr(comment.sample, comment.body, lang)
}

export function dueDayOf(task: Pick<TaskDto, "due_date">): string | null {
  return utcDay(task.due_date)
}

export function overdue(task: Pick<TaskDto, "status" | "due_date">, today: string): boolean {
  return isOverdue(task, today)
}

export const STATUS_COLOR: Record<TaskStatus, Tone> = {
  backlog: "grey",
  todo: "blue",
  in_progress: "orange",
  review: "purple",
  done: "green",
  rejected: "red",
}

export const PRIORITY_COLOR: Record<TaskPriority, Tone> = { low: "grey", medium: "blue", high: "orange", urgent: "red" }

export function useLabels() {
  const { t, i18n } = useTranslation("tasks")
  const lang = i18n.language || "en"
  return {
    t,
    lang,
    status: (s: string) => t(`status.${s}`, { defaultValue: s }),
    priority: (p: string) => t(`priority.${p}`, { defaultValue: p }),
    role: (r: string) => t(`role.${r}`, { defaultValue: r }),
    linkType: (type: string) => t(`links.${type}`, { defaultValue: type }),
  }
}

export type Labels = ReturnType<typeof useLabels>

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export interface PeopleIndex {
  byId: Map<string, PersonDto>
  byName: Map<string, PersonDto>
  /** The `people` option by name (trimmed, lower case). */
  named: Map<string, NamedPersonDto>
  namedList: NamedPersonDto[]
}

export function usePeopleIndex(people: PersonDto[] | undefined, named?: NamedPersonDto[] | undefined): PeopleIndex {
  return useMemo(() => {
    const byId = new Map<string, PersonDto>()
    const byName = new Map<string, PersonDto>()
    for (const p of people ?? []) {
      byId.set(p.id, p)
      byName.set(p.name.toLowerCase(), p)
      if (p.email) byName.set(p.email.toLowerCase(), p)
    }
    const map = new Map<string, NamedPersonDto>()
    for (const n of named ?? []) if (!map.has(personKey(n.name))) map.set(personKey(n.name), n)
    return { byId, byName, named: map, namedList: [...map.values()] }
  }, [people, named])
}

export interface Who {
  name: string | null
  url: string | null
  ai: boolean
  /** The role line of a named person (`people` option), in both languages. */
  role?: SampleText | null
}

/** The face of a free text name: a named person of the option, else an admin user with that name or e-mail. */
function freeName(name: string | null | undefined, index: PeopleIndex, ai = false): Who {
  if (!name || !name.trim()) return { name: null, url: null, ai }
  const named = index.named.get(personKey(name))
  if (named) return { name, url: named.avatar, ai: ai || named.kind === "agent", role: named.role }
  const user = index.byName.get(name.trim().toLowerCase())
  return { name, url: user?.avatar_url ?? null, ai }
}

/** The assignee of a task: the admin user (with their photo), or the free text name and its face. */
export function assigneeOf(task: Pick<TaskDto, "assignee" | "assignee_id">, index: PeopleIndex): Who {
  const user = task.assignee_id ? index.byId.get(task.assignee_id) : undefined
  if (user) return { name: user.name, url: user.avatar_url, ai: false }
  return freeName(task.assignee, index)
}

export function authorOf(c: Pick<CommentDto, "author" | "author_id" | "author_role" | "author_type">, index: PeopleIndex, labels: Labels): Who {
  const ai = c.author_role === "claude" || c.author_type === "api-key"
  const user = c.author_id && c.author_type === "user" ? index.byId.get(c.author_id) : undefined
  if (user) return { name: user.name, url: user.avatar_url, ai: false }
  const who = freeName(c.author, index, ai)
  return who.name ? who : { name: labels.role(c.author_role), url: null, ai }
}

export function actorOf(a: Pick<ActivityDto, "actor" | "actor_id" | "actor_type">, index: PeopleIndex, labels: Labels): Who {
  const ai = a.actor_type === "api-key"
  const user = a.actor_id && a.actor_type === "user" ? index.byId.get(a.actor_id) : undefined
  if (user) return { name: user.name, url: user.avatar_url, ai: false }
  const who = freeName(a.actor, index, ai)
  return who.name ? who : { name: ai ? labels.role("claude") : labels.t("person.unknown"), url: null, ai }
}

/** A role line of the `people` option in the admin's language. */
export function roleLine(role: SampleText | null | undefined, lang: string): string | null {
  if (!role) return null
  return (isPl(lang) ? role.pl || role.en : role.en || role.pl) || null
}

export function initials(name: string | null | undefined): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** A person: their photo, the AI agent mark, initials, or an empty silhouette when nobody. */
export function PersonAvatar({ who, large = false }: { who: Who | null; large?: boolean }) {
  const box = large ? "h-8 w-8" : "h-5 w-5"
  const ring = clx("flex shrink-0 items-center justify-center overflow-hidden rounded-full shadow-borders-base", box)
  if (who?.url) {
    return (
      <span className={clx(ring, "bg-ui-bg-component")} title={who.name ?? undefined}>
        <img src={who.url} alt="" className="h-full w-full object-cover" />
      </span>
    )
  }
  if (who?.ai) {
    return (
      <span className={clx(ring, "bg-ui-tag-purple-bg text-ui-tag-purple-icon")} title={who.name ?? undefined}>
        <Sparkles className={large ? "h-4 w-4" : "h-3 w-3"} />
      </span>
    )
  }
  if (!who?.name) {
    return (
      <span className={clx(ring, "bg-ui-bg-component text-ui-fg-disabled")}>
        <User className={large ? "h-4 w-4" : "h-3 w-3"} />
      </span>
    )
  }
  return <Avatar size={large ? "base" : "2xsmall"} fallback={initials(who.name)} />
}

/** The avatar and the name, for assignees and authors. `plain` keeps the parent's typography (select options). */
export function Person({ who, fallback, muted = false, plain = false }: { who: Who | null; fallback?: string; muted?: boolean; plain?: boolean }) {
  const name = who?.name ?? fallback ?? ""
  return (
    <span className="inline-flex min-w-0 items-center gap-x-1.5 align-middle">
      <PersonAvatar who={who} />
      {plain ? (
        <span className="truncate">{name}</span>
      ) : (
        <Text size="xsmall" leading="compact" className={clx("truncate", muted ? "text-ui-fg-muted" : "text-ui-fg-subtle")}>
          {name}
        </Text>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { status: label } = useLabels()
  return <StatusBadge color={STATUS_COLOR[status] ?? "grey"}>{label(status)}</StatusBadge>
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { priority: label } = useLabels()
  return (
    <Badge size="2xsmall" color={PRIORITY_COLOR[priority] ?? "grey"} className="shrink-0">
      {label(priority)}
    </Badge>
  )
}

export const ROLE_COLOR: Record<string, Tone> = { agency: "blue", client: "green", claude: "purple" }

export function RoleBadge({ role }: { role: string }) {
  const labels = useLabels()
  return (
    <Badge size="2xsmall" color={ROLE_COLOR[role] ?? "grey"}>
      {labels.role(role)}
    </Badge>
  )
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

export function LinkIcon({ type, className }: { type: LinkType; className?: string }) {
  if (type === "order") return <ShoppingCart className={className} />
  if (type === "product") return <TagIcon className={className} />
  return <User className={className} />
}

const LINK_PATH: Record<LinkType, string> = { order: "/orders", product: "/products", customer: "/customers" }

export function linkPath(type: LinkType, id: string): string {
  return `${LINK_PATH[type]}/${encodeURIComponent(id)}`
}

/**
 * A linked record: its icon and name, opening its page; with `onRemove` a
 * cross to unlink it. `compact` is the card's version: plain text, since the
 * whole card is already a button.
 */
export function LinkChip({ link, onRemove, compact = false }: { link: LinkDto; onRemove?: () => void; compact?: boolean }) {
  const labels = useLabels()
  const name = link.label ?? link.entity_id
  if (compact) {
    return (
      <span className={clx("inline-flex max-w-full items-center gap-x-1 rounded-md border border-ui-border-base bg-ui-bg-component px-1 py-0.5", !link.found && "opacity-70")} title={`${labels.linkType(link.type)}: ${name}`}>
        <LinkIcon type={link.type} className="h-3.5 w-3.5 shrink-0 text-ui-fg-muted" />
        <span className={clx("txt-compact-xsmall-plus truncate", link.found ? "text-ui-fg-subtle" : "text-ui-fg-muted line-through")}>{name}</span>
      </span>
    )
  }
  return (
    <span
      className={clx(
        "inline-flex max-w-full items-center gap-x-1 rounded-md border border-ui-border-base bg-ui-bg-component",
        "px-1.5 py-0.5",
        !link.found && "opacity-70",
      )}
      title={`${labels.linkType(link.type)}: ${name}`}
    >
      <LinkIcon type={link.type} className="h-3.5 w-3.5 shrink-0 text-ui-fg-muted" />
      {link.found ? (
        <RouterLink to={linkPath(link.type, link.entity_id)} onClick={(e) => e.stopPropagation()} className="txt-compact-xsmall-plus truncate text-ui-fg-subtle hover:text-ui-fg-interactive">
          {name}
        </RouterLink>
      ) : (
        <span className="txt-compact-xsmall truncate text-ui-fg-muted line-through">
          {name} ({labels.t("links.gone")})
        </span>
      )}
      {link.found ? <ArrowUpRightMini className="h-3.5 w-3.5 shrink-0 text-ui-fg-muted" /> : null}
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 shrink-0 rounded text-ui-fg-muted transition-fg hover:text-ui-fg-base"
          aria-label={labels.t("actions.remove")}
        >
          <XMarkMini />
        </button>
      ) : null}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Activity in the admin's language                                    */
/* ------------------------------------------------------------------ */

export function activityText(a: Pick<ActivityDto, "type" | "message" | "metadata">, labels: Labels): string {
  const { t } = labels
  const v = describeActivity(a)
  switch (v.kind) {
    case "created":
      return t("activity.created")
    case "commented":
      return t("activity.commented")
    case "deleted":
      return t("activity.deleted")
    case "moved":
      return t("activity.moved", { from: labels.status(v.from as string), to: labels.status(v.to as string) })
    case "status":
      return t("activity.statusChanged")
    case "assigned":
      return t("activity.assigned", { name: v.name })
    case "unassigned":
      return t("activity.unassigned")
    case "linked":
      return t("activity.linked", { type: labels.linkType(v.linkType ?? "").toLowerCase() })
    case "unlinked":
      return t("activity.unlinked", { type: labels.linkType(v.linkType ?? "").toLowerCase() })
    case "updated": {
      const fields = (v.fields ?? []).map((f) => t(`activity.fields.${f}`, { defaultValue: f }))
      return fields.length ? t("activity.updated", { fields: fields.join(", ") }) : t("activity.updatedSome")
    }
    default:
      return v.text ?? a.type
  }
}

/* ------------------------------------------------------------------ */
/* Layout pieces                                                       */
/* ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  tone = "default",
  active = false,
  onClick,
}: {
  label: string
  value: number | string
  tone?: "default" | "green" | "orange" | "red" | "blue" | "purple"
  active?: boolean
  onClick?: () => void
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
      aria-pressed={onClick ? active : undefined}
      className={clx(
        "flex h-full flex-col items-start justify-between gap-y-1 rounded-lg border px-4 py-3 text-left transition-fg",
        "border-ui-border-base bg-ui-bg-component",
        onClick ? "cursor-pointer hover:bg-ui-bg-component-hover" : "cursor-default",
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-y-1.5">
      <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
        {label}
      </Text>
      {children}
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="px-6 py-8 text-center">
      <Text size="small" className="text-ui-fg-muted">
        {text}
      </Text>
    </div>
  )
}

/** A pill switch, the same look as Panel | Setup guide elsewhere. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-full border border-ui-border-base bg-ui-bg-component p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clx(
            "txt-compact-small-plus rounded-full px-3 py-1 transition-fg",
            value === o.value ? "bg-ui-bg-interactive text-ui-fg-on-color" : "text-ui-fg-subtle hover:text-ui-fg-base",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** User text with Polish typography (no one-letter word at a line end). */
export function Typeset({ text }: { text: string }) {
  return <>{nb(text)}</>
}
