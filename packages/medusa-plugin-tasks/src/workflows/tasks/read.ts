/**
 * EVERYTHING THE ADMIN API READS, for one request context. Every read goes
 * through the store of the context's board, so a sandbox account reads the
 * sandbox board and nothing else, whatever ids it sends.
 *
 * READS ONLY: nothing here writes, seeds or emits. The sandbox board is
 * seeded by `POST /admin/tasks/sandbox/ensure` and the job (`sandbox.ts`).
 */

import {
  ACTIVITY_DEFAULT,
  ACTIVITY_MAX,
  ADOPTION_KEY,
  CLOSED_TASKS_DEFAULT,
  CLOSED_TASKS_MAX,
  LINK_ID_PREFIX,
  LIST_DEFAULT,
  LIST_MAX,
  OPEN_TASKS_MAX,
  PEOPLE_MAX,
  WIDGET_TASKS,
  isLinkType,
  isPriority,
  isStatus,
  type LinkType,
} from "../../modules/tasks/lib/constants"
import type { RequestContext } from "../../modules/tasks/lib/actor"
import { userName } from "../../modules/tasks/lib/actor"
import type {
  ActivityDto,
  AdoptionDto,
  BoardResponse,
  CommentDto,
  EntityTasksResponse,
  ListResponse,
  PersonDto,
  StatusResponse,
  TaskDetailDto,
  TaskDto,
} from "../../modules/tasks/lib/contract"
import { todayOf } from "../../modules/tasks/lib/dates"
import { countsFrom, hiddenClosed, hiddenOpen, iso, toActivityDto, toCommentDto, toLinkDto, toTaskDto } from "../../modules/tasks/lib/dto"
import { bounded, isAgencyEmail, isSandboxEmail } from "../../modules/tasks/lib/options"
import { nextSandboxReset, sandboxStale } from "../../modules/tasks/lib/sandbox"
import type { BoardStore, TaskQuery } from "../../modules/tasks/lib/store"
import { cleanLine, isEntityId, likePattern } from "../../modules/tasks/lib/text"
import type { TaskRow } from "../../modules/tasks/lib/rows"
import { allUsers, usersByEmail } from "./context"
import { labelFor, linkLabels } from "./records"
import { sandboxMarker } from "./sandbox"
import { envOf, notFound, type Scope } from "./runtime"

export function boardStore(scope: Scope, ctx: RequestContext): BoardStore {
  return envOf(scope).stores.board(ctx.board)
}

/** Tasks with their comment counts and links, the links named by Medusa. */
export async function taskDtos(scope: Scope, store: BoardStore, rows: readonly TaskRow[]): Promise<TaskDto[]> {
  const ids = rows.map((r) => r.id)
  const [counts, links] = await Promise.all([store.commentCounts(ids), store.listLinks(ids)])
  const labels = await linkLabels(scope, links)
  return rows.map((r) =>
    toTaskDto(r, {
      commentCount: counts.get(r.id) ?? 0,
      links: links.filter((l) => l.task_id === r.id).map((l) => toLinkDto(l, labelFor(labels, l.entity_type, l.entity_id))),
    }),
  )
}

/** The start of the request's day (`today=YYYY-MM-DD`, the admin's own calendar day), for overdue counts. */
function dayStart(query: Record<string, unknown>, now: Date): Date {
  return new Date(`${todayOf(query.today, now)}T00:00:00.000Z`)
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

/** The board: every open task and the latest closed ones, with the counters. */
export async function boardView(scope: Scope, ctx: RequestContext, query: Record<string, unknown> = {}): Promise<BoardResponse> {
  const env = envOf(scope)
  const store = env.stores.board(ctx.board)
  const closedLimit = bounded(query.closed_limit, CLOSED_TASKS_DEFAULT, 0, CLOSED_TASKS_MAX)
  const [rows, countRows] = await Promise.all([store.boardTasks(OPEN_TASKS_MAX, closedLimit), store.statusCounts(dayStart(query, env.now))])
  const counts = countsFrom(countRows)
  return { tasks: await taskDtos(scope, store, rows), counts, hidden_closed: hiddenClosed(counts, rows), hidden_open: hiddenOpen(counts, rows) }
}

function listOf(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  return raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
}

/** The list for scripts: filters, a page, the counters of the whole board. */
export async function listTasks(scope: Scope, ctx: RequestContext, query: Record<string, unknown> = {}): Promise<ListResponse> {
  const env = envOf(scope)
  const store = env.stores.board(ctx.board)
  const linkType = query.link_type
  const linkId = query.link_id
  const q: TaskQuery = {
    statuses: listOf(query.status).filter(isStatus),
    priorities: listOf(query.priority).filter(isPriority),
    assigneeId: typeof query.assignee_id === "string" && isEntityId(query.assignee_id) ? query.assignee_id : null,
    assignee: cleanLine(query.assignee, 80) || null,
    unassigned: query.unassigned === "true" || query.unassigned === true,
    tag: cleanLine(query.tag, 32) || null,
    like: likePattern(query.q) || null,
    link: isLinkType(linkType) && typeof linkId === "string" && isEntityId(linkId) ? { type: linkType, id: linkId } : null,
    limit: bounded(query.limit, LIST_DEFAULT, 1, LIST_MAX),
    offset: bounded(query.offset, 0, 0, 1_000_000),
  }
  const [{ rows, count }, countRows] = await Promise.all([store.listTasks(q), store.statusCounts(dayStart(query, env.now))])
  return { tasks: await taskDtos(scope, store, rows), count, counts: countsFrom(countRows), limit: q.limit, offset: q.offset }
}

/** One task of the board, or 404 (also for a task of another board). */
export async function taskRow(store: BoardStore, id: string): Promise<TaskRow> {
  if (!isEntityId(id)) throw notFound()
  const row = await store.getTask(id)
  if (!row) throw notFound()
  return row
}

export async function commentDtos(store: BoardStore, taskId: string, ctx: RequestContext): Promise<CommentDto[]> {
  return (await store.listComments(taskId)).map((c) => toCommentDto(c, { type: ctx.actor.type, id: ctx.actor.id }))
}

/** One task with its comments, links and activity. */
export async function taskDetail(scope: Scope, ctx: RequestContext, id: string): Promise<TaskDetailDto> {
  const store = boardStore(scope, ctx)
  const row = await taskRow(store, id)
  const [[task], comments, activity] = await Promise.all([taskDtos(scope, store, [row]), commentDtos(store, row.id, ctx), store.listActivity(row.id, ACTIVITY_MAX)])
  return { ...task, comment_count: comments.length, comments, activity: activity.map((a) => toActivityDto(a)) }
}

export async function taskComments(scope: Scope, ctx: RequestContext, id: string): Promise<{ comments: CommentDto[] }> {
  const store = boardStore(scope, ctx)
  const row = await taskRow(store, id)
  return { comments: await commentDtos(store, row.id, ctx) }
}

export async function taskActivity(scope: Scope, ctx: RequestContext, id: string, query: Record<string, unknown> = {}): Promise<{ activity: ActivityDto[] }> {
  const store = boardStore(scope, ctx)
  const row = await taskRow(store, id)
  const rows = await store.listActivity(row.id, bounded(query.limit, ACTIVITY_MAX, 1, ACTIVITY_MAX))
  return { activity: rows.map((a) => toActivityDto(a)) }
}

/** The latest activity across the board. */
export async function boardActivity(scope: Scope, ctx: RequestContext, query: Record<string, unknown> = {}): Promise<{ activity: ActivityDto[] }> {
  const rows = await boardStore(scope, ctx).boardActivity(bounded(query.limit, ACTIVITY_DEFAULT, 1, ACTIVITY_MAX))
  return { activity: rows.map((a) => toActivityDto(a)) }
}

/** The widgets: tasks of the board linked to one order, product or customer. */
export async function entityTasks(scope: Scope, ctx: RequestContext, type: LinkType, id: string): Promise<EntityTasksResponse> {
  if (!isEntityId(id) || !id.startsWith(LINK_ID_PREFIX[type])) throw notFound(type[0].toUpperCase() + type.slice(1))
  const store = boardStore(scope, ctx)
  const { rows, count } = await store.tasksForEntity(type, id, WIDGET_TASKS)
  return { board: ctx.board, sandbox: ctx.sandbox, tasks: await taskDtos(scope, store, rows), count }
}

/* ------------------------------------------------------------------ */
/* The status of the page                                              */
/* ------------------------------------------------------------------ */

/** Who tasks of this board can be assigned to: the team on the main board, the sandbox accounts on the sandbox board. */
export async function people(scope: Scope, ctx: RequestContext): Promise<PersonDto[]> {
  const { options } = envOf(scope)
  try {
    const users = ctx.sandbox ? await usersByEmail(scope, options.sandboxAccounts) : (await allUsers(scope, PEOPLE_MAX)).filter((u) => !isSandboxEmail(u.email, options))
    return users.map((u) => ({
      id: u.id,
      name: userName(u) ?? u.id,
      email: u.email ?? null,
      avatar_url: u.avatar_url ?? null,
      role: isAgencyEmail(u.email, options) ? "agency" : "client",
    }))
  } catch {
    return []
  }
}

function adoptionOf(value: unknown): AdoptionDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)
  if (v.state !== "adopted" && v.state !== "skipped") return null
  return {
    state: v.state,
    at: typeof v.at === "string" ? (iso(v.at) ?? null) : null,
    tasks: n(v.tasks),
    comments: n(v.comments),
    activity: n(v.activity),
    reason: typeof v.reason === "string" ? v.reason : null,
  }
}

export async function buildStatus(scope: Scope, ctx: RequestContext, query: Record<string, unknown> = {}): Promise<StatusResponse> {
  const env = envOf(scope)
  const store = env.stores.board(ctx.board)
  const o = env.options
  const [countRows, team, automation, seed, sandboxTasks, adoption] = await Promise.all([
    store.statusCounts(dayStart(query, env.now)),
    people(scope, ctx),
    store.apiKeyActivity(),
    sandboxMarker(scope),
    o.sandboxAccounts.length > 0 ? env.stores.sandbox.countTasks().catch(() => 0) : Promise.resolve(0),
    ctx.sandbox ? Promise.resolve(null) : env.stores.settings.get(ADOPTION_KEY).catch(() => null),
  ])
  const seededAt = typeof seed?.seeded_at === "string" ? seed.seeded_at : null
  return {
    board: ctx.board,
    sandbox: ctx.sandbox,
    viewer: {
      type: ctx.actor.type === "api-key" ? "api-key" : "user",
      id: ctx.actor.id ?? "",
      name: ctx.actor.name,
      email: ctx.actor.email,
      role: ctx.actor.role,
    },
    counts: countsFrom(countRows),
    people: team,
    /* Display metadata of the team: the sandbox keeps to its own sample people. */
    named_people: ctx.sandbox ? [] : o.people.map((p) => ({ name: p.name, avatar: p.avatar, role: p.role, kind: p.kind })),
    options: {
      sandbox_accounts: ctx.sandbox ? null : [...o.sandboxAccounts],
      sandbox_account_count: o.sandboxAccounts.length,
      sandbox_reset_hours: o.sandboxResetHours,
      agency_accounts: ctx.sandbox ? null : [...o.agencyAccounts],
      agency_account_count: o.agencyAccounts.length,
      sandbox_guard: o.sandboxGuard.enabled,
      agent_key_prefix: o.agentKeyPrefix || null,
    },
    sandbox_board: {
      enabled: o.sandboxAccounts.length > 0,
      seeded_at: seededAt,
      tasks: sandboxTasks,
      reset_hours: o.sandboxResetHours,
      next_reset_at: nextSandboxReset(seededAt, o.sandboxResetHours),
      /* The page of a sandbox account asks for a seed (POST /admin/tasks/sandbox/ensure) when this is true. */
      stale: o.sandboxAccounts.length > 0 && sandboxStale(seed, o.sandboxResetHours, env.now),
    },
    adoption: adoption ? adoptionOf(adoption.value) : null,
    automation: { api_key_activity: automation.count, last_api_key_at: iso(automation.last) },
    references: o.references,
  }
}
