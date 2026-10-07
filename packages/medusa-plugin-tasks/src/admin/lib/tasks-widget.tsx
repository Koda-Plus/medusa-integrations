import { Link, useNavigate } from "react-router-dom"
import { Plus } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import type { LinkType } from "../../modules/tasks/lib/constants"
import { localDay, useEntityTasks, useTasksStatus } from "./tasks-api"
import { TasksIcon } from "./tasks-icon"
import { PersonAvatar, TaskStatusBadge, assigneeOf, dueDayOf, fmtDay, overdue, taskTitle, useLabels, usePeopleIndex } from "./tasks-ui"

/**
 * The tasks of one order, product or customer, on its page: open ones
 * first, each opening the task on the board, and "New task" with the record
 * already linked. Sandbox accounts see the tasks of their sandbox board.
 */
export function EntityTasksWidget({ type, id, label }: { type: LinkType; id: string; label: string }) {
  const labels = useLabels()
  const { t, lang } = labels
  const navigate = useNavigate()
  const q = useEntityTasks(type, id)
  const status = useTasksStatus()
  const index = usePeopleIndex(status.data?.people, status.data?.named_people)
  const tasks = q.data?.tasks ?? []
  const count = q.data?.count ?? 0
  const today = localDay()

  const newTask = () => {
    const p = new URLSearchParams({ new: "1", link: `${type}:${id}`, label })
    navigate(`/tasks?${p.toString()}`)
  }

  return (
    <Container className="divide-y p-0">
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
        <div className="flex items-center gap-x-2">
          <Link to="/tasks" className="txt-compact-small text-ui-fg-interactive hover:text-ui-fg-interactive-hover">
            {t("widget.all")}
          </Link>
          <Button size="small" variant="secondary" onClick={newTask}>
            <Plus />
            {t("widget.newTask")}
          </Button>
        </div>
      </div>
      {q.isLoading ? null : tasks.length === 0 ? (
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-subtle">
            {t(`widget.empty.${type}`)}
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
    </Container>
  )
}
