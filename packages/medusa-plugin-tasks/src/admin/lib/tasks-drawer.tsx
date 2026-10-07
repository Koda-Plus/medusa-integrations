import { useEffect, useRef, useState } from "react"
import { Link, PencilSquare, Trash } from "@medusajs/icons"
import { Badge, Button, Drawer, Input, Select, Text, Textarea, clx, toast, usePrompt } from "@medusajs/ui"
import { PRIORITIES, STATUSES, type TaskPriority, type TaskStatus } from "../../modules/tasks/lib/constants"
import type { CommentDto, StatusResponse, TaskDetailDto, TaskDto } from "../../modules/tasks/lib/contract"
import {
  TasksRequestError,
  useAddComment,
  useAddLink,
  useDeleteComment,
  useDeleteTask,
  useEditComment,
  useRemoveLink,
  useTask,
  useUpdateTask,
} from "./tasks-api"
import { AssigneeSelect, RecordPicker, assigneeBody, assigneeValue, splitTags, useFailToast } from "./tasks-form"
import { completeDay } from "./tasks-rules"
import {
  Field,
  LinkChip,
  PersonAvatar,
  RoleBadge,
  Typeset,
  activityText,
  actorOf,
  authorOf,
  commentBody,
  dueDayOf,
  fmtDateTime,
  fmtRelative,
  overdue,
  taskDescription,
  taskTitle,
  useLabels,
  type PeopleIndex,
} from "./tasks-ui"

/*
 * One task in a drawer: its fields (each change saved at once), tags, the
 * description, linked records, comments and the activity log.
 */

export function TaskDrawer({
  id,
  preview,
  status,
  index,
  today,
  onClose,
}: {
  id: string
  preview: TaskDto | null
  status: StatusResponse | undefined
  index: PeopleIndex
  today: string
  onClose: () => void
}) {
  const q = useTask(id)
  const gone = q.error instanceof TasksRequestError && q.error.status === 404
  const task: TaskDetailDto | null = q.data?.task ?? (preview ? { ...preview, comments: [], activity: [] } : null)

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        {gone ? <Gone onClose={onClose} /> : task ? <DrawerBody task={task} loaded={Boolean(q.data)} status={status} index={index} today={today} onClose={onClose} /> : null}
      </Drawer.Content>
    </Drawer>
  )
}

function Gone({ onClose }: { onClose: () => void }) {
  const { t } = useLabels()
  return (
    <>
      <Drawer.Header>
        <Drawer.Title>{t("drawer.notFound")}</Drawer.Title>
      </Drawer.Header>
      <Drawer.Footer>
        <Button size="small" variant="secondary" onClick={onClose}>
          {t("actions.close")}
        </Button>
      </Drawer.Footer>
    </>
  )
}

function DrawerBody({
  task,
  loaded,
  status,
  index,
  today,
  onClose,
}: {
  task: TaskDetailDto
  loaded: boolean
  status: StatusResponse | undefined
  index: PeopleIndex
  today: string
  onClose: () => void
}) {
  const labels = useLabels()
  const { t, lang } = labels
  const prompt = usePrompt()
  const fail = useFailToast()
  const update = useUpdateTask(task.id)
  const remove = useDeleteTask()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState("")
  const [tagsDraft, setTagsDraft] = useState(task.tags.join(", "))
  const late = overdue(task, today)
  const title = taskTitle(task, lang)
  const description = taskDescription(task, lang)

  useEffect(() => setTagsDraft(task.tags.join(", ")), [task.tags])

  const save = async (body: Record<string, unknown>, done?: () => void) => {
    try {
      await update.mutateAsync(body)
      toast.success(t("toast.updated"))
      done?.()
    } catch (err) {
      fail(err)
    }
  }

  const confirmDelete = async () => {
    const ok = await prompt({
      title: t("confirm.title"),
      description: t("confirm.text", { title }),
      confirmText: t("confirm.confirm"),
      cancelText: t("confirm.cancel"),
      variant: "danger",
    })
    if (!ok) return
    try {
      await remove.mutateAsync(task.id)
      toast.success(t("toast.deleted"))
      onClose()
    } catch (err) {
      fail(err)
    }
  }

  const picked = assigneeValue(task, index)
  const freeText = task.assignee_id ? null : task.assignee
  const people = status?.people ?? []
  const creator = task.created_by ? t("drawer.createdBy", { date: fmtDateTime(task.created_at, lang), name: task.created_by }) : t("drawer.created", { date: fmtDateTime(task.created_at, lang) })

  return (
    <>
      <Drawer.Header>
        <div className="flex min-w-0 flex-col gap-y-1">
          {editingTitle ? (
            <div className="flex items-center gap-x-2">
              <Drawer.Title className="sr-only">{title}</Drawer.Title>
              <Input size="small" value={titleDraft} maxLength={200} onChange={(e) => setTitleDraft(e.target.value)} autoFocus />
              <Button size="small" isLoading={update.isPending} disabled={!titleDraft.trim()} onClick={() => void save({ title: titleDraft.trim() }, () => setEditingTitle(false))}>
                {t("actions.save")}
              </Button>
              <Button size="small" variant="secondary" onClick={() => setEditingTitle(false)}>
                {t("actions.cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-x-2">
              <Drawer.Title className="break-words">
                <Typeset text={title} />
              </Drawer.Title>
              <button
                type="button"
                className="mt-0.5 shrink-0 rounded text-ui-fg-muted transition-fg hover:text-ui-fg-base"
                title={t("drawer.editTitle")}
                aria-label={t("drawer.editTitle")}
                onClick={() => {
                  setTitleDraft(title)
                  setEditingTitle(true)
                }}
              >
                <PencilSquare />
              </button>
            </div>
          )}
          <Text size="xsmall" className="text-ui-fg-muted">
            {creator}
          </Text>
        </div>
      </Drawer.Header>

      <Drawer.Body className="flex flex-col gap-y-6 overflow-auto">
        {task.sample || task.adopted ? (
          <div className="flex flex-wrap gap-1.5">
            {task.sample ? (
              <Badge size="2xsmall" color="purple">
                {t("drawer.sample")}
              </Badge>
            ) : null}
            {task.adopted ? (
              <Badge size="2xsmall" color="grey">
                {t("drawer.adopted")}
              </Badge>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("drawer.status")}>
            <Select size="small" value={task.status} onValueChange={(v) => void save({ status: v as TaskStatus })}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {STATUSES.map((s) => (
                  <Select.Item key={s} value={s}>
                    {labels.status(s)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <Field label={t("drawer.priority")}>
            <Select size="small" value={task.priority} onValueChange={(v) => void save({ priority: v as TaskPriority })}>
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {PRIORITIES.map((p) => (
                  <Select.Item key={p} value={p}>
                    {labels.priority(p)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </Field>
          <Field label={t("drawer.assignee")}>
            <AssigneeSelect size="small" value={picked} freeText={freeText} people={people} index={index} onChange={(v) => void save(assigneeBody(v, freeText))} />
          </Field>
          <Field label={t("drawer.due")}>
            <DueDateInput value={dueDayOf(task) ?? ""} late={late} onSave={(day) => void save({ due_date: day })} />
          </Field>
        </div>

        <Field label={t("drawer.tags")}>
          <div className="flex items-center gap-x-2">
            <Input size="small" value={tagsDraft} placeholder={t("drawer.tagsPlaceholder")} onChange={(e) => setTagsDraft(e.target.value)} />
            {tagsDraft !== task.tags.join(", ") ? (
              <Button size="small" variant="secondary" isLoading={update.isPending} onClick={() => void save({ tags: splitTags(tagsDraft) })}>
                {t("actions.save")}
              </Button>
            ) : null}
          </div>
        </Field>

        <div className="flex flex-col gap-y-2">
          <div className="flex items-center justify-between">
            <Text size="small" weight="plus" leading="compact">
              {t("drawer.description")}
            </Text>
            {!editingDesc ? (
              <Button
                size="small"
                variant="transparent"
                onClick={() => {
                  setDescDraft(description ?? "")
                  setEditingDesc(true)
                }}
              >
                <PencilSquare />
                {t("actions.edit")}
              </Button>
            ) : null}
          </div>
          {editingDesc ? (
            <div className="flex flex-col gap-y-2">
              <Textarea rows={6} value={descDraft} onChange={(e) => setDescDraft(e.target.value)} />
              <div className="flex items-center gap-x-2">
                <Button size="small" isLoading={update.isPending} onClick={() => void save({ description: descDraft.trim() || null }, () => setEditingDesc(false))}>
                  {t("actions.save")}
                </Button>
                <Button size="small" variant="secondary" onClick={() => setEditingDesc(false)}>
                  {t("actions.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Text size="small" className="whitespace-pre-wrap break-words text-ui-fg-subtle">
              {description ? <Typeset text={description} /> : t("drawer.noDescription")}
            </Text>
          )}
        </div>

        <LinksSection task={task} />

        {loaded ? <CommentsSection task={task} index={index} status={status} /> : null}

        {loaded ? (
          <div className="flex flex-col gap-y-3">
            <Text size="small" weight="plus" leading="compact">
              {t("drawer.activity")}
            </Text>
            {task.activity.length === 0 ? (
              <Text size="small" className="text-ui-fg-muted">
                {t("drawer.noActivity")}
              </Text>
            ) : (
              <div className="flex flex-col gap-y-2">
                {task.activity.map((a) => {
                  const who = actorOf(a, index, labels)
                  return (
                    <div key={a.id} className="flex flex-col border-l-2 border-ui-border-strong pl-3">
                      <Text size="small">{activityText(a, labels)}</Text>
                      <Text size="xsmall" className="text-ui-fg-muted" title={fmtDateTime(a.created_at, lang)}>
                        {who.name}, {fmtRelative(a.created_at, lang)}
                      </Text>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}
      </Drawer.Body>

      <Drawer.Footer>
        <Button size="small" variant="danger" onClick={() => void confirmDelete()} isLoading={remove.isPending}>
          <Trash />
          {t("actions.delete")}
        </Button>
        <Drawer.Close asChild>
          <Button size="small" variant="secondary">
            {t("actions.close")}
          </Button>
        </Drawer.Close>
      </Drawer.Footer>
    </>
  )
}

function LinksSection({ task }: { task: TaskDetailDto }) {
  const { t } = useLabels()
  const fail = useFailToast()
  const add = useAddLink(task.id)
  const removeLink = useRemoveLink(task.id)
  const [picking, setPicking] = useState(false)

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center justify-between">
        <Text size="small" weight="plus" leading="compact">
          {t("drawer.links")}
        </Text>
        <Button size="small" variant="transparent" onClick={() => setPicking(!picking)}>
          <Link />
          {t("actions.addLink")}
        </Button>
      </div>
      {task.links.length === 0 ? (
        <Text size="small" className="text-ui-fg-muted">
          {t("drawer.noLinks")}
        </Text>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {task.links.map((l) => (
            <LinkChip
              key={l.id}
              link={l}
              onRemove={() =>
                void removeLink
                  .mutateAsync(l.id)
                  .then(() => toast.success(t("toast.unlinked")))
                  .catch(fail)
              }
            />
          ))}
        </div>
      )}
      {picking ? (
        <RecordPicker
          busy={add.isPending}
          exclude={task.links.map((l) => `${l.type}:${l.entity_id}`)}
          onPick={(r) =>
            void add
              .mutateAsync({ type: r.type, id: r.id })
              .then(() => {
                toast.success(t("toast.linked"))
                setPicking(false)
              })
              .catch(fail)
          }
        />
      ) : null}
    </div>
  )
}

function CommentsSection({ task, index, status }: { task: TaskDetailDto; index: PeopleIndex; status: StatusResponse | undefined }) {
  const labels = useLabels()
  const { t } = labels
  const fail = useFailToast()
  const add = useAddComment(task.id)
  const [body, setBody] = useState("")
  const me = status?.viewer.name ?? null

  const submit = async () => {
    if (!body.trim()) return
    try {
      await add.mutateAsync({ body: body.trim() })
      setBody("")
      toast.success(t("toast.commented"))
    } catch (err) {
      fail(err)
    }
  }

  return (
    <div className="flex flex-col gap-y-3">
      <Text size="small" weight="plus" leading="compact">
        {t("drawer.comments")} <span className="tabular-nums text-ui-fg-muted">{task.comments.length}</span>
      </Text>
      {task.comments.length === 0 ? (
        <Text size="small" className="text-ui-fg-muted">
          {t("drawer.noComments")}
        </Text>
      ) : (
        <div className="flex flex-col gap-y-2">
          {task.comments.map((c) => (
            <CommentRow key={c.id} taskId={task.id} comment={c} index={index} />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-y-2">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("drawer.commentPlaceholder")} />
        <div className="flex items-center gap-x-2">
          {me ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              {t("drawer.commentAs", { name: me })}
            </Text>
          ) : null}
          <Button size="small" className="ml-auto" onClick={() => void submit()} isLoading={add.isPending} disabled={!body.trim()}>
            {t("actions.comment")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CommentRow({ taskId, comment: c, index }: { taskId: string; comment: CommentDto; index: PeopleIndex }) {
  const labels = useLabels()
  const { t, lang } = labels
  const prompt = usePrompt()
  const fail = useFailToast()
  const edit = useEditComment(taskId)
  const remove = useDeleteComment(taskId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const who = authorOf(c, index, labels)
  const text = commentBody(c, lang)

  const del = async () => {
    const ok = await prompt({ title: t("confirm.commentTitle"), description: t("confirm.commentText"), confirmText: t("confirm.confirm"), cancelText: t("confirm.cancel"), variant: "danger" })
    if (!ok) return
    try {
      await remove.mutateAsync(c.id)
      toast.success(t("toast.commentDeleted"))
    } catch (err) {
      fail(err)
    }
  }

  return (
    <div className={clx("flex flex-col gap-y-1 rounded-lg bg-ui-bg-subtle p-3")}>
      <div className="flex items-center gap-x-2">
        <PersonAvatar who={who} />
        <Text size="xsmall" weight="plus" className="truncate">
          {who.name}
        </Text>
        <RoleBadge role={c.author_role} />
        <Text size="xsmall" className="ml-auto shrink-0 text-ui-fg-muted" title={fmtDateTime(c.created_at, lang)}>
          {fmtRelative(c.created_at, lang)}
          {c.edited_at ? `, ${t("drawer.edited")}` : ""}
        </Text>
      </div>
      {editing ? (
        <div className="flex flex-col gap-y-2">
          <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex items-center gap-x-2">
            <Button
              size="small"
              isLoading={edit.isPending}
              disabled={!draft.trim()}
              onClick={() =>
                void edit
                  .mutateAsync({ id: c.id, body: draft.trim() })
                  .then(() => {
                    setEditing(false)
                    toast.success(t("toast.commentUpdated"))
                  })
                  .catch(fail)
              }
            >
              {t("actions.save")}
            </Button>
            <Button size="small" variant="secondary" onClick={() => setEditing(false)}>
              {t("actions.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Text size="small" className="whitespace-pre-wrap break-words">
          <Typeset text={text} />
        </Text>
      )}
      {c.own && !editing ? (
        <div className="flex items-center gap-x-1">
          <Button
            size="small"
            variant="transparent"
            onClick={() => {
              setDraft(text)
              setEditing(true)
            }}
          >
            {t("actions.edit")}
          </Button>
          <Button size="small" variant="transparent" isLoading={remove.isPending} onClick={() => void del()}>
            {t("actions.remove")}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The due date, saved once it is a whole date: typing a year passes through
 * 0002, 0020 and 0202, which are never sent. A picked or typed date is saved
 * a moment after the last change, on blur, on Enter or when the drawer closes.
 */
function DueDateInput({ value, late, onSave }: { value: string; late: boolean; onSave: (day: string | null) => void }) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => setDraft(value), [value])

  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    if (next === null) return
    saveRef.current(next === "" ? null : next)
  }

  useEffect(() => () => flush(), [])

  const change = (next: string) => {
    setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    if (next === value || (next !== "" && !completeDay(next))) return
    pending.current = next
    timer.current = setTimeout(flush, 700)
  }

  return (
    <Input
      size="small"
      type="date"
      min="2000-01-01"
      max="2100-12-31"
      className={late ? "text-ui-fg-error" : undefined}
      value={draft}
      onChange={(e) => change(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === "Enter") flush()
      }}
    />
  )
}
