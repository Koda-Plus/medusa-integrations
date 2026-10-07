/**
 * THE REQUEST BODIES, checked. Pure, tested with `node --test`.
 *
 * The admin page, scripts and AI agents send the same bodies. Every field is
 * optional unless named otherwise; unknown fields are ignored, wrong values
 * answer 400 with one error per field (`{ field, code, message }`), in
 * English like the rest of the API.
 *
 * The assignee comes in one of three ways, the first one present wins:
 *
 *   assignee_id     an admin user id, or null to unassign
 *   assignee_email  an admin user's e-mail (handy for scripts)
 *   assignee        free text such as "frontend", or null to unassign
 */

import {
  ASSIGNEE_MAX,
  COMMENT_MAX,
  DESCRIPTION_MAX,
  LINKS_PER_TASK_MAX,
  LINK_ID_PREFIX,
  TAGS_MAX,
  TAG_MAX,
  TITLE_MAX,
  isLinkType,
  isPriority,
  isStatus,
  type LinkType,
  type TaskPriority,
  type TaskStatus,
} from "./constants"
import { parseDueDate } from "./dates"
import { normalizeEmail } from "./options"
import { cleanDisplayName, cleanLine, cleanText, foldKey, isEntityId } from "./text"

export interface FieldError {
  field: string
  code: string
  message: string
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] }

export type AssigneeInput = { kind: "user"; id: string } | { kind: "email"; email: string } | { kind: "text"; name: string } | null

export interface LinkInput {
  type: LinkType
  id: string
}

export interface CreateInput {
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assignee: AssigneeInput
  due_date: Date | null
  tags: string[]
  links: LinkInput[]
  /** The name a script or AI agent signs with; ignored for people signed in to the admin. */
  author: string | null
}

export interface UpdateInput {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  /** Undefined: no change; null: unassign. */
  assignee?: AssigneeInput
  due_date?: Date | null
  tags?: string[]
  author: string | null
}

export interface MoveInput {
  status: TaskStatus
  before_id: string | null
  after_id: string | null
  author: string | null
}

export interface CommentInput {
  body: string
  author: string | null
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined

function objectOf(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

function err(field: string, code: string, message: string): FieldError {
  return { field, code, message }
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

function title(value: unknown, errors: FieldError[]): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    errors.push(err("title", "required", "A task needs a title."))
    return undefined
  }
  const raw = String(value).replace(/\s+/g, " ").trim()
  if (!raw) {
    errors.push(err("title", "required", "A task needs a title."))
    return undefined
  }
  if (raw.length > TITLE_MAX) {
    errors.push(err("title", "too_long", `The title has more than ${TITLE_MAX} characters.`))
    return undefined
  }
  return cleanLine(raw, TITLE_MAX)
}

function description(value: unknown, errors: FieldError[]): string | null | undefined {
  if (value === null) return null
  if (typeof value !== "string") {
    errors.push(err("description", "invalid", "The description must be text or null."))
    return undefined
  }
  if (value.trim().length > DESCRIPTION_MAX) {
    errors.push(err("description", "too_long", `The description has more than ${DESCRIPTION_MAX} characters.`))
    return undefined
  }
  const s = cleanText(value, DESCRIPTION_MAX)
  return s ? s : null
}

function status(value: unknown, errors: FieldError[], field = "status"): TaskStatus | undefined {
  if (isStatus(value)) return value
  errors.push(err(field, "invalid", "The status must be backlog, todo, in_progress, review, done or rejected."))
  return undefined
}

function priority(value: unknown, errors: FieldError[]): TaskPriority | undefined {
  if (isPriority(value)) return value
  errors.push(err("priority", "invalid", "The priority must be low, medium, high or urgent."))
  return undefined
}

function dueDate(value: unknown, errors: FieldError[]): Date | null | undefined {
  const parsed = parseDueDate(value)
  if (parsed.ok) return parsed.value
  errors.push(err("due_date", "invalid", "The due date must be a day (YYYY-MM-DD), an ISO 8601 date and time, or null."))
  return undefined
}

/** Tags from an array of strings or one comma separated string: cleaned, case-insensitively unique, in order. */
export function parseTags(value: unknown, errors: FieldError[]): string[] | undefined {
  if (value === null) return []
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null
  if (!raw || raw.some((t) => typeof t !== "string" && typeof t !== "number")) {
    errors.push(err("tags", "invalid", "Tags must be an array of strings or a comma separated string."))
    return undefined
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of raw) {
    const tag = cleanLine(String(t).replace(/,/g, " "), 1000)
    if (!tag) continue
    if (tag.length > TAG_MAX) {
      errors.push(err("tags", "too_long", `A tag has more than ${TAG_MAX} characters.`))
      return undefined
    }
    const key = foldKey(tag)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  if (out.length > TAGS_MAX) {
    errors.push(err("tags", "too_many", `A task takes at most ${TAGS_MAX} tags.`))
    return undefined
  }
  return out
}

/** The assignee of a body, by the rule at the top: undefined when the body names none. */
export function parseAssignee(body: Record<string, unknown>, errors: FieldError[]): AssigneeInput | undefined {
  if (has(body, "assignee_id")) {
    const v = body.assignee_id
    if (v === null || v === "") return null
    if (typeof v === "string" && isEntityId(v)) return { kind: "user", id: v }
    errors.push(err("assignee_id", "invalid", "assignee_id must be an admin user id or null."))
    return undefined
  }
  if (has(body, "assignee_email")) {
    const email = normalizeEmail(body.assignee_email)
    if (email) return { kind: "email", email }
    errors.push(err("assignee_email", "invalid", "assignee_email must be an e-mail address."))
    return undefined
  }
  if (has(body, "assignee")) {
    const v = body.assignee
    if (v === null || v === "") return null
    if (typeof v !== "string") {
      errors.push(err("assignee", "invalid", "assignee must be text or null."))
      return undefined
    }
    if (v.trim().length > ASSIGNEE_MAX) {
      errors.push(err("assignee", "too_long", `The assignee has more than ${ASSIGNEE_MAX} characters.`))
      return undefined
    }
    const name = cleanLine(v, ASSIGNEE_MAX)
    return name ? { kind: "text", name } : null
  }
  return undefined
}

/** One link: a type and the id of a Medusa record of that type (`order_`, `prod_`, `cus_`). */
export function parseLink(value: unknown, field = "link"): Parsed<LinkInput> {
  const v = objectOf(value)
  const type = v.type ?? v.entity_type
  const id = v.id ?? v.entity_id
  if (!isLinkType(type)) return { ok: false, errors: [err(`${field}.type`, "invalid", "The link type must be order, product or customer.")] }
  if (typeof id !== "string" || !isEntityId(id) || !id.startsWith(LINK_ID_PREFIX[type])) {
    return { ok: false, errors: [err(`${field}.id`, "invalid", `The id of a ${type} starts with ${LINK_ID_PREFIX[type]}.`)] }
  }
  return { ok: true, value: { type, id } }
}

function links(value: unknown, errors: FieldError[]): LinkInput[] | undefined {
  if (value === null) return []
  if (!Array.isArray(value)) {
    errors.push(err("links", "invalid", "links must be an array of { type, id }."))
    return undefined
  }
  if (value.length > LINKS_PER_TASK_MAX) {
    errors.push(err("links", "too_many", `A task takes at most ${LINKS_PER_TASK_MAX} links.`))
    return undefined
  }
  const out: LinkInput[] = []
  for (let i = 0; i < value.length; i += 1) {
    const parsed = parseLink(value[i], `links.${i}`)
    if (!parsed.ok) {
      errors.push(...parsed.errors)
      return undefined
    }
    if (!out.some((l) => l.type === parsed.value.type && l.id === parsed.value.id)) out.push(parsed.value)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Bodies                                                              */
/* ------------------------------------------------------------------ */

export function parseCreate(input: unknown): Parsed<CreateInput> {
  const body = objectOf(input)
  const errors: FieldError[] = []
  const t = title(body.title, errors)
  const d = has(body, "description") ? description(body.description, errors) : null
  const s = has(body, "status") ? status(body.status, errors) : "todo"
  const p = has(body, "priority") ? priority(body.priority, errors) : "medium"
  const a = parseAssignee(body, errors)
  const due = has(body, "due_date") ? dueDate(body.due_date, errors) : null
  const tags = has(body, "tags") ? parseTags(body.tags, errors) : []
  const l = has(body, "links") ? links(body.links, errors) : []
  if (errors.length > 0 || t === undefined || s === undefined || p === undefined) return { ok: false, errors }
  return {
    ok: true,
    value: {
      title: t,
      description: d ?? null,
      status: s,
      priority: p,
      assignee: a ?? null,
      due_date: due ?? null,
      tags: tags ?? [],
      links: l ?? [],
      author: cleanDisplayName(body.author),
    },
  }
}

const UPDATABLE = ["title", "description", "status", "priority", "assignee_id", "assignee_email", "assignee", "due_date", "tags"]

export function parseUpdate(input: unknown): Parsed<UpdateInput> {
  const body = objectOf(input)
  const errors: FieldError[] = []
  if (!UPDATABLE.some((k) => has(body, k))) {
    return { ok: false, errors: [err("body", "empty", `Nothing to change: send at least one of ${UPDATABLE.join(", ")}.`)] }
  }
  const out: UpdateInput = { author: cleanDisplayName(body.author) }
  if (has(body, "title")) out.title = title(body.title, errors)
  if (has(body, "description")) out.description = description(body.description, errors)
  if (has(body, "status")) out.status = status(body.status, errors)
  if (has(body, "priority")) out.priority = priority(body.priority, errors)
  const a = parseAssignee(body, errors)
  if (a !== undefined) out.assignee = a
  if (has(body, "due_date")) out.due_date = dueDate(body.due_date, errors)
  if (has(body, "tags")) out.tags = parseTags(body.tags, errors)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: out }
}

function neighbour(value: unknown, field: string, errors: FieldError[]): string | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "string" && isEntityId(value)) return value
  errors.push(err(field, "invalid", `${field} must be a task id or null.`))
  return null
}

export function parseMove(input: unknown): Parsed<MoveInput> {
  const body = objectOf(input)
  const errors: FieldError[] = []
  const s = status(body.status, errors)
  const before = neighbour(body.before_id, "before_id", errors)
  const after = neighbour(body.after_id, "after_id", errors)
  if (errors.length > 0 || s === undefined) return { ok: false, errors }
  return { ok: true, value: { status: s, before_id: before, after_id: after, author: cleanDisplayName(body.author) } }
}

export function parseComment(input: unknown): Parsed<CommentInput> {
  const body = objectOf(input)
  const raw = body.body ?? body.text ?? body.message
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, errors: [err("body", "required", "A comment needs a body.")] }
  if (raw.trim().length > COMMENT_MAX) return { ok: false, errors: [err("body", "too_long", `A comment has at most ${COMMENT_MAX} characters.`)] }
  const text = cleanText(raw, COMMENT_MAX)
  if (!text) return { ok: false, errors: [err("body", "required", "A comment needs a body.")] }
  return { ok: true, value: { body: text, author: cleanDisplayName(body.author) } }
}
