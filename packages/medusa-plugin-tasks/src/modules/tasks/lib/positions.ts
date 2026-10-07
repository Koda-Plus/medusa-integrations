/**
 * The order of cards within a column. Pure, zero imports.
 *
 * Every task has an integer `position` within its column (status) on its
 * board. A column reads by position, then by creation time, then by id, so
 * old rows that all share position 0 still have a stable order.
 *
 * A move names the card's new neighbours instead of an index: the person
 * dragging may see a filtered column, and "after this card" means the same
 * thing in the filtered and the full column. After a move the column is
 * numbered 0, 1, 2... again and only rows whose number changed are written.
 */

export interface Ordered {
  id: string
  position: number
  created_at: Date | string
}

function time(v: Date | string): number {
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

/** The order of a column: position, creation time, id. */
export function compareColumn(a: Ordered, b: Ordered): number {
  return (Number(a.position) || 0) - (Number(b.position) || 0) || time(a.created_at) - time(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function sortColumn<T extends Ordered>(rows: readonly T[]): T[] {
  return [...rows].sort(compareColumn)
}

export interface MoveTarget {
  /** Place the card right after this one (wins when both are given and found). */
  afterId?: string | null
  /** Place the card right before this one. */
  beforeId?: string | null
}

/**
 * The column's ids after placing `movingId`: after `afterId`, else before
 * `beforeId`, else at the end. Neighbours that are not in the column (moved
 * or deleted meanwhile, or the moving card itself) are ignored.
 */
export function planMove(column: readonly string[], movingId: string, target: MoveTarget = {}): string[] {
  const rest = column.filter((id) => id !== movingId)
  const after = target.afterId && target.afterId !== movingId ? rest.indexOf(target.afterId) : -1
  if (after >= 0) {
    rest.splice(after + 1, 0, movingId)
    return rest
  }
  const before = target.beforeId && target.beforeId !== movingId ? rest.indexOf(target.beforeId) : -1
  if (before >= 0) {
    rest.splice(before, 0, movingId)
    return rest
  }
  rest.push(movingId)
  return rest
}

/** Rows whose position must change so that `order` reads 0, 1, 2... */
export function positionChanges(current: ReadonlyArray<{ id: string; position: number }>, order: readonly string[]): Array<{ id: string; position: number }> {
  const now = new Map(current.map((r) => [r.id, Number(r.position)]))
  const out: Array<{ id: string; position: number }> = []
  order.forEach((id, index) => {
    if (now.get(id) !== index) out.push({ id, position: index })
  })
  return out
}

/** The position of a card added at the end of a column. */
export function nextPosition(positions: readonly number[]): number {
  let max = -1
  for (const p of positions) if (Number.isFinite(p) && p > max) max = p
  return max + 1
}
