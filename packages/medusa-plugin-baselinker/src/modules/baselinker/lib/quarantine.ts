/**
 * PER-ITEM QUARANTINE. Pure, zero imports.
 *
 * One bad card (a SKU BaseLinker refuses, a product Medusa cannot save) must
 * not block a whole writer, and must not be retried forever either: every
 * run would spend requests on it and bury the history in the same error.
 * So failures are counted per item across runs; at the threshold the item
 * is quarantined, the plans keep showing it, and no writer touches it until
 * a person releases it. A success resets the count.
 */

export interface QuarantineState {
  failures: number
  quarantinedAt: Date | string | null
}

export function isQuarantined(state: QuarantineState | null | undefined): boolean {
  return Boolean(state && state.quarantinedAt)
}

/** The state after one more failure. */
export function afterFailure(prev: QuarantineState | null | undefined, threshold: number, now: Date): { failures: number; quarantinedAt: Date | null } {
  const failures = (prev?.failures ?? 0) + 1
  const already = prev?.quarantinedAt ? new Date(prev.quarantinedAt) : null
  if (already && Number.isFinite(already.getTime())) return { failures, quarantinedAt: already }
  return { failures, quarantinedAt: failures >= Math.max(1, threshold) ? now : null }
}

/** The state after a success, or null when there is nothing to reset. */
export function afterSuccess(prev: QuarantineState | null | undefined): { failures: number; quarantinedAt: null } | null {
  if (!prev || (prev.failures === 0 && !prev.quarantinedAt)) return null
  return { failures: 0, quarantinedAt: null }
}

/**
 * Splits the items a writer would apply into the ones it applies now and the
 * ones that wait: quarantined first, then the cap. The order of `items` is
 * the priority (the planners put the most important changes first).
 */
export function selectForApply<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  quarantined: ReadonlySet<string>,
  cap: number,
): { apply: T[]; overCap: T[]; quarantined: T[] } {
  const apply: T[] = []
  const overCap: T[] = []
  const held: T[] = []
  const limit = Math.max(0, Math.floor(cap))
  for (const item of items) {
    if (quarantined.has(keyOf(item))) held.push(item)
    else if (apply.length < limit) apply.push(item)
    else overCap.push(item)
  }
  return { apply, overCap, quarantined: held }
}
