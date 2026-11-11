/**
 * WHEN THE FEED JOB BUILDS. Pure, zero imports.
 *
 * The job wakes every 5 minutes. It builds when no build exists, when the
 * interval has passed since the newest build (a failed one counts, so a
 * broken catalog is retried once per interval, not every 5 minutes), or
 * when the catalog changed after the newest build and that build is at
 * least 5 minutes old (the debounce: a batch of product edits gives one
 * build, not twenty).
 */

const MINUTE = 60_000
/** The job wakes every 5 minutes; a build due within the next tick is built now. */
const SLACK = MINUTE
export const CHANGE_DEBOUNCE_MS = 5 * MINUTE

export type FeedDue = { due: false } | { due: true; trigger: "first" | "schedule" | "change" }

export function feedDue(now: number, lastAt: number | null, intervalMinutes: number, changedAt: number | null): FeedDue {
  if (lastAt === null) return { due: true, trigger: "first" }
  const age = now - lastAt
  if (age >= intervalMinutes * MINUTE - SLACK) return { due: true, trigger: "schedule" }
  if (changedAt !== null && changedAt > lastAt && age >= CHANGE_DEBOUNCE_MS - SLACK) return { due: true, trigger: "change" }
  return { due: false }
}

type ChangeHolder = typeof globalThis & { [k: symbol]: number | undefined }
const CHANGED = Symbol.for("koda.ceneo.feed.changedAt")

/** The catalog changed (a product or variant event). In memory: a restart builds on the interval anyway. */
export function markCatalogChanged(at: number = Date.now()): void {
  ;(globalThis as ChangeHolder)[CHANGED] = at
}

export function catalogChangedAt(): number | null {
  return (globalThis as ChangeHolder)[CHANGED] ?? null
}
