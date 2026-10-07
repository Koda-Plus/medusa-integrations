/**
 * THE ADMIN API OF THE PLUGIN, AS DATA. Types only: the admin page, the
 * widgets, scripts and AI agents read these shapes. Field names are snake
 * case, like Medusa's own admin API and the request bodies.
 *
 * Add fields freely; never rename, remove or retype one.
 */

import type { ActorType, AuthorRole, Board, LinkType, TaskPriority, TaskStatus } from "./constants"
import type { TasksReference } from "./references"

export type { ActorType, AuthorRole, Board, LinkType, TaskPriority, TaskStatus }

/** The same text in both admin languages: sample tasks of the sandbox board carry it. */
export interface SampleText {
  en?: string
  pl?: string
}

export interface LinkDto {
  id: string
  type: LinkType
  entity_id: string
  /** "#1042" for an order, the product title, the customer's company, name or e-mail. Null when the record is gone. */
  label: string | null
  /** False when Medusa no longer has the record. */
  found: boolean
  created_by: string | null
  created_at: string
}

export interface TaskDto {
  id: string
  board: Board
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  /** The assignee's name: the admin user's, or free text (old rows, scripts). */
  assignee: string | null
  /** The admin user the task is assigned to, or null for free text and unassigned. */
  assignee_id: string | null
  /** ISO 8601; a plain due day is stored at 12:00 UTC. */
  due_date: string | null
  tags: string[]
  /** Order within the status column, from 0. */
  position: number
  /** When the task last landed in done or rejected; null while it is open. */
  completed_at: string | null
  created_by: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
  comment_count: number
  links: LinkDto[]
  /** Sample tasks: the title and description in both admin languages, until someone edits them. */
  sample: { title?: SampleText; description?: SampleText } | null
  /** Adopted from the KODA Panel module. */
  adopted: boolean
}

export interface CommentDto {
  id: string
  task_id: string
  body: string
  /** The display name: the admin user's name, or the name a script sent. Null shows as the role. */
  author: string | null
  author_id: string | null
  author_type: ActorType | null
  /** `agency`, `client` (the store team) or `claude` (a script or AI agent, shown as "AI agent"). */
  author_role: AuthorRole
  sample: SampleText | null
  edited_at: string | null
  created_at: string
  updated_at: string
  /** The person (or key) asking wrote it, so may edit and delete it. */
  own: boolean
}

export interface ActivityDto {
  id: string
  task_id: string
  /** The task's title, in the board-wide feed. */
  task_title: string | null
  type: string
  /** A short English line for scripts; the admin writes its own from `type` and `metadata`. */
  message: string | null
  actor: string | null
  actor_id: string | null
  actor_type: ActorType | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface TaskDetailDto extends TaskDto {
  comments: CommentDto[]
  activity: ActivityDto[]
}

export interface PersonDto {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  role: "agency" | "client"
}

/** A free text name with a face, from the `people` option: assignees and authors that match it (without case) show it. */
export interface NamedPersonDto {
  name: string
  /** A data URI or an https URL; null shows initials. */
  avatar: string | null
  role: SampleText | null
  /** `agent`: an AI agent or an automation. */
  kind: "person" | "agent"
}

export interface CountsDto {
  all: number
  backlog: number
  todo: number
  in_progress: number
  review: number
  done: number
  rejected: number
  open: number
  overdue: number
  urgent: number
  unassigned: number
}

export interface ViewerDto {
  type: "user" | "api-key"
  id: string
  name: string | null
  email: string | null
  role: AuthorRole
}

export interface AdoptionDto {
  /** `adopted`: the KODA Panel rows were copied; `skipped`: tables were found but not in the expected shape. */
  state: "adopted" | "skipped"
  at: string | null
  tasks: number
  comments: number
  activity: number
  reason: string | null
}

export interface SandboxDto {
  /** At least one sandbox account is configured. */
  enabled: boolean
  /** The sandbox board was last seeded. */
  seeded_at: string | null
  tasks: number
  reset_hours: number
  /** When the next opening seeds it again; null when it is only reset by hand. */
  next_reset_at: string | null
}

export interface StatusResponse {
  board: Board
  /** The person (or key) asking works on the sandbox board. */
  sandbox: boolean
  viewer: ViewerDto
  counts: CountsDto
  /** Admin users tasks can be assigned to on this board. */
  people: PersonDto[]
  /** The `people` option: free text names with a face, also offered in the assignee picker. Empty for sandbox accounts. */
  named_people: NamedPersonDto[]
  options: {
    /** The list for the team; null for sandbox accounts, which see only the count. */
    sandbox_accounts: string[] | null
    sandbox_account_count: number
    sandbox_reset_hours: number
    agency_accounts: string[] | null
    agency_account_count: number
  }
  sandbox_board: SandboxDto
  /** The KODA Panel adoption, for the team; null when there was none, and for sandbox accounts. */
  adoption: AdoptionDto | null
  /** Writes by secret API keys on this board. */
  automation: { api_key_activity: number; last_api_key_at: string | null }
  references: TasksReference[]
}

export interface ListResponse {
  tasks: TaskDto[]
  /** Tasks matching the filters (before `limit`). */
  count: number
  /** The whole board, for the counters. */
  counts: CountsDto
  limit: number
  offset: number
}

export interface BoardResponse {
  /** Every open task and the latest closed ones (`closed_limit` per closed column). */
  tasks: TaskDto[]
  counts: CountsDto
  /** Closed tasks left out of the answer. */
  hidden_closed: number
}

export interface TaskResponse {
  task: TaskDetailDto
}

export interface ActivityResponse {
  activity: ActivityDto[]
}

export interface EntityTasksResponse {
  board: Board
  sandbox: boolean
  tasks: TaskDto[]
  count: number
}
