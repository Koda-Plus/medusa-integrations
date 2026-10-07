import { useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Plus } from "@medusajs/icons"
import { Badge, Button, Heading, Text } from "@medusajs/ui"
import type { LinkType } from "../../modules/tasks/lib/constants"
import { localDay, useEntityTasks, useTasksStatus } from "./tasks-api"
import { CreateTaskModal } from "./tasks-form"
import { TasksIcon } from "./tasks-icon"
import { WidgetFrame } from "./tasks-kit"
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
 * card) embeds it with `embedded`: no frame and header of its own, a quiet
 * line while loading and when nothing is linked, the actions in a bar under
 * the list.
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
  const boardHref = `/tasks?record=${encodeURIComponent(`${type}:${id}`)}`

  const actions = (
    <div className="flex items-center gap-x-2">
      <Link to={boardHref} className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
        {embedded ? t(`widget.allOf.${type}`) : t("widget.all")}
      </Link>
      <Button size="small" variant="secondary" onClick={() => setCreating(true)}>
        <Plus />
        {t("widget.newTask")}
      </Button>
    </div>
  )
  const modal = (
    <CreateTaskModal open={creating} onOpenChange={setCreating} status={status.data} initialLinks={[{ type, id, label }]} onCreated={() => setCreating(false)} />
  )

  if (embedded && (q.isLoading || q.isError || tasks.length === 0)) {
    return (
      <>
        <Quiet action={q.isLoading || q.isError ? null : actions}>{q.isLoading ? t("widget.loading") : q.isError ? t("widget.failed") : t(`widget.empty.${type}`)}</Quiet>
        {modal}
      </>
    )
  }

  return (
    <WidgetFrame
      embedded={embedded}
      header={
        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
          <div className="flex items-center gap-x-2">
            <TasksIcon width={18} height={18} className="shrink-0" />
            <Heading level="h2">{t("widget.title")}</Heading>
            {count > 0 ? (
              <Badge size="2xsmall" color="grey">
                <span className="tabular-nums">{count}</span>
              </Badge>
            ) : null}
            {q.data?.sandbox ? (
              <Badge size="2xsmall" color="purple">
                {t("mode.sandbox")}
              </Badge>
            ) : null}
          </div>
          {actions}
        </div>
      }
    >
      {q.isLoading ? null : tasks.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {q.isError ? t("widget.failed") : t(`widget.empty.${type}`)}
          </Text>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-ui-border-base">
          {tasks.map((task) => {
            const who = assigneeOf(task, index)
            const day = dueDayOf(task)
            const late = overdue(task, today)
            return (
              <li key={task.id}>
                <Link to={`/tasks?task=${encodeURIComponent(task.id)}`} className="flex items-start gap-x-3 px-6 py-3 transition-fg hover:bg-ui-bg-component-hover">
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
                    <Text size="xsmall" leading="compact" className={late ? "text-ui-fg-error" : "text-ui-fg-muted"}>
                      {[who.name ?? t("card.unassigned"), day ? (late ? t("card.overdue", { date: fmtDay(day, lang) }) : t("card.due", { date: fmtDay(day, lang) })) : null]
                        .filter(Boolean)
                        .join(", ")}
                    </Text>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {count > tasks.length ? (
        <div className="px-6 py-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("widget.more", { count: count - tasks.length })}
          </Text>
        </div>
      ) : null}
      {embedded ? <div className="flex justify-end px-6 py-3">{actions}</div> : null}
      {modal}
    </WidgetFrame>
  )
}

/** The line an embedded card shows instead of nothing. */
function Quiet({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
      <Text size="small" className="text-ui-fg-subtle">
        {children}
      </Text>
      {action}
    </div>
  )
}
