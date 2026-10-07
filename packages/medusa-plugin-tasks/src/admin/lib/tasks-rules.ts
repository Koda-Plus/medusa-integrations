import { planMove } from "../../modules/tasks/lib/positions"
import type { BoardResponse, TaskDto } from "../../modules/tasks/lib/contract"

/*
 * Pure rules of the admin (no React, no fetch), tested with `node --test`:
 * the board after a move, the due date the drawer sends, the photos it shows.
 */

export interface MoveArgs {
  id: string
  status: TaskDto["status"]
  before_id: string | null
  after_id: string | null
}

const CLOSED = new Set<string>(["done", "rejected"])

/** The board after a move, the way the server will order it: the card placed, both columns numbered again. */
export function moveOnBoard(board: BoardResponse, m: MoveArgs): BoardResponse {
  const moving = board.tasks.find((t) => t.id === m.id)
  if (!moving) return board
  const from = moving.status
  const column = (status: string) =>
    board.tasks
      .filter((t) => t.status === status && t.id !== m.id)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((t) => t.id)
  /* Closed columns are ordered by when tasks closed: nothing to number there. */
  const dest = CLOSED.has(m.status) ? [] : planMove(column(m.status), m.id, { afterId: m.after_id, beforeId: m.before_id })
  const left = from === m.status || CLOSED.has(from) ? [] : column(from)
  const position = new Map<string, number>()
  dest.forEach((id, i) => position.set(id, i))
  left.forEach((id, i) => position.set(id, i))
  const tasks = board.tasks.map((t) => {
    const p = position.get(t.id)
    if (t.id === m.id) {
      const completed = CLOSED.has(m.status) ? (CLOSED.has(from) ? t.completed_at : new Date().toISOString()) : null
      return { ...t, status: m.status, position: p ?? 0, completed_at: completed, updated_at: new Date().toISOString() }
    }
    return p === undefined ? t : { ...t, position: p }
  })
  return { ...board, tasks }
}


/** A whole date with a year the server takes (2000 to 2100). Typing a year passes through 0002, 0020 and 0202. */
export function completeDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= 2000 && year <= 2100
}

/** A photo the admin shows: https or an image data URI, nothing else (an avatar_url is any text an admin typed). */
export function safeAvatarUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null
  const u = url.trim()
  if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return u
  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(u)) return u
  return null
}
