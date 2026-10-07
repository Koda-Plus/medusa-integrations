import { useMemo, useRef, useState, type DragEvent } from "react"
import { ChatBubble } from "@medusajs/icons"
import { Badge, Button, Input, Select, Text, clx } from "@medusajs/ui"
import { STATUSES, type TaskStatus } from "../../modules/tasks/lib/constants"
import type { TaskDto } from "../../modules/tasks/lib/contract"
import { personKey } from "../../modules/tasks/lib/people"
import { PRIORITY_RANK } from "../../modules/tasks/lib/status"
import type { MoveArgs } from "./tasks-api"
import {
  LinkChip,
  Person,
  PersonAvatar,
  PriorityBadge,
  STATUS_COLOR,
  TaskStatusBadge,
  Typeset,
  assigneeOf,
  dueDayOf,
  fmtDay,
  fmtMonth,
  overdue,
  roleLine,
  taskTitle,
  useLabels,
  type PeopleIndex,
  type Who,
} from "./tasks-ui"

/*
 * The board (six columns with drag and drop) and the roadmap (tasks by due
 * month), with the filters both share.
 */

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export type QuickFilter = "none" | "overdue" | "urgent" | "unassigned"

export interface BoardFilters {
  q: string
  /** `all`, `none` (unassigned), `user:<id>` or `text:<name>`. */
  assignee: string
  tag: string
  priority: string
  quick: QuickFilter
}

export const NO_FILTERS: BoardFilters = { q: "", assignee: "all", tag: "all", priority: "all", quick: "none" }

export function filtered(f: BoardFilters): boolean {
  return f.q.trim() !== "" || f.assignee !== "all" || f.tag !== "all" || f.priority !== "all" || f.quick !== "none"
}

const isOpenTask = (t: TaskDto) => t.status !== "done" && t.status !== "rejected"
const unassigned = (t: TaskDto) => !t.assignee_id && !(t.assignee ?? "").trim()

export function assigneeKey(t: Pick<TaskDto, "assignee" | "assignee_id">): string {
  if (t.assignee_id) return `user:${t.assignee_id}`
  const name = personKey(t.assignee ?? "")
  return name ? `text:${name}` : "none"
}

export function applyFilters(tasks: TaskDto[], f: BoardFilters, today: string, lang: string): TaskDto[] {
  const q = f.q.trim().toLowerCase()
  return tasks.filter((t) => {
    if (f.quick === "overdue" && !overdue(t, today)) return false
    if (f.quick === "urgent" && !(isOpenTask(t) && (t.priority === "urgent" || t.priority === "high"))) return false
    if (f.quick === "unassigned" && !(isOpenTask(t) && unassigned(t))) return false
    if (f.assignee !== "all" && assigneeKey(t) !== f.assignee) return false
    if (f.tag !== "all" && !t.tags.some((tag) => tag.toLowerCase() === f.tag.toLowerCase())) return false
    if (f.priority !== "all" && t.priority !== f.priority) return false
    if (q) {
      const hay = `${taskTitle(t, lang)} ${t.title} ${t.description ?? ""} ${t.assignee ?? ""} ${t.tags.join(" ")} ${t.links.map((l) => l.label ?? "").join(" ")}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export interface AssigneeOption {
  key: string
  who: Who
}

/** Everyone a filter can pick: the board's admin users, the named people of the option, then free text names found on tasks. */
export function assigneeOptions(tasks: TaskDto[], index: PeopleIndex): AssigneeOption[] {
  const out = new Map<string, AssigneeOption>()
  for (const p of index.byId.values()) out.set(`user:${p.id}`, { key: `user:${p.id}`, who: { name: p.name, url: p.avatar_url, ai: false } })
  for (const n of index.namedList) {
    const key = `text:${personKey(n.name)}`
    if (!out.has(key)) out.set(key, { key, who: { name: n.name, url: n.avatar, ai: n.kind === "agent", role: n.role } })
  }
  for (const t of tasks) {
    const key = assigneeKey(t)
    if (key === "none" || out.has(key)) continue
    out.set(key, { key, who: assigneeOf(t, index) })
  }
  return [...out.values()].sort((a, b) => (a.who.name ?? "").localeCompare(b.who.name ?? ""))
}

export function FilterBar({
  value,
  onChange,
  tasks,
  index,
}: {
  value: BoardFilters
  onChange: (f: BoardFilters) => void
  tasks: TaskDto[]
  index: PeopleIndex
}) {
  const labels = useLabels()
  const { t } = labels
  const people = useMemo(() => assigneeOptions(tasks, index), [tasks, index])
  const tags = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of tasks) for (const tag of task.tags) if (!map.has(tag.toLowerCase())) map.set(tag.toLowerCase(), tag)
    return [...map.values()].sort((a, b) => a.localeCompare(b))
  }, [tasks])
  const set = (patch: Partial<BoardFilters>) => onChange({ ...value, ...patch })

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-56">
        <Input size="small" type="search" placeholder={t("board.search")} value={value.q} onChange={(e) => set({ q: e.target.value })} />
      </div>
      <div className="w-full sm:w-48">
        <Select size="small" value={value.assignee} onValueChange={(v) => set({ assignee: v })}>
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">{t("board.everyone")}</Select.Item>
            <Select.Item value="none">
              <Person who={null} fallback={t("board.unassigned")} plain />
            </Select.Item>
            {people.map((p) => (
              <Select.Item key={p.key} value={p.key}>
                <Person who={p.who} plain />
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      {tags.length > 0 ? (
        <div className="w-full sm:w-40">
          <Select size="small" value={value.tag} onValueChange={(v) => set({ tag: v })}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">{t("board.allTags")}</Select.Item>
              {tags.map((tag) => (
                <Select.Item key={tag} value={tag}>
                  {tag}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      ) : null}
      <div className="w-full sm:w-40">
        <Select size="small" value={value.priority} onValueChange={(v) => set({ priority: v })}>
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">{t("board.allPriorities")}</Select.Item>
            {(["urgent", "high", "medium", "low"] as const).map((p) => (
              <Select.Item key={p} value={p}>
                {labels.priority(p)}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>
      {filtered(value) ? (
        <Button size="small" variant="transparent" onClick={() => onChange({ ...NO_FILTERS })}>
          {t("actions.clear")}
        </Button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function TaskCard({
  task,
  today,
  index,
  onOpen,
  showStatus = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  task: TaskDto
  today: string
  index: PeopleIndex
  onOpen: () => void
  showStatus?: boolean
  dragging?: boolean
  onDragStart?: (e: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
}) {
  const labels = useLabels()
  const { t, lang } = labels
  const late = overdue(task, today)
  const day = dueDayOf(task)
  const who = assigneeOf(task, index)
  const tags = task.tags.slice(0, 3)

  return (
    <button
      type="button"
      data-card-id={task.id}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      title={onDragStart ? t("board.dragHint") : undefined}
      className={clx(
        "w-full rounded-lg bg-ui-bg-base p-3 text-left shadow-elevation-card-rest outline-none transition-fg hover:shadow-elevation-card-hover focus-visible:shadow-borders-focus",
        onDragStart && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Text size="small" weight="plus" leading="compact" className="line-clamp-3 break-words">
          <Typeset text={taskTitle(task, lang)} />
        </Text>
        <PriorityBadge priority={task.priority} />
      </div>
      {showStatus || tags.length > 0 || task.sample ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {showStatus ? <TaskStatusBadge status={task.status} /> : null}
          {tags.map((tag) => (
            <Badge key={tag} size="2xsmall" color="grey">
              {tag}
            </Badge>
          ))}
          {task.sample ? (
            <Badge size="2xsmall" color="purple">
              {t("card.sample")}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {task.links.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.links.slice(0, 3).map((l) => (
            <LinkChip key={l.id} link={l} compact />
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        {who.name ? <Person who={who} /> : <Person who={null} fallback={t("card.unassigned")} muted />}
        <div className="flex shrink-0 items-center gap-x-2">
          {day ? (
            <Text size="xsmall" leading="compact" className={late ? "text-ui-fg-error" : "text-ui-fg-muted"}>
              {late ? t("card.overdue", { date: fmtDay(day, lang) }) : t("card.due", { date: fmtDay(day, lang) })}
            </Text>
          ) : null}
          {task.comment_count > 0 ? (
            <span className="flex items-center gap-x-0.5 text-ui-fg-muted" title={t("card.comments")}>
              <ChatBubble />
              <Text size="xsmall" leading="compact" className="tabular-nums">
                {task.comment_count}
              </Text>
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

const byPosition = (a: TaskDto, b: TaskDto) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)

/**
 * Six columns. A card is dragged with the mouse or a pen; the drop place
 * names the card's new neighbours (the card above and below it in the
 * column as shown), which the server finds in the full column too.
 */
export function BoardColumns({
  tasks,
  today,
  index,
  onOpen,
  onMove,
  dragging,
  onDragging,
}: {
  tasks: TaskDto[]
  today: string
  index: PeopleIndex
  onOpen: (id: string) => void
  onMove: (m: MoveArgs) => void
  dragging: string | null
  onDragging: (id: string | null) => void
}) {
  const { t } = useLabels()
  const [drop, setDrop] = useState<{ status: TaskStatus; index: number } | null>(null)
  const columns = useMemo(() => {
    const map = new Map<TaskStatus, TaskDto[]>()
    for (const s of STATUSES) map.set(s, [])
    for (const task of tasks) map.get(task.status)?.push(task)
    for (const list of map.values()) list.sort(byPosition)
    return map
  }, [tasks])
  const refs = useRef(new Map<TaskStatus, HTMLDivElement | null>())

  const dropIndex = (status: TaskStatus, clientY: number): number => {
    const el = refs.current.get(status)
    if (!el) return 0
    const cards = [...el.querySelectorAll<HTMLElement>("[data-card-id]")].filter((c) => c.dataset.cardId !== dragging)
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect()
      return clientY < r.top + r.height / 2
    })
    return i < 0 ? cards.length : i
  }

  const onDrop = (status: TaskStatus, e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const id = dragging ?? e.dataTransfer.getData("text/plain")
    const at = drop?.status === status ? drop.index : dropIndex(status, e.clientY)
    setDrop(null)
    onDragging(null)
    if (!id) return
    const moving = tasks.find((x) => x.id === id)
    const list = (columns.get(status) ?? []).filter((x) => x.id !== id)
    const after = at > 0 ? list[at - 1]?.id ?? null : null
    const before = list[at]?.id ?? null
    if (moving && moving.status === status) {
      const current = (columns.get(status) ?? []).map((x) => x.id)
      const i = current.indexOf(id)
      if ((current[i - 1] ?? null) === after && (current[i + 1] ?? null) === before) return
    }
    onMove({ id, status, after_id: after, before_id: before })
  }

  return (
    <div className="flex gap-x-3 overflow-x-auto pb-2">
      {STATUSES.map((status) => {
        const column = columns.get(status) ?? []
        const target = drop?.status === status ? drop.index : null
        const shown = column.filter((x) => x.id !== dragging)
        return (
          <div key={status} className="flex w-72 shrink-0 flex-col gap-y-2">
            <div className="flex items-center justify-between px-1">
              <TaskStatusBadge status={status} />
              <Text size="xsmall" className="tabular-nums text-ui-fg-muted">
                {column.length}
              </Text>
            </div>
            <div
              ref={(el) => {
                refs.current.set(status, el)
              }}
              onDragOver={(e) => {
                if (!dragging) return
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                const i = dropIndex(status, e.clientY)
                if (drop?.status !== status || drop.index !== i) setDrop({ status, index: i })
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop((d) => (d?.status === status ? null : d))
              }}
              onDrop={(e) => onDrop(status, e)}
              className={clx(
                "flex min-h-28 flex-1 flex-col gap-y-2 rounded-lg bg-ui-bg-subtle p-2 transition-fg",
                target !== null && "shadow-borders-interactive-with-active",
              )}
              data-status={status}
            >
              {column.length === 0 && target === null ? (
                <div className="flex flex-1 items-center justify-center py-6">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {t("board.empty")}
                  </Text>
                </div>
              ) : null}
              {column.map((task) => {
                const i = shown.indexOf(task)
                return (
                  <div key={task.id} className="flex flex-col gap-y-2">
                    {target !== null && i === target ? <DropLine status={status} /> : null}
                    <TaskCard
                      task={task}
                      today={today}
                      index={index}
                      onOpen={() => onOpen(task.id)}
                      dragging={dragging === task.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", task.id)
                        e.dataTransfer.effectAllowed = "move"
                        onDragging(task.id)
                      }}
                      onDragEnd={() => {
                        onDragging(null)
                        setDrop(null)
                      }}
                    />
                  </div>
                )
              })}
              {target !== null && target >= shown.length ? <DropLine status={status} /> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const LINE_COLOR: Record<string, string> = {
  grey: "bg-ui-fg-muted",
  blue: "bg-ui-tag-blue-icon",
  orange: "bg-ui-tag-orange-icon",
  purple: "bg-ui-tag-purple-icon",
  green: "bg-ui-tag-green-icon",
  red: "bg-ui-tag-red-icon",
}

function DropLine({ status }: { status: TaskStatus }) {
  return <div className={clx("h-0.5 w-full rounded-full", LINE_COLOR[STATUS_COLOR[status]] ?? "bg-ui-fg-interactive")} aria-hidden />
}

/* ------------------------------------------------------------------ */
/* Roadmap                                                             */
/* ------------------------------------------------------------------ */

interface Bucket {
  key: string
  label: string
  current: boolean
  tasks: TaskDto[]
}

function monthStart(day: string, add: number): string {
  const [y, m] = day.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + add, 1))
  return d.toISOString().slice(0, 10)
}

const closedRank = (s: TaskStatus) => (s === "done" ? 1 : s === "rejected" ? 2 : 0)

function byRoadmap(a: TaskDto, b: TaskDto): number {
  return (
    closedRank(a.status) - closedRank(b.status) ||
    (dueDayOf(a) ?? "9999").localeCompare(dueDayOf(b) ?? "9999") ||
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
  )
}

/** Earlier, this month and the two after it, later, no due date. The three months always show. */
export function roadmapBuckets(tasks: TaskDto[], today: string, lang: string, labels: { earlier: string; later: string; noDate: string }): Bucket[] {
  const months = [0, 1, 2].map((i) => monthStart(today, i))
  const after = monthStart(today, 3)
  const buckets: Bucket[] = [
    { key: "earlier", label: labels.earlier, current: false, tasks: [] },
    ...months.map((m, i) => ({ key: m, label: fmtMonth(m, lang), current: i === 0, tasks: [] as TaskDto[] })),
    { key: "later", label: labels.later, current: false, tasks: [] },
    { key: "nodate", label: labels.noDate, current: false, tasks: [] },
  ]
  for (const task of tasks) {
    const day = dueDayOf(task)
    let key = "nodate"
    if (day) {
      if (day < months[0]) key = "earlier"
      else if (day >= after) key = "later"
      else key = months.filter((m) => day >= m).pop() ?? months[0]
    }
    buckets.find((b) => b.key === key)?.tasks.push(task)
  }
  for (const b of buckets) b.tasks.sort(byRoadmap)
  return buckets.filter((b) => months.includes(b.key) || b.tasks.length > 0)
}

export function RoadmapView({
  tasks,
  all,
  today,
  index,
  assignee,
  onAssignee,
  onOpen,
}: {
  tasks: TaskDto[]
  all: TaskDto[]
  today: string
  index: PeopleIndex
  assignee: string
  onAssignee: (key: string) => void
  onOpen: (id: string) => void
}) {
  const labels = useLabels()
  const { t, lang } = labels
  const buckets = roadmapBuckets(tasks, today, lang, { earlier: t("roadmap.earlier"), later: t("roadmap.later"), noDate: t("roadmap.noDate") })
  const team = useMemo(() => {
    const map = new Map<string, { key: string; who: Who; open: number; done: number }>()
    for (const task of all) {
      const key = assigneeKey(task)
      if (key === "none") continue
      const row = map.get(key) ?? { key, who: assigneeOf(task, index), open: 0, done: 0 }
      if (task.status === "done") row.done += 1
      else if (task.status !== "rejected") row.open += 1
      map.set(key, row)
    }
    return [...map.values()].sort((a, b) => b.open - a.open || b.done - a.done).slice(0, 8)
  }, [all, index])

  return (
    <div className="flex flex-col gap-y-4">
      {team.length > 0 ? (
        <div className="flex flex-col gap-y-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("roadmap.people")}
          </Text>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {team.map((m) => {
              const active = assignee === m.key
              return (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onAssignee(active ? "all" : m.key)}
                  className={clx(
                    "flex min-w-0 items-center gap-x-3 rounded-lg bg-ui-bg-base p-3 text-left shadow-elevation-card-rest transition-fg hover:shadow-elevation-card-hover",
                    active && "shadow-borders-interactive-with-active",
                  )}
                >
                  <PersonAvatar who={m.who} large />
                  <span className="flex min-w-0 flex-col">
                    <Text size="small" weight="plus" leading="compact" className="truncate">
                      {m.who.name}
                    </Text>
                    {roleLine(m.who.role, lang) ? (
                      <Text size="xsmall" leading="compact" className="truncate text-ui-fg-subtle">
                        {roleLine(m.who.role, lang)}
                      </Text>
                    ) : null}
                    <Text size="xsmall" leading="compact" className="tabular-nums text-ui-fg-muted">
                      {t("roadmap.personCounts", { open: m.open, done: m.done })}
                    </Text>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <div className="flex gap-x-3 overflow-x-auto pb-2">
        {buckets.map((b) => {
          const done = b.tasks.filter((x) => x.status === "done").length
          const total = b.tasks.filter((x) => x.status !== "rejected").length
          return (
            <div key={b.key} className="flex min-w-[16.5rem] flex-1 basis-0 flex-col gap-y-2">
              <div className="flex flex-col gap-y-1.5 px-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-x-2">
                    <Text size="small" weight="plus" leading="compact" className="truncate">
                      {b.label}
                    </Text>
                    {b.current ? (
                      <Badge size="2xsmall" color="green">
                        {t("roadmap.now")}
                      </Badge>
                    ) : null}
                  </div>
                  <Text size="xsmall" className="shrink-0 tabular-nums text-ui-fg-muted">
                    {t("roadmap.progress", { done, total })}
                  </Text>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-ui-bg-component" aria-hidden="true">
                  <div className="h-full rounded-full bg-[#26D07C]" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
                </div>
              </div>
              <div className="flex min-h-28 flex-col gap-y-2 rounded-lg bg-ui-bg-subtle p-2">
                {b.tasks.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center py-6">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {t("roadmap.empty")}
                    </Text>
                  </div>
                ) : (
                  b.tasks.map((task) => <TaskCard key={task.id} task={task} today={today} index={index} onOpen={() => onOpen(task.id)} showStatus />)
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
