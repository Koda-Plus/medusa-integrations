import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  ArchiveBox,
  ArrowPath,
  ArrowUturnLeft,
  BarsArrowDown,
  Beaker,
  Calendar,
  ChatBubbleLeftRight,
  CheckCircle,
  Clock,
  CursorArrowRays,
  ExclamationCircle,
  Fire,
  Funnel,
  History,
  ListBullet,
  Plus,
  ShoppingCart,
  Sparkles,
  SquaresPlus,
  Users,
} from "@medusajs/icons"
import { Container, InlineTip, Table } from "@medusajs/ui"
import { isLinkType } from "../../../modules/tasks/lib/constants"
import type { StatusResponse, TaskDto } from "../../../modules/tasks/lib/contract"
import { errorMessage, localDay, tasksKeys, useBoard, useBoardActivity, useEnsureSandbox, useMoveTask, useTasksStatus } from "../../lib/tasks-api"
import { BoardColumns, RoadmapView, TaskFilters, applyFilters, filtered, type BoardFilters, type QuickFilter } from "../../lib/tasks-board"
import { filtersFromParams, filtersToParams } from "../../lib/tasks-rules"
import { TaskDrawer } from "../../lib/tasks-drawer"
import { CreateTaskModal, useFailToast, type PickedRecord } from "../../lib/tasks-form"
import { AddStoreButton, HelpButtons, IntegrationHeader, KeyPoints, ModeBadge, ReferencesBadge, SettingsView, communityLabels, usePageNav, type HeaderAction, type PageNav } from "../../lib/tasks-guide"
import { EmptyTableRow, FilterButton, SearchInput, Section, StatTile, StatTiles, ToneBadge } from "../../lib/tasks-blocks"
import { KitFetchingBar, KitLoading, KitSkeletonRows } from "../../lib/tasks-kit"
import { GuideView, usePromptSpec } from "../../lib/tasks-guide-view"
import { TasksIcon } from "../../lib/tasks-icon"
import { GeneralSection, SandboxDetails, SandboxSection, useResetAction } from "../../lib/tasks-settings"
import {
  Person,
  activityText,
  actorOf,
  fmtDateTime,
  fmtNumber,
  fmtRating,
  fmtRelative,
  kitReferences,
  taskTitle,
  useLabels,
  usePeopleIndex,
  type PeopleIndex,
} from "../../lib/tasks-ui"

/**
 * Tasks by Koda Plus. Three views, switched in the header and kept in the URL:
 *
 * - Panel: the counters, the board (six columns with drag and drop) or the
 *   roadmap (tasks by due month), the filters, and the latest activity.
 * - Setup guide (`?view=guide`).
 * - Settings (`?view=settings&tab=`): the options in use, the sandbox board.
 *
 * `?task=<id>` opens a task (the widgets link here); `?new=1&link=order:<id>`
 * opens "New task" with the record linked. The filters are in the URL too,
 * so a counter or a host links straight to them: `?quick=overdue|due_today|
 * urgent|unassigned|mine|open|review`, `?record=order:<id>`,
 * `?record_type=order`, `?assignee=me|none|user:<id>`, `?q=`, `?tag=`,
 * `?priority=`, and `?layout=board|roadmap`.
 *
 * Sandbox accounts (`sandboxAccounts`) get the sandbox board: the server
 * decides it on every request, the page only shows the badge.
 */

const SETTINGS_TABS = ["general", "sandbox"] as const
type SettingsTabId = (typeof SETTINGS_TABS)[number]

type Layout = "board" | "roadmap"
const LAYOUT_KEY = "koda.tasks.layout"

function readLayout(asked: string | null): Layout {
  if (asked === "board" || asked === "roadmap") return asked
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "roadmap" ? "roadmap" : "board"
  } catch {
    return "board"
  }
}

function saveLayout(v: Layout) {
  try {
    window.localStorage.setItem(LAYOUT_KEY, v)
  } catch {
    /* a private window keeps the default */
  }
}

const TasksPage = () => {
  const { t, i18n } = useTranslation("tasks")
  const lang = i18n.language || "en"
  const nav = usePageNav(SETTINGS_TABS)
  const status = useTasksStatus()
  const s = status.data
  const [dragging, setDragging] = useState<string | null>(null)
  const board = useBoard(dragging !== null)
  const move = useMoveTask()
  const fail = useFailToast()
  const [params, setParams] = useSearchParams()
  /* The filters are the URL: a deep link opens them, a change replaces them in place. */
  const filters = useMemo(() => filtersFromParams(params), [params])
  const setFilters = (f: BoardFilters) => setParams(filtersToParams(f, params), { replace: true })
  const [layout, setLayoutState] = useState<Layout>(() => readLayout(params.get("layout")))
  const today = localDay()
  const index = usePeopleIndex(s?.people, s?.named_people)
  const tasks = useMemo(() => board.data?.tasks ?? [], [board.data])
  const viewerId = s?.viewer.type === "user" ? s.viewer.id : null
  const visible = useMemo(() => applyFilters(tasks, filters, today, lang, viewerId), [tasks, filters, today, lang, viewerId])
  const openId = params.get("task")
  const creating = params.get("new") === "1"

  /* A sandbox account's page asks for the sample tasks once when the board is not seeded or is old: reads never seed. */
  const ensure = useEnsureSandbox()
  const asked = useRef(false)
  const stale = Boolean(s?.sandbox && s.sandbox_board?.stale)
  useEffect(() => {
    if (!stale || asked.current) return
    asked.current = true
    ensure.mutate()
  }, [stale, ensure])

  const setLayout = (v: Layout) => {
    setLayoutState(v)
    saveLayout(v)
    if (params.has("layout")) {
      const p = new URLSearchParams(params)
      p.set("layout", v)
      setParams(p, { replace: true })
    }
  }
  const setParam = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) p.delete(k)
      else p.set(k, v)
    }
    setParams(p, { replace: true })
  }

  const initialLinks = useMemo<PickedRecord[]>(() => {
    const raw = params.get("link") ?? ""
    const [type, ...rest] = raw.split(":")
    const id = rest.join(":")
    return isLinkType(type) && id ? [{ type, id, label: params.get("label") || id }] : []
  }, [params])

  const quick = (q: QuickFilter) => setFilters({ ...filters, quick: filters.quick === q ? "none" : q })
  const counts = board.data?.counts ?? s?.counts
  const hiddenClosed = board.data?.hidden_closed ?? 0
  const hiddenOpen = board.data?.hidden_open ?? 0
  const roadmap = layout === "roadmap"

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <Header status={s} loading={status.isLoading} lang={lang} nav={nav} onNew={() => setParam({ new: "1", link: null, label: null })} />
        {status.isError ? (
          <div className="px-6 py-4">
            <InlineTip variant="error" label={t("title")}>
              {t("error", { message: errorMessage(status.error) })}
            </InlineTip>
          </div>
        ) : null}
        {counts && nav.view === "panel" ? (
          <StatTiles columns={7}>
            <StatTile icon={<ListBullet />} label={t("stats.open")} value={fmtNumber(counts.open, lang)} active={filters.quick === "open"} onClick={() => quick("open")} />
            <StatTile icon={<Clock />} label={t("stats.inProgress")} value={fmtNumber(counts.in_progress, lang)} tone={counts.in_progress > 0 ? "blue" : "grey"} />
            <StatTile icon={<CheckCircle />} label={t("stats.review")} value={fmtNumber(counts.review, lang)} tone={counts.review > 0 ? "orange" : "grey"} active={filters.quick === "review"} onClick={() => quick("review")} />
            <StatTile icon={<ExclamationCircle />} label={t("stats.overdue")} value={fmtNumber(counts.overdue, lang)} tone={counts.overdue > 0 ? "red" : "grey"} active={filters.quick === "overdue"} onClick={() => quick("overdue")} />
            <StatTile icon={<Fire />} label={t("stats.urgent")} value={fmtNumber(counts.urgent, lang)} tone={counts.urgent > 0 ? "orange" : "grey"} active={filters.quick === "urgent"} onClick={() => quick("urgent")} />
            <StatTile icon={<Users />} label={t("stats.unassigned")} value={fmtNumber(counts.unassigned, lang)} tone={counts.unassigned > 0 ? "orange" : "grey"} active={filters.quick === "unassigned"} onClick={() => quick("unassigned")} />
            <StatTile icon={<CheckCircle />} label={t("stats.closed")} value={fmtNumber(counts.done + counts.rejected, lang)} tone={counts.done > 0 ? "green" : "grey"} />
          </StatTiles>
        ) : null}
      </Container>

      {s && nav.view === "guide" ? <GuideView status={s} /> : null}

      {nav.view === "panel" ? (
        <>
          <Section
            id="tasks-board"
            icon={roadmap ? <Calendar /> : <SquaresPlus />}
            title={roadmap ? t("roadmap.title") : t("board.title")}
            pointsLabel={roadmap ? t("roadmap.subtitle") : t("board.subtitle")}
            points={
              roadmap
                ? [
                    { icon: <Calendar />, text: t("roadmap.points.byDue") },
                    { icon: <BarsArrowDown />, text: t("roadmap.points.openFirst") },
                    { icon: <Users />, text: t("roadmap.points.people") },
                  ]
                : [
                    { icon: <CursorArrowRays />, text: t("board.points.drag") },
                    { icon: <ChatBubbleLeftRight />, text: t("board.points.open") },
                    { icon: <ShoppingCart />, text: t("board.points.links") },
                  ]
            }
            actions={
              <>
                <SearchInput value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder={t("board.search")} />
                <FilterButton icon={<SquaresPlus />} label={t("layout.board")} active={!roadmap} onClick={() => setLayout("board")} />
                <FilterButton icon={<Calendar />} label={t("layout.roadmap")} active={roadmap} onClick={() => setLayout("roadmap")} />
              </>
            }
          >
            <TaskFilters value={filters} onChange={setFilters} tasks={tasks} index={index} today={today} viewerId={viewerId} />
            <KitFetchingBar active={board.isFetching && !board.isLoading} />
            <div className="flex flex-col gap-y-3 px-6 py-4">
              {filtered(filters) || hiddenClosed > 0 || hiddenOpen > 0 ? (
                <KeyPoints
                  items={[
                    filtered(filters) && { icon: <Funnel />, text: t("board.shown", { shown: visible.length, total: tasks.length }), tone: "blue" },
                    hiddenClosed > 0 && { icon: <ArchiveBox />, text: t("board.hiddenClosed", { count: hiddenClosed }) },
                    hiddenOpen > 0 && { icon: <ExclamationCircle />, text: t("board.hiddenOpen", { count: hiddenOpen }), tone: "orange", title: t("board.hiddenOpenHint") },
                  ]}
                />
              ) : null}
              {board.isError ? (
                <InlineTip variant="error" label={t("board.title")}>
                  {t("error", { message: errorMessage(board.error) })}
                </InlineTip>
              ) : null}
              {board.isLoading ? (
                <KitLoading label={t("board.loading")} />
              ) : roadmap ? (
                <RoadmapView
                  tasks={visible}
                  all={tasks}
                  today={today}
                  index={index}
                  assignee={filters.assignee}
                  onAssignee={(key) => setFilters({ ...filters, assignee: key })}
                  onOpen={(id) => setParam({ task: id })}
                />
              ) : (
                <BoardColumns
                  tasks={visible}
                  today={today}
                  index={index}
                  onOpen={(id) => setParam({ task: id })}
                  dragging={dragging}
                  onDragging={setDragging}
                  onMove={(m) => move.mutate(m, { onError: fail })}
                />
              )}
            </div>
          </Section>
          <ActivitySection index={index} titles={tasks} onOpen={(id) => setParam({ task: id })} />
        </>
      ) : null}

      {s && nav.view === "settings" ? (
        <SettingsView
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
          value={nav.tab}
          onChange={(tab: SettingsTabId) => nav.go("settings", tab)}
          tabs={[
            { id: "general", label: t("settings.tab.general") },
            { id: "sandbox", label: t("settings.tab.sandbox"), badge: s.sandbox_board.enabled ? s.options.sandbox_account_count : null, tone: "blue" },
          ]}
        >
          {nav.tab === "general" ? <GeneralSection status={s} /> : null}
          {nav.tab === "sandbox" ? <SandboxSection status={s} /> : null}
        </SettingsView>
      ) : null}

      {openId ? (
        <TaskDrawer id={openId} preview={tasks.find((x) => x.id === openId) ?? null} status={s} index={index} today={today} onClose={() => setParam({ task: null })} />
      ) : null}

      <CreateTaskModal
        open={creating}
        onOpenChange={(open) => (open ? setParam({ new: "1" }) : setParam({ new: null, link: null, label: null }))}
        status={s}
        initialLinks={initialLinks}
        onCreated={(id) => setParam({ new: null, link: null, label: null, task: id })}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Header({ status, loading, lang, nav, onNew }: { status: StatusResponse | undefined; loading: boolean; lang: string; nav: PageNav<SettingsTabId>; onNew: () => void }) {
  const { t } = useTranslation("tasks")
  const client = useQueryClient()
  const reset = useResetAction()
  const references = status ? kitReferences(status.references, lang) : []
  const promptSpec = usePromptSpec()
  const community = communityLabels((key, options) => t(key, options), `${t("title")} ${t("by")}`)

  const actions: HeaderAction[] = [{ key: "refresh", label: t("actions.refresh"), icon: <ArrowPath />, onClick: () => void client.invalidateQueries({ queryKey: tasksKeys.all }) }]
  if (status?.sandbox) {
    actions.push({ key: "reset", label: t("actions.resetSandbox"), icon: <ArrowUturnLeft />, loading: reset.pending, onClick: () => void reset.run() })
  }

  return (
    <IntegrationHeader
      icon={<TasksIcon width={28} height={28} />}
      title={t("title")}
      badges={
        !loading && status ? (
          <>
            {status.sandbox ? (
              <ModeBadge color="blue" label={t("mode.sandbox")} title={t("sandbox.label")}>
                <SandboxDetails status={status} />
              </ModeBadge>
            ) : null}
            {status.counts.overdue > 0 ? <ToneBadge tone="red">{t("mode.overdue", { count: status.counts.overdue })}</ToneBadge> : null}
          </>
        ) : null
      }
      description={t("subtitle")}
      points={[
        { icon: <SquaresPlus />, text: t("points.board") },
        { icon: <ChatBubbleLeftRight />, text: t("points.comments") },
        { icon: <ShoppingCart />, text: t("points.links") },
        { icon: <Sparkles />, text: t("points.agents") },
        status?.sandbox && { icon: <Beaker />, text: t("points.sandbox"), tone: "blue" },
      ]}
      social={
        <>
          <ReferencesBadge
            items={references}
            labels={{
              count: (live, soon) =>
                live > 0
                  ? live === 1
                    ? t("references.badgeOne")
                    : t("references.badgeMany", { count: live })
                  : soon === 1
                    ? t("references.badgeSoonOne")
                    : t("references.badgeSoonMany", { count: soon }),
              soonMore: (soon) => t("references.soonMore", { count: soon }),
              soon: t("references.soon"),
              title: t("references.title"),
              subtitle: t("references.subtitle"),
              open: t("references.open"),
              review: t("references.review"),
              rating: (value) => fmtRating(value, lang),
            }}
          />
          <AddStoreButton labels={community.addStore} />
        </>
      }
      help={<HelpButtons spec={promptSpec} lang={lang} labels={community} />}
      view={nav.view}
      onView={(v) => nav.go(v)}
      labels={{ panel: t("view.panel"), guide: t("view.guide"), settings: t("settings.title"), more: t("actions.moreActions") }}
      primary={nav.view === "panel" ? { key: "new", label: t("actions.newTask"), icon: <Plus />, onClick: onNew } : null}
      actions={nav.view !== "guide" ? actions : []}
    />
  )
}

/* ------------------------------------------------------------------ */

function ActivitySection({ index, titles, onOpen }: { index: PeopleIndex; titles: TaskDto[]; onOpen: (id: string) => void }) {
  const labels = useLabels()
  const { t, lang } = labels
  const q = useBoardActivity()
  const rows = q.data?.activity ?? []
  const byId = useMemo(() => new Map(titles.map((x) => [x.id, x])), [titles])
  const titleOf = (id: string, stored: string | null) => {
    const task = byId.get(id)
    return task ? taskTitle(task, lang) : (stored ?? id)
  }

  return (
    <Section
      id="tasks-activity"
      icon={<History />}
      title={t("activity.title")}
      pointsLabel={t("activity.subtitle")}
      points={[
        { icon: <SquaresPlus />, text: t("activity.points.all") },
        { icon: <BarsArrowDown />, text: t("activity.points.newest") },
        { icon: <CursorArrowRays />, text: t("activity.points.click") },
      ]}
    >
      <KitFetchingBar active={q.isFetching && !q.isLoading} />
      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("activity.when")}</Table.HeaderCell>
              <Table.HeaderCell>{t("activity.who")}</Table.HeaderCell>
              <Table.HeaderCell>{t("activity.what")}</Table.HeaderCell>
              <Table.HeaderCell>{t("activity.task")}</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {q.isLoading ? <KitSkeletonRows cols={4} rows={4} /> : null}
            {!q.isLoading && rows.length === 0 ? <EmptyTableRow cols={4} icon={<History />} title={t("activity.empty")} /> : null}
            {rows.map((a) => {
              const deleted = a.type === "task_deleted"
              return (
                <Table.Row key={a.id} className={deleted ? undefined : "cursor-pointer"} onClick={deleted ? undefined : () => onOpen(a.task_id)}>
                  <Table.Cell className="whitespace-nowrap">
                    <span title={fmtDateTime(a.created_at, lang)} className="text-ui-fg-subtle">
                      {fmtRelative(a.created_at, lang)}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <Person who={actorOf(a, index, labels)} />
                  </Table.Cell>
                  <Table.Cell>{activityText(a, labels)}</Table.Cell>
                  <Table.Cell className="max-w-[24rem]">
                    <span className={deleted ? "block truncate text-ui-fg-muted line-through" : "block truncate text-ui-fg-interactive"}>{titleOf(a.task_id, a.task_title)}</span>
                  </Table.Cell>
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table>
      </div>
    </Section>
  )
}

export const config = defineRouteConfig({
  label: "nav",
  rank: 7,
  translationNs: "tasks",
  icon: TasksIcon,
})

export default TasksPage
