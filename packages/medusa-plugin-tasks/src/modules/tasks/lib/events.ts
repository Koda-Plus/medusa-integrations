/**
 * THE EVENTS OTHER CODE BUILDS ON. Pure: the contract is plain data.
 *
 * Five events on the Medusa event bus, each emitted once, after the change is
 * stored:
 *
 *   tasks.task.created         a task was created
 *   tasks.task.updated         title, description, priority, assignee, due
 *                              date, tags or links changed (`changes` lists
 *                              which)
 *   tasks.task.status_changed  the status changed (a drag to another column,
 *                              a status picked in the task, a script);
 *                              `previous_status` says from where
 *   tasks.task.deleted         a task was deleted
 *   tasks.comment.created      a comment was added
 *
 * One request that changes the status and another field emits both
 * `status_changed` and `updated`, each about its own part. Reordering cards
 * within a column emits nothing.
 *
 * `demo: true` marks the sandbox board: subscribers that notify people or
 * touch other systems must skip it.
 *
 * THE SHAPE IS A CONTRACT. Add fields or new events; never rename, remove or
 * retype one.
 */

import { SANDBOX_BOARD, type ActorType, type AuthorRole, type LinkType, type TaskPriority, type TaskStatus } from "./constants"
import type { Actor } from "./actor"

export const TASK_CREATED = "tasks.task.created"
export const TASK_UPDATED = "tasks.task.updated"
export const TASK_STATUS_CHANGED = "tasks.task.status_changed"
export const TASK_DELETED = "tasks.task.deleted"
export const COMMENT_CREATED = "tasks.comment.created"

export const TASK_EVENTS = [TASK_CREATED, TASK_UPDATED, TASK_STATUS_CHANGED, TASK_DELETED, COMMENT_CREATED] as const
export type TaskEventName = (typeof TASK_EVENTS)[number]

/** Fields `tasks.task.updated` can name in `changes`. */
export type TaskChange = "title" | "description" | "priority" | "assignee" | "due_date" | "tags" | "links"

export interface EventActor {
  /** `user` (an admin user), `api-key` (a script or AI agent), `system` (the plugin or custom code). */
  type: ActorType
  /** The admin user id or the API key id; null for `system`. */
  id: string | null
  name: string | null
  /** `agency`, `client` (the store team) or `claude` (a script or AI agent). */
  role: AuthorRole
}

export interface TaskEventData {
  /** The task id. */
  id: string
  /** `main`, or `sandbox` for the sandbox board (then `demo` is true). */
  board: string
  title: string
  /** The status after the change. */
  status: TaskStatus
  /** The status before the change; null for `tasks.task.created`, the same as `status` when it did not change. */
  previous_status: TaskStatus | null
  priority: TaskPriority
  /** The assignee's name (an admin user's, or free text), or null. */
  assignee: string | null
  /** The admin user the task is assigned to, or null. */
  assignee_id: string | null
  /** ISO 8601, or null. */
  due_date: string | null
  tags: string[]
  /** The Medusa records the task is linked to. */
  links: Array<{ type: LinkType; id: string }>
  /** `tasks.task.updated` only: what changed. Empty for the other events. */
  changes: TaskChange[]
  actor: EventActor
  /** The sandbox board: never notify anyone or write real data for it. */
  demo: boolean
}

export interface CommentEventData {
  /** The comment id. */
  id: string
  task_id: string
  board: string
  /** The task's title, status, priority and assignee at the time of the comment. */
  title: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string | null
  assignee_id: string | null
  links: Array<{ type: LinkType; id: string }>
  /** The comment's role: `agency`, `client` or `claude`. */
  author_role: AuthorRole
  actor: EventActor
  demo: boolean
}

/** What the payloads are built from: the task as the flows normalize it. */
export interface EventTask {
  id: string
  board: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string | null
  assignee_id: string | null
  due_date: Date | null
  tags: string[]
  links: Array<{ type: LinkType; id: string }>
}

export function eventActor(actor: Actor): EventActor {
  return { type: actor.type, id: actor.id, name: actor.name, role: actor.role }
}

export function taskEventData(task: EventTask, move: { previousStatus: TaskStatus | null; actor: Actor; changes?: TaskChange[] }): TaskEventData {
  return {
    id: task.id,
    board: task.board,
    title: task.title,
    status: task.status,
    previous_status: move.previousStatus,
    priority: task.priority,
    assignee: task.assignee,
    assignee_id: task.assignee_id,
    due_date: task.due_date ? task.due_date.toISOString() : null,
    tags: [...task.tags],
    links: task.links.map((l) => ({ type: l.type, id: l.id })),
    changes: move.changes ? [...move.changes] : [],
    actor: eventActor(move.actor),
    demo: task.board === SANDBOX_BOARD,
  }
}

export function commentEventData(task: EventTask, comment: { id: string; author_role: AuthorRole }, actor: Actor): CommentEventData {
  return {
    id: comment.id,
    task_id: task.id,
    board: task.board,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    assignee_id: task.assignee_id,
    links: task.links.map((l) => ({ type: l.type, id: l.id })),
    author_role: comment.author_role,
    actor: eventActor(actor),
    demo: task.board === SANDBOX_BOARD,
  }
}

/** The events an update emits: the status change and the other changes, each when there is one. */
export function eventsForUpdate(previousStatus: TaskStatus, status: TaskStatus, changes: readonly TaskChange[]): TaskEventName[] {
  const out: TaskEventName[] = []
  if (previousStatus !== status) out.push(TASK_STATUS_CHANGED)
  if (changes.length > 0) out.push(TASK_UPDATED)
  return out
}
