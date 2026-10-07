/**
 * Rows to the answers of the admin API (`contract.ts`). Pure, tested with
 * `node --test`.
 *
 * Rows of the KODA Panel module are read as they are: an unknown status reads
 * as backlog, an unknown priority as medium, the role `koda` (one copy of
 * that module renamed `claude`) as `claude`, tags that are not a list of
 * strings as no tags.
 */

import { CLOSED_STATUSES, OPEN_STATUSES, SANDBOX_BOARD, isLinkType, isRole, type ActorType, type AuthorRole, type Board, type LinkType } from "./constants"
import type { ActivityDto, CommentDto, CountsDto, LinkDto, SampleText, TaskDto } from "./contract"
import type { EventTask } from "./events"
import { normalizePriority, normalizeStatus } from "./status"
import type { StatusCountRow } from "./store"
import type { ActivityRow, CommentRow, LinkRow, Stamp, TaskRow } from "./rows"

export function iso(value: Stamp | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function dateOf(value: Stamp | null | undefined): Date | null {
  const s = iso(value)
  return s ? new Date(s) : null
}

export function boardOfRow(value: unknown): Board {
  return value === SANDBOX_BOARD ? SANDBOX_BOARD : "main"
}

/** Tags as stored: an array of strings (anything else reads as none). */
export function tagsOf(value: unknown): string[] {
  let v: unknown = value
  if (typeof value === "string") {
    try {
      v = JSON.parse(value)
    } catch {
      return value.trim() ? [value.trim()] : []
    }
  }
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()) : []
}

export function roleOf(value: unknown): AuthorRole {
  if (isRole(value)) return value
  return value === "koda" ? "claude" : "agency"
}

function actorTypeOf(value: unknown): ActorType | null {
  return value === "user" || value === "api-key" || value === "system" ? value : null
}

function sampleText(value: unknown): SampleText | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const out: SampleText = {}
  if (typeof v.en === "string" && v.en) out.en = v.en
  if (typeof v.pl === "string" && v.pl) out.pl = v.pl
  return out.en || out.pl ? out : null
}

function metaOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** The sample texts of a sandbox task, field by field (an edited field drops its own). */
export function taskSample(metadata: unknown): TaskDto["sample"] {
  const sample = metaOf(metaOf(metadata)?.sample)
  if (!sample) return null
  const title = sampleText(sample.title)
  const description = sampleText(sample.description)
  if (!title && !description) return null
  return { ...(title ? { title } : {}), ...(description ? { description } : {}) }
}

export function toLinkDto(row: LinkRow, label?: { label: string | null; found: boolean }): LinkDto {
  const type: LinkType = isLinkType(row.entity_type) ? row.entity_type : "order"
  return {
    id: row.id,
    type,
    entity_id: row.entity_id,
    label: label?.label ?? null,
    found: label ? label.found : true,
    created_by: row.created_by ?? null,
    created_at: iso(row.created_at) ?? "",
  }
}

export function toTaskDto(row: TaskRow, extra: { commentCount?: number; links?: LinkDto[] } = {}): TaskDto {
  const metadata = metaOf(row.metadata)
  return {
    id: row.id,
    board: boardOfRow(row.board),
    title: row.title ?? "",
    description: row.description ?? null,
    status: normalizeStatus(row.status),
    priority: normalizePriority(row.priority),
    assignee: row.assignee ?? null,
    assignee_id: row.assignee_id ?? null,
    due_date: iso(row.due_date),
    tags: tagsOf(row.tags),
    position: Number(row.position) || 0,
    completed_at: iso(row.completed_at),
    created_by: row.created_by ?? null,
    created_by_id: row.created_by_id ?? null,
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
    comment_count: extra.commentCount ?? 0,
    links: extra.links ?? [],
    sample: taskSample(metadata),
    adopted: typeof metadata?.adopted_from === "string",
  }
}

export function toCommentDto(row: CommentRow, viewer: { type: string; id: string | null } | null): CommentDto {
  const sample = sampleText(metaOf(metaOf(row.metadata)?.sample)?.body)
  const authorType = actorTypeOf(row.author_type)
  return {
    id: row.id,
    task_id: row.task_id,
    body: row.body ?? "",
    author: row.author ?? null,
    author_id: row.author_id ?? null,
    author_type: authorType,
    author_role: roleOf(row.author_role),
    sample,
    edited_at: iso(row.edited_at),
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
    own: Boolean(viewer?.id && row.author_id === viewer.id && authorType === viewer.type),
  }
}

export function toActivityDto(row: ActivityRow & { task_title?: string | null }): ActivityDto {
  const metadata = metaOf(row.metadata)
  const title = row.task_title ?? (row.type === "task_deleted" && typeof metadata?.title === "string" ? metadata.title : null)
  return {
    id: row.id,
    task_id: row.task_id,
    task_title: title,
    type: row.type,
    message: row.message ?? null,
    actor: row.actor ?? null,
    actor_id: row.actor_id ?? null,
    actor_type: actorTypeOf(row.actor_type),
    metadata,
    created_at: iso(row.created_at) ?? "",
  }
}

export function emptyCounts(): CountsDto {
  return { all: 0, backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0, rejected: 0, open: 0, overdue: 0, urgent: 0, unassigned: 0 }
}

/** The counters from the per status rows; unknown statuses of old rows count as backlog, like on the board. */
export function countsFrom(rows: readonly StatusCountRow[]): CountsDto {
  const c = emptyCounts()
  for (const r of rows) {
    const status = normalizeStatus(r.status)
    const n = Number(r.count) || 0
    c[status] += n
    c.all += n
    if ((OPEN_STATUSES as readonly string[]).includes(status)) c.open += n
    c.overdue += Number(r.overdue) || 0
    c.urgent += Number(r.urgent) || 0
    c.unassigned += Number(r.unassigned) || 0
  }
  return c
}

/** Closed tasks the board answer left out. */
export function hiddenClosed(counts: CountsDto, rows: readonly TaskRow[]): number {
  const shown = rows.filter((r) => (CLOSED_STATUSES as readonly string[]).includes(String(r.status))).length
  return Math.max(0, counts.done + counts.rejected - shown)
}

/** What the events say about a task. */
export function eventTask(row: TaskRow, links: ReadonlyArray<{ entity_type: string; entity_id: string }>): EventTask {
  return {
    id: row.id,
    board: String(row.board),
    title: row.title ?? "",
    status: normalizeStatus(row.status),
    priority: normalizePriority(row.priority),
    assignee: row.assignee ?? null,
    assignee_id: row.assignee_id ?? null,
    due_date: dateOf(row.due_date),
    tags: tagsOf(row.tags),
    links: links.filter((l) => isLinkType(l.entity_type)).map((l) => ({ type: l.entity_type as LinkType, id: l.entity_id })),
  }
}

