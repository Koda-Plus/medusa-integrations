import { useState } from "react"
import { ArrowUpRightOnBox, Clock, ListBullet, Plus } from "@medusajs/icons"
import { Button, Heading, Text, clx } from "@medusajs/ui"
import type { LinkType } from "../../modules/tasks/lib/constants"
import { localDay, useEntityTasks, useTasksStatus } from "./tasks-api"
import { EmptyState, ToneBadge } from "./tasks-blocks"
import { CreateTaskModal } from "./tasks-form"
import { TasksIcon } from "./tasks-icon"
import { KitLoading, WidgetFrame } from "./tasks-kit"
import { PersonAvatar, TaskStatusBadge, assigneeOf, dueDayOf, fmtDay, overdue, taskTitle, useLabels, usePeopleIndex } from "./tasks-ui"

/**
 * The tasks of one order, product or customer, on its page: open ones
 * first, each opening the task on the board, "New task" with the record
 * already linked (in a window, without leaving the record) and a link to
 * every task of the record on the board. Sandbox accounts see the tasks of
 * their sandbox board.
 *
 * One read (`GET /admin/tasks/<type>s/:id`, with the assignees' faces), once
 * a minute. A host (an app that shows every integration as tabs of one
 * card) embeds it with `embedded`: no frame and header of its own, the
 * actions in a bar under the list. Links are plain anchors: a react-router
 * Link inside a widget breaks in some admins.
 */
export function EntityTasksWidget({ type, id, label, embedded }: { type: LinkType; id: string; label: string; embedded?: boolean }) {
  const labels = useLabels()
  const { t, lang } = labels
  const q = useEntityTasks(type, id)
  const [creating, setCreating] = useState(false)
  /* The people for the assignee picker are read only when "New task" opens. */
  const status = useTasksStatus(creating)
  const index = usePeopleIndex(q.data?.people, q.data?.named_people)
  const tasks = q.data?.tasks ?? []
  const count = q.data?.count ?? 0
  const today = localDay()
  const late = tasks.filter((task) => overdue(task, today)).length
  const boardHref = `/app/tasks?record=${encodeURIComponent(`${type}:${id}`)}`

  const actions = (
    <div className="flex items-center gap-x-2">
      <Button size="small" variant="secondary" asChild>
        <a href={boardHref}>
          <ArrowUpRightOnBox />
          {embedded ? t(`widget.allOf.${type}`) : t("widget.all")}
        </a>
      </Button>
      <Button size="small" variant="secondary" onClick={() => setCreating(true)}>
        <Plus />
        {t("widget.newTask")}
      </Button>
    </div>
  )
  const modal = (
    <CreateTaskModal open={creating} onOpenChange={setCreating} status={status.data} initialLinks={[{ type, id, label }]} onCreated={() => setCreating(false)} />
  )

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
          <div className="flex items-center gap-x-2">
            <TasksIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.title")}</Heading>
            {count > 0 ? (
              <ToneBadge>
                <span className="tabular-nums">{count}</span>
              </ToneBadge>
            ) : null}
            {late > 0 ? <ToneBadge tone="red">{t("mode.overdue", { count: late })}</ToneBadge> : null}
            {q.data?.sandbox ? <ToneBadge tone="blue">{t("mode.sandbox")}</ToneBadge> : null}
          </div>
          {actions}
        </div>
      }
    >
      {q.isLoading ? (
        <KitLoading label={t("widget.loading")} className="min-h-0 py-5" />
      ) : q.isError ? (
        <EmptyState compact icon={<ListBullet />} title={t("widget.failed")} />
      ) : tasks.length === 0 ? (
        <EmptyState compact icon={<ListBullet />} title={t(`widget.empty.${type}`)} />
      ) : (
        <ul className="flex flex-col divide-y divide-ui-border-base">
          {tasks.map((task) => {
            const who = assigneeOf(task, index)
            const day = dueDayOf(task)
            const isLate = overdue(task, today)
            return (
              <li key={task.id}>
                <a href={`/app/tasks?task=${encodeURIComponent(task.id)}`} className="flex items-start gap-x-3 px-6 py-3 transition-fg hover:bg-ui-bg-component-hover">
                  <span className="pt-0.5">
                    <PersonAvatar who={who.name ? who : null} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-y-1">
                    <span className="flex items-start justify-between gap-x-2">
                      <Text size="small" weight="plus" leading="compact" className="line-clamp-2 break-words">
                        {taskTitle(task, lang)}
                      </Text>
                      <TaskStatusBadge status={task.status} />
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2">
                      <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
                        {who.name ?? t("card.unassigned")}
                      </Text>
                      {day ? (
                        <span
                          className={clx("inline-flex items-center gap-x-0.5", isLate ? "text-ui-fg-error" : "text-ui-fg-muted")}
                          title={isLate ? t("card.overdue", { date: fmtDay(day, lang) }) : t("card.due", { date: fmtDay(day, lang) })}
                        >
                          <Clock />
                          <Text size="xsmall" leading="compact" className="tabular-nums">
                            {fmtDay(day, lang)}
                          </Text>
                        </span>
                      ) : null}
                    </span>
                  </span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
      {count > tasks.length ? (
        <div className="px-6 py-3">
          <a href={boardHref} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.more", { count: count - tasks.length })}
          </a>
        </div>
      ) : null}
      {embedded ? <div className="flex justify-end px-6 py-3">{actions}</div> : null}
      {modal}
    </WidgetFrame>
  )
}
