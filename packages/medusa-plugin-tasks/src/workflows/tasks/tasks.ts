/**
 * THE CHANGES TO THE BOARD: create, update, move, delete, comments, links.
 * Every change:
 *
 *   1. works through the store of the request context's board, so an id of
 *      another board answers 404, exactly like an id that does not exist;
 *   2. checks the body (`lib/validation.ts`) and, for assignees and links,
 *      the admin user or the Medusa record behind them;
 *   3. writes the change and its activity entries together (one
 *      transaction; moves and status changes under the board's lock);
 *   4. emits its event (`lib/events.ts`) after the write.
 *
 * Who did it comes from the context: an admin user writes under their name,
 * a script or AI agent with a secret API key under the name it sent
 * (`author`), with the role `claude`.
 */

import { LINKS_PER_TASK_MAX, type TaskStatus } from "../../modules/tasks/lib/constants"
import type { Actor, RequestContext } from "../../modules/tasks/lib/actor"
import { userName } from "../../modules/tasks/lib/actor"
import {
  assignedEntry,
  commentedEntry,
  createdEntry,
  deletedEntry,
  linkedEntry,
  statusEntry,
  unlinkedEntry,
  updatedEntry,
  type ActivityDraft,
} from "../../modules/tasks/lib/activity"
import type { CommentDto, LinkDto, TaskDto } from "../../modules/tasks/lib/contract"
import { utcDay } from "../../modules/tasks/lib/dates"
import { dateOf, eventTask, tagsOf, toCommentDto, toLinkDto } from "../../modules/tasks/lib/dto"
import {
  COMMENT_CREATED,
  TASK_CREATED,
  TASK_DELETED,
  TASK_STATUS_CHANGED,
  TASK_UPDATED,
  commentEventData,
  eventsForUpdate,
  taskEventData,
  type TaskChange,
} from "../../modules/tasks/lib/events"
import { isSandboxEmail } from "../../modules/tasks/lib/options"
import type { ActivityInsert, LinkInsert, TaskInsert, TaskRow } from "../../modules/tasks/lib/rows"
import { completedAtAfter, normalizeStatus } from "../../modules/tasks/lib/status"
import type { TaskPatch } from "../../modules/tasks/lib/store"
import { isEntityId } from "../../modules/tasks/lib/text"
import {
  parseComment,
  parseCreate,
  parseLink,
  parseMove,
  parseUpdate,
  type AssigneeInput,
  type FieldError,
  type LinkInput,
} from "../../modules/tasks/lib/validation"
import { userProfile, usersByEmail } from "./context"
import { boardStore, taskDtos, taskRow } from "./read"
import { labelFor, linkLabels } from "./records"
import { ActionError, emitEvent, envOf, newId, notFound, type Scope } from "./runtime"

export function invalid(errors: FieldError[]): ActionError {
  return new ActionError(400, "invalid_data", errors[0]?.message ?? "Invalid request.", { errors })
}

function parsedOrThrow<T>(r: { ok: true; value: T } | { ok: false; errors: FieldError[] }): T {
  if (!r.ok) throw invalid(r.errors)
  return r.value
}

/** Activity rows from drafts, one millisecond apart so they read in the order they were made. */
function entries(taskId: string, actor: Actor, drafts: ReadonlyArray<ActivityDraft | null>, now: Date): ActivityInsert[] {
  return drafts
    .filter((d): d is ActivityDraft => d !== null)
    .map((d, i) => ({
      id: newId("tact"),
      task_id: taskId,
      type: d.type,
      message: d.message,
      actor: actor.name,
      actor_id: actor.id,
      actor_type: actor.type,
      metadata: d.metadata,
      created_at: new Date(now.getTime() + i),
    }))
}

/* ------------------------------------------------------------------ */
/* Assignees and links                                                 */
/* ------------------------------------------------------------------ */

export interface ResolvedAssignee {
  assignee: string | null
  assignee_id: string | null
}

/**
 * The assignee a body names, checked: an admin user must exist and belong to
 * the board (sandbox accounts on the sandbox board, everyone else on the
 * main board); free text is taken as it is.
 */
export async function resolveAssignee(scope: Scope, ctx: RequestContext, input: AssigneeInput): Promise<ResolvedAssignee> {
  if (input === null) return { assignee: null, assignee_id: null }
  if (input.kind === "text") return { assignee: input.name, assignee_id: null }
  const { options } = envOf(scope)
  let profile
  try {
    profile = input.kind === "user" ? await userProfile(scope, input.id) : (await usersByEmail(scope, [input.email]))[0]
  } catch {
    throw new ActionError(503, "account_unavailable", "The assignee could not be checked. Try again in a moment.")
  }
  const field = input.kind === "user" ? "assignee_id" : "assignee_email"
  if (!profile) throw invalid([{ field, code: "not_found", message: "No admin user matches the assignee." }])
  if (isSandboxEmail(profile.email, options) !== ctx.sandbox) {
    throw invalid([{ field, code: "other_board", message: "This admin user does not work on this board." }])
  }
  return { assignee: userName(profile) ?? profile.id, assignee_id: profile.id }
}

/** Every linked record must exist in Medusa. */
async function checkLinks(scope: Scope, links: readonly LinkInput[]): Promise<void> {
  if (links.length === 0) return
  const labels = await linkLabels(
    scope,
    links.map((l) => ({ entity_type: l.type, entity_id: l.id })),
  )
  const missing = links.findIndex((l) => labelFor(labels, l.type, l.id)?.found !== true)
  if (missing >= 0) {
    const l = links[missing]
    throw new ActionError(400, "link_not_found", `There is no ${l.type} ${l.id}.`, { errors: [{ field: `links.${missing}`, code: "not_found", message: `There is no ${l.type} ${l.id}.` }] })
  }
}

async function oneTaskDto(scope: Scope, ctx: RequestContext, row: TaskRow): Promise<TaskDto> {
  const [dto] = await taskDtos(scope, boardStore(scope, ctx), [row])
  return dto
}

async function emitTask(scope: Scope, ctx: RequestContext, name: string, row: TaskRow, previous: TaskStatus | null, changes: TaskChange[] = []): Promise<void> {
  const links = await boardStore(scope, ctx).listLinks([row.id])
  await emitEvent(scope, name, taskEventData(eventTask(row, links), { previousStatus: previous, actor: ctx.actor, changes }))
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export async function createTask(scope: Scope, ctx: RequestContext, body: unknown): Promise<TaskDto> {
  const input = parsedOrThrow(parseCreate(body))
  const env = envOf(scope)
  const now = env.now
  const who = await resolveAssignee(scope, ctx, input.assignee)
  await checkLinks(scope, input.links)
  const id = newId("task")
  const closed = input.status === "done" || input.status === "rejected"
  const task: TaskInsert = {
    id,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    assignee: who.assignee,
    assignee_id: who.assignee_id,
    due_date: input.due_date,
    tags: input.tags.length > 0 ? input.tags : null,
    completed_at: closed ? now : null,
    created_by: ctx.actor.name,
    created_by_id: ctx.actor.id,
    metadata: null,
    created_at: now,
  }
  const links: LinkInsert[] = input.links.map((l) => ({
    id: newId("tlnk"),
    task_id: id,
    entity_type: l.type,
    entity_id: l.id,
    created_by: ctx.actor.name,
    created_by_id: ctx.actor.id,
    created_at: now,
  }))
  const activity = entries(
    id,
    ctx.actor,
    [
      createdEntry({ status: input.status, priority: input.priority }),
      who.assignee ? assignedEntry({ id: null, name: null }, { id: who.assignee_id, name: who.assignee }) : null,
      ...input.links.map((l) => linkedEntry(l.type, l.id)),
    ],
    now,
  )
  const { task: row, links: linkRows } = await env.stores.board(ctx.board).insertTask(task, links, activity)
  await emitEvent(scope, TASK_CREATED, taskEventData(eventTask(row, linkRows), { previousStatus: null, actor: ctx.actor }))
  return oneTaskDto(scope, ctx, row)
}

const sameDay = (a: unknown, b: Date | null) => utcDay(dateOf(a as Date | string | null)) === utcDay(b)
const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i])

/** Drops the sample text of the fields a person changed (sandbox tasks). */
function withoutSample(metadata: unknown, fields: ReadonlyArray<"title" | "description">): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const m = metadata as Record<string, unknown>
  const sample = m.sample
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) return undefined
  const next = { ...(sample as Record<string, unknown>) }
  let changed = false
  for (const f of fields) {
    if (f in next) {
      delete next[f]
      changed = true
    }
  }
  if (!changed) return undefined
  const out = { ...m }
  if (Object.keys(next).length > 0) out.sample = next
  else delete out.sample
  return out
}

export async function updateTask(scope: Scope, ctx: RequestContext, id: string, body: unknown): Promise<TaskDto> {
  if (!isEntityId(id)) throw notFound()
  const input = parsedOrThrow(parseUpdate(body))
  const env = envOf(scope)
  const now = env.now
  const who = input.assignee !== undefined ? await resolveAssignee(scope, ctx, input.assignee) : undefined
  let changes: TaskChange[] = []
  let previous: TaskStatus = "backlog"

  const result = await env.stores.board(ctx.board).updateTask(
    id,
    (before) => {
      const patch: TaskPatch = {}
      const fieldChanges: TaskChange[] = []
      const details: Record<string, { from: unknown; to: unknown }> = {}
      const drafts: Array<ActivityDraft | null> = []
      previous = normalizeStatus(before.status)

      if (input.title !== undefined && input.title !== before.title) {
        patch.title = input.title
        fieldChanges.push("title")
      }
      if (input.description !== undefined && (input.description ?? null) !== (before.description ?? null)) {
        patch.description = input.description
        fieldChanges.push("description")
      }
      if (input.priority !== undefined && input.priority !== before.priority) {
        patch.priority = input.priority
        fieldChanges.push("priority")
        details.priority = { from: before.priority, to: input.priority }
      }
      if (input.due_date !== undefined && !sameDay(before.due_date, input.due_date)) {
        patch.due_date = input.due_date
        fieldChanges.push("due_date")
        details.due_date = { from: utcDay(dateOf(before.due_date)), to: utcDay(input.due_date) }
      }
      if (input.tags !== undefined && !sameTags(tagsOf(before.tags), input.tags)) {
        patch.tags = input.tags.length > 0 ? input.tags : null
        fieldChanges.push("tags")
      }
      if (who && (who.assignee_id !== (before.assignee_id ?? null) || (!who.assignee_id && who.assignee !== (before.assignee ?? null)))) {
        patch.assignee = who.assignee
        patch.assignee_id = who.assignee_id
        drafts.push(assignedEntry({ id: before.assignee_id ?? null, name: before.assignee ?? null }, { id: who.assignee_id, name: who.assignee }))
      }
      if (input.status !== undefined && input.status !== before.status) {
        patch.status = input.status
        patch.completed_at = completedAtAfter(before.status, input.status, dateOf(before.completed_at), now)
        if (normalizeStatus(before.status) !== input.status) drafts.unshift(statusEntry(normalizeStatus(before.status), input.status))
      }
      const edited = (["title", "description"] as const).filter((f) => fieldChanges.includes(f))
      const metadata = edited.length > 0 ? withoutSample(before.metadata, edited) : undefined
      if (metadata !== undefined) patch.metadata = metadata
      if (fieldChanges.length > 0) drafts.push(updatedEntry(fieldChanges, details))

      changes = [...fieldChanges, ...(patch.assignee_id !== undefined ? (["assignee"] as TaskChange[]) : [])]
      if (Object.keys(patch).length === 0) return null
      return { patch, activity: entries(before.id, ctx.actor, drafts, now) }
    },
    now,
  )
  if (!result) throw notFound()
  const after = result.after
  for (const name of eventsForUpdate(previous, normalizeStatus(after.status), result.after === result.before ? [] : changes)) {
    await emitTask(scope, ctx, name, after, previous, name === TASK_UPDATED ? changes : [])
  }
  return oneTaskDto(scope, ctx, after)
}

export async function moveTask(scope: Scope, ctx: RequestContext, id: string, body: unknown): Promise<TaskDto> {
  if (!isEntityId(id)) throw notFound()
  const input = parsedOrThrow(parseMove(body))
  const env = envOf(scope)
  const now = env.now
  let previous: TaskStatus = "backlog"
  const result = await env.stores.board(ctx.board).moveTask(
    id,
    { status: input.status, beforeId: input.before_id, afterId: input.after_id },
    (before) => {
      previous = normalizeStatus(before.status)
      const patch: TaskPatch = { completed_at: completedAtAfter(before.status, input.status, dateOf(before.completed_at), now) }
      return { patch, activity: previous !== input.status ? entries(before.id, ctx.actor, [statusEntry(previous, input.status)], now) : [] }
    },
    now,
  )
  if (!result) throw notFound()
  if (previous !== input.status) await emitTask(scope, ctx, TASK_STATUS_CHANGED, result.after, previous)
  return oneTaskDto(scope, ctx, result.after)
}

export async function deleteTask(scope: Scope, ctx: RequestContext, id: string): Promise<{ id: string; object: "task"; deleted: true }> {
  const env = envOf(scope)
  const store = env.stores.board(ctx.board)
  const before = await taskRow(store, id)
  const links = await store.listLinks([before.id])
  const row = await store.deleteTask(before.id, entries(before.id, ctx.actor, [deletedEntry(before.title)], env.now), env.now)
  if (!row) throw notFound()
  const status = normalizeStatus(row.status)
  await emitEvent(scope, TASK_DELETED, taskEventData(eventTask(row, links), { previousStatus: status, actor: ctx.actor }))
  return { id: row.id, object: "task", deleted: true }
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

export async function addComment(scope: Scope, ctx: RequestContext, taskId: string, body: unknown): Promise<CommentDto> {
  const input = parsedOrThrow(parseComment(body))
  const env = envOf(scope)
  const store = env.stores.board(ctx.board)
  const task = await taskRow(store, taskId)
  const commentId = newId("tcom")
  const row = await store.insertComment(
    {
      id: commentId,
      task_id: task.id,
      body: input.body,
      author: ctx.actor.name,
      author_role: ctx.actor.role,
      author_id: ctx.actor.id,
      author_type: ctx.actor.type,
      metadata: null,
      created_at: env.now,
    },
    entries(task.id, ctx.actor, [commentedEntry(commentId)], env.now),
  )
  if (!row) throw notFound()
  const links = await store.listLinks([task.id])
  await emitEvent(scope, COMMENT_CREATED, commentEventData(eventTask(task, links), { id: row.id, author_role: ctx.actor.role }, ctx.actor))
  return toCommentDto(row, { type: ctx.actor.type, id: ctx.actor.id })
}

async function ownComment(scope: Scope, ctx: RequestContext, id: string) {
  if (!isEntityId(id)) throw notFound("Comment")
  const store = boardStore(scope, ctx)
  const row = await store.getComment(id)
  if (!row) throw notFound("Comment")
  if (!ctx.actor.id || row.author_id !== ctx.actor.id || row.author_type !== ctx.actor.type) {
    throw new ActionError(403, "not_author", "Only the author can change or delete a comment.")
  }
  return { store, row }
}

export async function editComment(scope: Scope, ctx: RequestContext, id: string, body: unknown): Promise<CommentDto> {
  const input = parsedOrThrow(parseComment(body))
  const { store } = await ownComment(scope, ctx, id)
  const row = await store.updateComment(id, input.body, envOf(scope).now)
  if (!row) throw notFound("Comment")
  return toCommentDto(row, { type: ctx.actor.type, id: ctx.actor.id })
}

export async function deleteComment(scope: Scope, ctx: RequestContext, id: string): Promise<{ id: string; object: "task_comment"; deleted: true }> {
  const { store } = await ownComment(scope, ctx, id)
  const row = await store.deleteComment(id, envOf(scope).now)
  if (!row) throw notFound("Comment")
  return { id: row.id, object: "task_comment", deleted: true }
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

export async function addLink(scope: Scope, ctx: RequestContext, taskId: string, body: unknown): Promise<{ link: LinkDto; created: boolean }> {
  const link = parsedOrThrow(parseLink(body))
  const env = envOf(scope)
  const store = env.stores.board(ctx.board)
  const task = await taskRow(store, taskId)
  const existing = await store.listLinks([task.id])
  const duplicate = existing.find((l) => l.entity_type === link.type && l.entity_id === link.id)
  if (!duplicate && existing.length >= LINKS_PER_TASK_MAX) {
    throw new ActionError(409, "too_many_links", `A task takes at most ${LINKS_PER_TASK_MAX} links.`)
  }
  const labels = await linkLabels(scope, [{ entity_type: link.type, entity_id: link.id }])
  const label = labelFor(labels, link.type, link.id)
  if (label?.found !== true) throw new ActionError(404, "link_not_found", `There is no ${link.type} ${link.id}.`)
  const result = await store.insertLink(
    { id: newId("tlnk"), task_id: task.id, entity_type: link.type, entity_id: link.id, created_by: ctx.actor.name, created_by_id: ctx.actor.id, created_at: env.now },
    entries(task.id, ctx.actor, [linkedEntry(link.type, link.id)], env.now),
  )
  if (!result) throw notFound()
  if (result.created) await emitTask(scope, ctx, TASK_UPDATED, task, normalizeStatus(task.status), ["links"])
  return { link: toLinkDto(result.link, label), created: result.created }
}

export async function removeLink(scope: Scope, ctx: RequestContext, taskId: string, linkId: string): Promise<{ id: string; object: "task_link"; deleted: true }> {
  const env = envOf(scope)
  const store = env.stores.board(ctx.board)
  const task = await taskRow(store, taskId)
  if (!isEntityId(linkId)) throw notFound("Link")
  const current = (await store.listLinks([task.id])).find((l) => l.id === linkId)
  if (!current) throw notFound("Link")
  const type = current.entity_type === "product" || current.entity_type === "customer" ? current.entity_type : "order"
  const row = await store.deleteLink(task.id, linkId, entries(task.id, ctx.actor, [unlinkedEntry(type, current.entity_id)], env.now), env.now)
  if (!row) throw notFound("Link")
  await emitTask(scope, ctx, TASK_UPDATED, task, normalizeStatus(task.status), ["links"])
  return { id: row.id, object: "task_link", deleted: true }
}
