/**
 * Rows of the five tables as the database returns them. Types only.
 *
 * Dates come back as `Date` from Postgres and as ISO strings from JSON test
 * doubles; every reader accepts both. JSON columns come back parsed.
 */

export type Stamp = Date | string

export interface TaskRow {
  id: string
  board: string
  title: string
  description: string | null
  status: string
  priority: string
  /** The name shown for the assignee: the admin user's name when `assignee_id` is set, free text otherwise (old rows, scripts). */
  assignee: string | null
  /** The admin user the task is assigned to. */
  assignee_id: string | null
  due_date: Stamp | null
  tags: unknown
  position: number
  completed_at: Stamp | null
  created_by: string | null
  created_by_id: string | null
  metadata: Record<string, unknown> | null
  created_at: Stamp
  updated_at: Stamp
  deleted_at: Stamp | null
}

export interface CommentRow {
  id: string
  board: string
  task_id: string
  body: string
  author: string | null
  author_role: string
  author_id: string | null
  author_type: string | null
  metadata: Record<string, unknown> | null
  edited_at: Stamp | null
  created_at: Stamp
  updated_at: Stamp
  deleted_at: Stamp | null
}

export interface ActivityRow {
  id: string
  board: string
  task_id: string
  type: string
  message: string | null
  actor: string | null
  actor_id: string | null
  actor_type: string | null
  metadata: Record<string, unknown> | null
  created_at: Stamp
  updated_at: Stamp
  deleted_at: Stamp | null
}

export interface LinkRow {
  id: string
  board: string
  task_id: string
  entity_type: string
  entity_id: string
  created_by: string | null
  created_by_id: string | null
  created_at: Stamp
  updated_at: Stamp
  deleted_at: Stamp | null
}

export interface SettingRow {
  id: string
  key: string
  value: unknown
  updated_by: string | null
  created_at: Stamp
  updated_at: Stamp
  deleted_at: Stamp | null
}

/* ------------------------------------------------------------------ */
/* What the flows insert (the board comes from the board-bound store)  */
/* ------------------------------------------------------------------ */

export interface TaskInsert {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  assignee: string | null
  assignee_id: string | null
  due_date: Date | null
  tags: string[] | null
  completed_at: Date | null
  created_by: string | null
  created_by_id: string | null
  metadata: Record<string, unknown> | null
  created_at: Date
  /** Defaults to `created_at`. */
  updated_at?: Date
  /** Leave it out to append the task at the end of its column. */
  position?: number
}

export interface CommentInsert {
  id: string
  task_id: string
  body: string
  author: string | null
  author_role: string
  author_id: string | null
  author_type: string | null
  metadata: Record<string, unknown> | null
  created_at: Date
}

export interface ActivityInsert {
  id: string
  task_id: string
  type: string
  message: string | null
  actor: string | null
  actor_id: string | null
  actor_type: string | null
  metadata: Record<string, unknown> | null
  created_at: Date
}

export interface LinkInsert {
  id: string
  task_id: string
  entity_type: string
  entity_id: string
  created_by: string | null
  created_by_id: string | null
  created_at: Date
}
