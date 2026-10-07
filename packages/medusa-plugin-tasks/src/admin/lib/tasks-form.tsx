import { useEffect, useMemo, useState } from "react"
import { MagnifyingGlass, Plus, XMarkMini } from "@medusajs/icons"
import { Button, FocusModal, Heading, Input, Label, Select, Text, Textarea, toast } from "@medusajs/ui"
import { LINK_TYPES, PRIORITIES, STATUSES, TAGS_MAX, type LinkType, type TaskPriority, type TaskStatus } from "../../modules/tasks/lib/constants"
import type { PersonDto, StatusResponse } from "../../modules/tasks/lib/contract"
import { errorCode, errorMessage, fieldErrorCode, useCreateTask, useRecordSearch, type FoundRecord } from "./tasks-api"
import { TasksIcon } from "./tasks-icon"
import { personKey } from "../../modules/tasks/lib/people"
import { LinkIcon, Person, roleLine, useDebounced, useLabels, usePeopleIndex, type Labels, type PeopleIndex } from "./tasks-ui"

/*
 * Creating a task: the "New task" modal (also opened by the widgets with a
 * record linked in advance), and the pieces the task drawer shares with it:
 * the record picker, the assignee picker and the tags field.
 */

/** A failed request as a toast in the admin's language, by its stable code when there is one. */
export function useFailToast() {
  const labels = useLabels()
  return (err: unknown) => toastError(err, labels)
}

/** The message of a refusal in the admin's language: the field's own code first (other_board, too_long), then the refusal's. */
export function errorText(err: unknown, labels: Labels): string {
  const message = errorMessage(err)
  const fallback = labels.t("toast.error", { error: message })
  const field = fieldErrorCode(err)
  if (field) {
    const text = labels.t(`errors.fields.${field}`, { defaultValue: "" })
    if (text) return text
  }
  const code = errorCode(err)
  return code ? labels.t(`errors.${code}`, { defaultValue: fallback, message }) : fallback
}

export function toastError(err: unknown, labels: Labels) {
  toast.error(errorText(err, labels))
}

/** Tags typed as text: split on commas, cleaned, unique without case, at most ten. */
export function splitTags(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(",")) {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, 32)
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag)
  }
  return out.slice(0, TAGS_MAX)
}

/* ------------------------------------------------------------------ */
/* Assignee                                                            */
/* ------------------------------------------------------------------ */

/**
 * The picker's value for a task: `none`, `user:<id>` for an admin user,
 * `name:<name>` for a named person of the `people` option, `text` for any
 * other free text name.
 */
export function assigneeValue(task: { assignee: string | null; assignee_id: string | null }, index: PeopleIndex): string {
  if (task.assignee_id) return `user:${task.assignee_id}`
  if (!task.assignee || !task.assignee.trim()) return "none"
  const named = index.named.get(personKey(task.assignee))
  return named ? `name:${named.name}` : "text"
}

/** The assignee picker: unassigned, the board's admin users, the named people of the option, and the current free text name. */
export function AssigneeSelect({
  value,
  freeText,
  people,
  index,
  onChange,
  size = "base",
}: {
  value: string
  freeText: string | null
  people: PersonDto[]
  index: PeopleIndex
  onChange: (value: string) => void
  size?: "small" | "base"
}) {
  const { t, lang } = useLabels()
  return (
    <Select size={size} value={value} onValueChange={onChange}>
      <Select.Trigger>
        <Select.Value />
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="none">
          <Person who={null} fallback={t("form.unassigned")} plain />
        </Select.Item>
        {people.map((p) => (
          <Select.Item key={p.id} value={`user:${p.id}`}>
            <Person who={{ name: p.name, url: p.avatar_url, ai: false }} plain />
          </Select.Item>
        ))}
        {index.namedList.map((n) => (
          <Select.Item key={`name:${n.name}`} value={`name:${n.name}`}>
            <span className="inline-flex min-w-0 items-center gap-x-1.5">
              <Person who={{ name: n.name, url: n.avatar, ai: n.kind === "agent" }} plain />
              {roleLine(n.role, lang) ? <span className="truncate text-ui-fg-muted">{roleLine(n.role, lang)}</span> : null}
            </span>
          </Select.Item>
        ))}
        {freeText && value === "text" ? (
          <Select.Item value="text">
            <Person who={{ name: freeText, url: null, ai: false }} plain />
          </Select.Item>
        ) : null}
      </Select.Content>
    </Select>
  )
}

/** The body fields of an assignee choice. */
export function assigneeBody(value: string, freeText: string | null): Record<string, unknown> {
  if (value.startsWith("user:")) return { assignee_id: value.slice(5) }
  if (value.startsWith("name:")) return { assignee: value.slice(5) }
  if (value === "text" && freeText) return { assignee: freeText }
  return { assignee_id: null }
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface PickedRecord {
  type: LinkType
  id: string
  label: string
}

/** Search an order, a product or a customer of the store and pick one. */
export function RecordPicker({ onPick, exclude = [], busy = false }: { onPick: (r: PickedRecord) => void; exclude?: string[]; busy?: boolean }) {
  const labels = useLabels()
  const { t } = labels
  const [type, setType] = useState<LinkType>("order")
  const [q, setQ] = useState("")
  const term = useDebounced(q, 300)
  const search = useRecordSearch(type, term, true)
  const rows = (search.data ?? []).filter((r) => !exclude.includes(`${type}:${r.id}`))

  return (
    <div className="flex flex-col gap-y-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="sm:w-36">
          <Select size="small" value={type} onValueChange={(v) => setType(v as LinkType)}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {LINK_TYPES.map((lt) => (
                <Select.Item key={lt} value={lt}>
                  {labels.linkType(lt)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="flex-1">
          <Input size="small" type="search" placeholder={t(`links.searchPlaceholder.${type}`)} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="flex max-h-48 flex-col overflow-y-auto">
        {search.isFetching && rows.length === 0 ? (
          <Text size="xsmall" className="px-1 py-2 text-ui-fg-muted">
            {t("links.searching")}
          </Text>
        ) : rows.length === 0 ? (
          <Text size="xsmall" className="px-1 py-2 text-ui-fg-muted">
            {t("links.none")}
          </Text>
        ) : (
          rows.map((r: FoundRecord) => (
            <button
              key={r.id}
              type="button"
              disabled={busy}
              onClick={() => onPick({ type, id: r.id, label: r.label })}
              className="flex items-center gap-x-2 rounded-md px-2 py-1.5 text-left transition-fg hover:bg-ui-bg-base-hover disabled:opacity-50"
            >
              <LinkIcon type={type} className="h-4 w-4 shrink-0 text-ui-fg-muted" />
              <span className="flex min-w-0 flex-col">
                <span className="txt-compact-small-plus truncate text-ui-fg-base">{r.label}</span>
                {r.sub ? <span className="txt-compact-xsmall truncate text-ui-fg-muted">{r.sub}</span> : null}
              </span>
              <Plus className="ml-auto shrink-0 text-ui-fg-muted" />
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* New task                                                            */
/* ------------------------------------------------------------------ */

/* The dialog title for screen readers; older @medusajs/ui releases may not have it. */
const ModalTitle = (FocusModal as unknown as { Title?: typeof FocusModal.Title }).Title

interface Draft {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string
  due: string
  tags: string
  links: PickedRecord[]
}

const emptyDraft = (links: PickedRecord[] = []): Draft => ({ title: "", description: "", status: "todo", priority: "medium", assignee: "none", due: "", tags: "", links })

/**
 * The "New task" modal, controlled by the page: `initialLinks` come from a
 * widget ("New task" on an order, a product or a customer).
 */
export function CreateTaskModal({
  open,
  onOpenChange,
  status,
  initialLinks,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: StatusResponse | undefined
  initialLinks: PickedRecord[]
  onCreated: (id: string) => void
}) {
  const labels = useLabels()
  const { t } = labels
  const fail = useFailToast()
  const create = useCreateTask()
  const [form, setForm] = useState<Draft>(() => emptyDraft(initialLinks))
  const [picking, setPicking] = useState(false)
  const linkKey = initialLinks.map((l) => `${l.type}:${l.id}`).join(",")

  useEffect(() => {
    if (open) {
      setForm(emptyDraft(initialLinks))
      setPicking(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, linkKey])

  const people = status?.people ?? []
  const index = usePeopleIndex(status?.people, status?.named_people)
  const board = status?.sandbox ? t("form.boardSandbox") : t("form.boardMain")
  const taken = useMemo(() => form.links.map((l) => `${l.type}:${l.id}`), [form.links])

  const submit = async () => {
    if (!form.title.trim()) {
      toast.error(t("form.required"))
      return
    }
    try {
      const r = await create.mutateAsync({
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        priority: form.priority,
        ...assigneeBody(form.assignee, null),
        due_date: form.due || null,
        tags: splitTags(form.tags),
        links: form.links.map((l) => ({ type: l.type, id: l.id })),
      })
      toast.success(t("toast.created"))
      onOpenChange(false)
      onCreated(r.task.id)
    } catch (err) {
      fail(err)
    }
  }

  return (
    <FocusModal open={open} onOpenChange={onOpenChange}>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <FocusModal.Close asChild>
              <Button size="small" variant="secondary" disabled={create.isPending}>
                {t("actions.cancel")}
              </Button>
            </FocusModal.Close>
            <Button size="small" onClick={() => void submit()} isLoading={create.isPending}>
              {t("actions.saveTask")}
            </Button>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-auto py-12">
          <div className="flex w-full max-w-lg flex-col gap-y-6 px-4">
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center gap-x-2">
                <TasksIcon width={24} height={24} />
                {ModalTitle ? (
                  <ModalTitle asChild>
                    <Heading level="h2">{t("form.title")}</Heading>
                  </ModalTitle>
                ) : (
                  <Heading level="h2">{t("form.title")}</Heading>
                )}
              </div>
              <Text size="small" className="text-ui-fg-subtle">
                {t("form.subtitle", { board })}
              </Text>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus" htmlFor="tasks-new-title">
                {t("form.taskTitle")}
              </Label>
              <Input id="tasks-new-title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("form.titlePlaceholder")} autoFocus />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus" htmlFor="tasks-new-description">
                {t("form.description")}
              </Label>
              <Textarea
                id="tasks-new-description"
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t("form.descriptionPlaceholder")}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  {t("form.status")}
                </Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as TaskStatus })}>
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
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  {t("form.priority")}
                </Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as TaskPriority })}>
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
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  {t("form.assignee")}
                </Label>
                <AssigneeSelect value={form.assignee} freeText={null} people={people} index={index} onChange={(v) => setForm({ ...form, assignee: v })} />
              </div>
              <div className="flex flex-col gap-y-2">
                <Label size="small" weight="plus" htmlFor="tasks-new-due">
                  {t("form.due")}
                </Label>
                <Input id="tasks-new-due" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label size="small" weight="plus" htmlFor="tasks-new-tags">
                {t("form.tags")}
              </Label>
              <Input id="tasks-new-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder={t("form.tagsPlaceholder")} />
              <Text size="xsmall" className="text-ui-fg-muted">
                {t("form.tagsHint")}
              </Text>
            </div>
            <div className="flex flex-col gap-y-2">
              <div className="flex items-center justify-between">
                <Label size="small" weight="plus">
                  {t("form.links")}
                </Label>
                <Button size="small" variant="transparent" onClick={() => setPicking(!picking)}>
                  <MagnifyingGlass />
                  {t("links.pick")}
                </Button>
              </div>
              {form.links.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {form.links.map((l) => (
                    <span key={`${l.type}:${l.id}`} className="inline-flex items-center gap-x-1 rounded-md border border-ui-border-base bg-ui-bg-component px-1.5 py-0.5">
                      <LinkIcon type={l.type} className="h-3.5 w-3.5 text-ui-fg-muted" />
                      <span className="txt-compact-xsmall-plus text-ui-fg-subtle">{l.label}</span>
                      <button
                        type="button"
                        className="ml-0.5 text-ui-fg-muted transition-fg hover:text-ui-fg-base"
                        onClick={() => setForm({ ...form, links: form.links.filter((x) => !(x.type === l.type && x.id === l.id)) })}
                        aria-label={t("actions.remove")}
                      >
                        <XMarkMini />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              {picking ? (
                <RecordPicker
                  exclude={taken}
                  onPick={(r) => {
                    setForm({ ...form, links: [...form.links, r] })
                    setPicking(false)
                  }}
                />
              ) : null}
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
