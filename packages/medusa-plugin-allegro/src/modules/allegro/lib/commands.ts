/**
 * BATCH COMMANDS: quantity, price and publication changes go to Allegro as
 * commands with our own UUID, one modification for up to 1 000 offers.
 * Zero imports.
 *
 *   PUT /sale/offer-quantity-change-commands/{id}   {"modification": {"changeType": "FIXED", "value": n}, "offerCriteria": [...]}
 *   PUT /sale/offer-price-change-commands/{id}      {"modification": {"type": "FIXED_PRICE", "price": {...}}, "offerCriteria": [...]}
 *   PUT /sale/offer-publication-commands/{id}       {"publication": {"action": "END"}, "offerCriteria": [...]}
 *
 * The report (`GET .../{id}`) says how many tasks succeeded and failed, the
 * tasks (`GET .../{id}/tasks`) say which offer and why. A task still `NEW`
 * after our wait is neither a success nor a failure: the item stays planned
 * and the next run re-reads the offer before doing anything.
 */

export interface CommandGroup<K extends string> {
  /** What every offer in the group gets: a quantity, a price, or "end". */
  key: K
  offerIds: string[]
}

/** Offers grouped by the value they get, at most `max` offers per command. */
export function groupForCommands<K extends string>(items: ReadonlyArray<{ offerId: string; key: K }>, max = 1000): CommandGroup<K>[] {
  const byKey = new Map<K, string[]>()
  for (const item of items) {
    const list = byKey.get(item.key) ?? []
    if (!list.includes(item.offerId)) list.push(item.offerId)
    byKey.set(item.key, list)
  }
  const out: CommandGroup<K>[] = []
  for (const [key, ids] of byKey) {
    for (let i = 0; i < ids.length; i += max) out.push({ key, offerIds: ids.slice(i, i + max) })
  }
  return out
}

function criteria(offerIds: readonly string[]) {
  return [{ type: "CONTAINS_OFFERS", offers: offerIds.map((id) => ({ id })) }]
}

export function quantityCommandBody(value: number, offerIds: readonly string[]) {
  return { modification: { changeType: "FIXED", value }, offerCriteria: criteria(offerIds) }
}

export function endCommandBody(offerIds: readonly string[]) {
  return { publication: { action: "END" }, offerCriteria: criteria(offerIds) }
}

export function priceCommandBody(amount: string, currency: string, offerIds: readonly string[]) {
  return { modification: { type: "FIXED_PRICE", price: { amount, currency } }, offerCriteria: criteria(offerIds) }
}

export interface CommandReport {
  done: boolean
  total: number
  success: number
  failed: number
}

/** `GeneralReport`: `completedAt` set, or every task counted (completedAt can lag the counts). */
export function parseReport(raw: unknown): CommandReport {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const count = (r.taskCount && typeof r.taskCount === "object" ? r.taskCount : {}) as Record<string, unknown>
  const total = Number(count.total) || 0
  const success = Number(count.success) || 0
  const failed = Number(count.failed) || 0
  const done = Boolean(r.completedAt) || (total > 0 && success + failed >= total)
  return { done, total, success, failed }
}

export type TaskStatus = "SUCCESS" | "FAIL" | "NEW"

export interface TaskResult {
  offerId: string
  status: TaskStatus
  message: string | null
}

/** `TaskReport.tasks[]`: offer, status, message and the first error. */
export function parseTasks(raw: unknown): TaskResult[] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const out: TaskResult[] = []
  for (const t of Array.isArray(r.tasks) ? r.tasks : []) {
    const task = (t && typeof t === "object" ? t : {}) as Record<string, unknown>
    const offer = (task.offer && typeof task.offer === "object" ? task.offer : {}) as Record<string, unknown>
    const offerId = offer.id === undefined || offer.id === null ? "" : String(offer.id)
    if (!offerId) continue
    const raw = String(task.status ?? "NEW").toUpperCase()
    const status: TaskStatus = raw === "SUCCESS" ? "SUCCESS" : raw === "FAIL" ? "FAIL" : "NEW"
    const errors = Array.isArray(task.errors) ? task.errors : []
    const first = (errors[0] && typeof errors[0] === "object" ? errors[0] : {}) as Record<string, unknown>
    const detail = [first.userMessage, first.message].find((x) => typeof x === "string" && x.trim()) as string | undefined
    const message = typeof task.message === "string" && task.message.trim() ? task.message.trim() : null
    out.push({ offerId, status, message: [message, detail].filter(Boolean).join(": ") || null })
  }
  return out
}

/**
 * The outcome of a command for the circuit breaker: SYSTEMIC when every
 * task failed (one bad offer is an item problem, a hundred are not), item
 * failures otherwise.
 */
export function commandVerdict(tasks: readonly TaskResult[]): "ok" | "partial" | "all_failed" | "pending" {
  if (tasks.length === 0) return "pending"
  const failed = tasks.filter((t) => t.status === "FAIL").length
  const pending = tasks.filter((t) => t.status === "NEW").length
  if (failed === tasks.length) return "all_failed"
  if (failed > 0) return "partial"
  if (pending > 0) return "pending"
  return "ok"
}
