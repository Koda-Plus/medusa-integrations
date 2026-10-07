/**
 * THE ACTIVITY LOG: what a change writes, and how a row reads. Pure, tested
 * with `node --test`.
 *
 * Every entry stores a `type`, a short English `message` for scripts and a
 * `metadata` object with the facts; the admin writes its own line in the
 * admin's language from `type` and `metadata`. Rows adopted from the KODA
 * Panel module have Polish or English text and sometimes no metadata
 * (`Zmieniono status: todo / done`); `describeActivity` reads both.
 */

import { isStatus, type ActivityType, type LinkType, type TaskStatus } from "./constants"
import type { TaskChange } from "./events"

export interface ActivityDraft {
  type: ActivityType
  message: string
  metadata: Record<string, unknown> | null
}

export function createdEntry(task: { status: TaskStatus; priority: string }): ActivityDraft {
  return { type: "task_created", message: "Created the task", metadata: { status: task.status, priority: task.priority } }
}

export function statusEntry(from: TaskStatus, to: TaskStatus): ActivityDraft {
  return { type: "status_changed", message: `Moved from ${from} to ${to}`, metadata: { from, to } }
}

export interface AssigneeRef {
  id: string | null
  name: string | null
}

export function assignedEntry(from: AssigneeRef, to: AssigneeRef): ActivityDraft {
  return {
    type: "assigned",
    message: to.name ? `Assigned to ${to.name}` : "Unassigned",
    metadata: { from: from.name, from_id: from.id, to: to.name, to_id: to.id },
  }
}

export function commentedEntry(commentId: string): ActivityDraft {
  return { type: "commented", message: "Commented", metadata: { comment_id: commentId } }
}

export function linkedEntry(type: LinkType, id: string): ActivityDraft {
  return { type: "linked", message: `Linked ${type} ${id}`, metadata: { link_type: type, entity_id: id } }
}

export function unlinkedEntry(type: LinkType, id: string): ActivityDraft {
  return { type: "unlinked", message: `Unlinked ${type} ${id}`, metadata: { link_type: type, entity_id: id } }
}

/** Title, description, priority, due date or tags changed. `details` carries the before and after of the short fields. */
export function updatedEntry(fields: readonly TaskChange[], details: Record<string, { from: unknown; to: unknown }> = {}): ActivityDraft {
  return { type: "task_updated", message: `Changed ${fields.join(", ")}`, metadata: { fields: [...fields], ...details } }
}

export function deletedEntry(title: string): ActivityDraft {
  return { type: "task_deleted", message: "Deleted the task", metadata: { title } }
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export type ActivityKind = "created" | "moved" | "status" | "assigned" | "unassigned" | "commented" | "linked" | "unlinked" | "updated" | "deleted" | "other"

export interface ActivityView {
  kind: ActivityKind
  from?: TaskStatus
  to?: TaskStatus
  /** `assigned`: the new assignee's name. */
  name?: string
  fields?: string[]
  linkType?: string
  entityId?: string
  /** `other`: the stored text, as the row has it. */
  text?: string
}

/* "todo -> done", "todo / done", "todo \u2192 done" in the KODA Panel's messages. */
const LEGACY_MOVE = /([a-z_]+)\s*(?:->|\/|\u2192)\s*([a-z_]+)/

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** How a row reads, whatever wrote it. */
export function describeActivity(row: { type: string; message: string | null; metadata: Record<string, unknown> | null }): ActivityView {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  switch (row.type) {
    case "task_created":
      return { kind: "created" }
    case "commented":
      return { kind: "commented" }
    case "task_deleted":
      return { kind: "deleted" }
    case "status_changed": {
      let from = str(meta.from)
      let to = str(meta.to)
      if (!isStatus(from) || !isStatus(to)) {
        const m = LEGACY_MOVE.exec(row.message ?? "")
        if (m && isStatus(m[1]) && isStatus(m[2])) [from, to] = [m[1], m[2]]
      }
      return isStatus(from) && isStatus(to) ? { kind: "moved", from, to } : { kind: "status" }
    }
    case "assigned": {
      const name = str(meta.to)
      return name ? { kind: "assigned", name } : { kind: "unassigned" }
    }
    case "linked":
    case "unlinked":
      return { kind: row.type, linkType: str(meta.link_type) ?? undefined, entityId: str(meta.entity_id) ?? undefined }
    case "task_updated": {
      const fields = Array.isArray(meta.fields) ? meta.fields.filter((f): f is string => typeof f === "string") : []
      return { kind: "updated", fields }
    }
    default:
      return { kind: "other", text: row.message ?? row.type }
  }
}
