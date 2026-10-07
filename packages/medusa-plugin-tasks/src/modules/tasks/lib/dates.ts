/**
 * Due dates. Pure, zero imports apart from the status helpers.
 *
 * A due date is a calendar day. It is stored as that day at 12:00 UTC, so it
 * reads as the same day in every time zone from UTC-11 to UTC+11 (the KODA
 * Panel module did the same for its roadmap). A full ISO timestamp is kept as
 * it is; its day is the UTC day.
 */

import { isOpenStatus } from "./status"

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MIN_YEAR = 2000
const MAX_YEAR = 2100

/** True for a real calendar day written as YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string") return false
  const m = DAY.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < MIN_YEAR || y > MAX_YEAR) return false
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

export type DueParse = { ok: true; value: Date | null } | { ok: false }

/** A due date from a request: YYYY-MM-DD, an ISO timestamp, or null / "" to clear it. */
export function parseDueDate(value: unknown): DueParse {
  if (value === null || value === "") return { ok: true, value: null }
  if (typeof value !== "string") return { ok: false }
  const s = value.trim()
  if (isDay(s)) return { ok: true, value: new Date(`${s}T12:00:00.000Z`) }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return { ok: false }
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return { ok: false }
  const y = d.getUTCFullYear()
  return y >= MIN_YEAR && y <= MAX_YEAR ? { ok: true, value: d } : { ok: false }
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d : null
}

/** The UTC calendar day of a date, YYYY-MM-DD, or null. */
export function utcDay(value: Date | string | null | undefined): string | null {
  const d = asDate(value)
  return d ? d.toISOString().slice(0, 10) : null
}

/** An open task whose due day is before `today` (YYYY-MM-DD). */
export function isOverdue(task: { status: unknown; due_date: Date | string | null | undefined }, today: string): boolean {
  if (!isOpenStatus(task.status)) return false
  const day = utcDay(task.due_date)
  return day !== null && day < today
}

/** The day a request names (`today=YYYY-MM-DD`, the admin's own calendar), or the UTC day of `now`. */
export function todayOf(value: unknown, now: Date): string {
  return isDay(value) ? value : (utcDay(now) as string)
}
