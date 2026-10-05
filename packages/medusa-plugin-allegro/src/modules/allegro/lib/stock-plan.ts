/**
 * THE STOCK PUSH PLAN. Pure arithmetic, zero imports.
 *
 * For every PRIMARY offer linked to a variant, compare the Allegro quantity
 * with what Medusa can sell and decide one action:
 *
 *   decrease  Allegro has more than Medusa: set it to the Medusa quantity
 *   end       Medusa has none left: Allegro cannot hold zero items (a FIXED
 *             quantity must be above zero), so the offer can only be ended
 *   increase  Allegro has fewer (mirror mode only, and only while the order
 *             import is armed and current, so an Allegro sale is in Medusa)
 *   none      nothing to do, with the reason
 *
 * WHAT IS NEVER DONE: an ended offer is never activated again, a draft is
 * never touched, an untracked variant or an offer without a quantity is
 * never guessed at, and a variant missing from the Medusa read is never
 * treated as zero.
 *
 * WHOLE-PLAN REFUSALS (nothing is applied, the reason is shown):
 *   the Medusa read was incomplete;
 *   Medusa reports zero for most linked variants (a wrong stockLocationIds
 *   or an empty location looks exactly like that, a real sell-out does not);
 *   the plan would end a large share of live offers.
 */

export type StockAction = "decrease" | "increase" | "end" | "none"

export type StockReason =
  | "oversell"
  | "sold_out"
  | "under_listed"
  | "in_sync"
  | "untracked"
  | "allegro_unknown"
  | "ended"
  | "draft"
  | "no_variant"
  | "zero_not_settable"
  | "raise_blocked"
  | "decrease_only"

export type PlanStatus = "planned" | "skipped" | "in_sync" | "quarantined" | "deferred"

export interface StockPlanOffer {
  allegroId: string
  name: string
  status: string
  available: number | null
  variantId: string | null
  sku: string | null
  productId: string | null
  productTitle: string | null
  isPrimary: boolean
}

export interface StockPlanEntry {
  allegroId: string
  name: string
  variantId: string | null
  sku: string | null
  productId: string | null
  productTitle: string | null
  allegro: number | null
  medusa: number | null
  action: StockAction
  target: number | null
  reason: StockReason
  status: PlanStatus
}

export interface StockPlanResult {
  entries: StockPlanEntry[]
  refused: string | null
  counts: { decrease: number; increase: number; end: number; skipped: number; inSync: number; quarantined: number; deferred: number }
}

export interface StockPlanInput {
  mode: "decrease" | "mirror"
  endAtZero: boolean
  offers: readonly StockPlanOffer[]
  /** Variant id to Medusa available quantity; null means the variant does not track inventory. */
  medusa: ReadonlyMap<string, number | null>
  medusaComplete: boolean
  /** Mirror mode guard: raising is safe only while Allegro sales reach Medusa. */
  raise: { allowed: boolean; reason: string | null }
  cap: number
  quarantined: ReadonlySet<string>
}

/** Mass-zero guard: at least this many tracked variants, and this share at zero. */
export const MASS_ZERO_MIN = 5
export const MASS_ZERO_SHARE = 0.8
/** Mass-end guard: more ends than this share of live linked offers (and more than the floor). */
export const MASS_END_SHARE = 0.25
export const MASS_END_FLOOR = 3

function live(status: string): boolean {
  const s = status.toUpperCase()
  return s === "ACTIVE" || s === "ACTIVATING"
}

function entryOf(o: StockPlanOffer, medusa: number | null, action: StockAction, target: number | null, reason: StockReason, status: PlanStatus): StockPlanEntry {
  return {
    allegroId: o.allegroId,
    name: o.name,
    variantId: o.variantId,
    sku: o.sku,
    productId: o.productId,
    productTitle: o.productTitle,
    allegro: o.available,
    medusa,
    action,
    target,
    reason,
    status,
  }
}

/** Order of urgency: ends, then the biggest oversell, then raises. */
function urgency(e: StockPlanEntry): number {
  if (e.action === "end") return 0
  if (e.action === "decrease") return 1
  return 2
}

export function planStock(input: StockPlanInput): StockPlanResult {
  const counts = { decrease: 0, increase: 0, end: 0, skipped: 0, inSync: 0, quarantined: 0, deferred: 0 }
  if (!input.medusaComplete) {
    return { entries: [], refused: "The Medusa stock read was incomplete, so nothing is planned. Items missing from a read are never set to zero.", counts }
  }

  const entries: StockPlanEntry[] = []
  const linked = input.offers.filter((o) => o.isPrimary && o.variantId)

  /* Mass-zero guard, before anything else. */
  const tracked = linked.filter((o) => live(o.status) && input.medusa.has(o.variantId as string) && input.medusa.get(o.variantId as string) !== null)
  const zeros = tracked.filter((o) => (input.medusa.get(o.variantId as string) ?? 0) <= 0)
  if (tracked.length >= MASS_ZERO_MIN && zeros.length / tracked.length >= MASS_ZERO_SHARE) {
    return {
      entries: [],
      refused: `Medusa reports 0 available for ${zeros.length} of ${tracked.length} live linked variants. That looks like a wrong stockLocationIds or an empty stock location, not a sell-out, so nothing is planned.`,
      counts,
    }
  }

  for (const o of linked) {
    const status = o.status.toUpperCase()
    const variantId = o.variantId as string
    const read = input.medusa.has(variantId)
    const medusaRaw = read ? (input.medusa.get(variantId) ?? null) : null
    const medusa = medusaRaw === null ? null : Math.max(0, Math.floor(medusaRaw))

    if (status === "INACTIVE") {
      entries.push(entryOf(o, medusa, "none", null, "draft", "skipped"))
      continue
    }
    if (status === "ENDED") {
      entries.push(entryOf(o, medusa, "none", null, "ended", "skipped"))
      continue
    }
    if (!read) {
      entries.push(entryOf(o, null, "none", null, "no_variant", "skipped"))
      continue
    }
    if (medusa === null) {
      entries.push(entryOf(o, null, "none", null, "untracked", "skipped"))
      continue
    }
    if (o.available === null) {
      entries.push(entryOf(o, medusa, "none", null, "allegro_unknown", "skipped"))
      continue
    }
    const allegro = Math.max(0, Math.floor(o.available))
    if (allegro === medusa) {
      entries.push(entryOf(o, medusa, "none", null, "in_sync", "in_sync"))
      continue
    }
    if (allegro > medusa) {
      if (medusa === 0) {
        if (!input.endAtZero) entries.push(entryOf(o, medusa, "none", null, "zero_not_settable", "skipped"))
        else entries.push(entryOf(o, medusa, "end", 0, "sold_out", "planned"))
      } else {
        entries.push(entryOf(o, medusa, "decrease", medusa, "oversell", "planned"))
      }
      continue
    }
    /* Allegro has fewer than Medusa. */
    if (input.mode === "decrease") {
      entries.push(entryOf(o, medusa, "none", null, "decrease_only", "skipped"))
    } else if (!input.raise.allowed) {
      entries.push(entryOf(o, medusa, "none", null, "raise_blocked", "skipped"))
    } else {
      entries.push(entryOf(o, medusa, "increase", medusa, "under_listed", "planned"))
    }
  }

  /* Mass-end guard. */
  const liveLinked = linked.filter((o) => live(o.status)).length
  const ends = entries.filter((e) => e.action === "end").length
  if (ends > MASS_END_FLOOR && ends > liveLinked * MASS_END_SHARE) {
    return {
      entries: [],
      refused: `The plan would end ${ends} of ${liveLinked} live offers. That looks like a broken stock read, not a sell-out, so nothing is applied. Check the Medusa stock, then run the plan again.`,
      counts,
    }
  }

  /* Quarantine, then the cap, most urgent first. */
  const actionable = entries
    .filter((e) => e.status === "planned")
    .sort((a, b) => urgency(a) - urgency(b) || ((b.allegro ?? 0) - (b.target ?? 0)) - ((a.allegro ?? 0) - (a.target ?? 0)) || (a.allegroId < b.allegroId ? -1 : 1))
  let budget = Math.max(0, Math.floor(input.cap))
  for (const e of actionable) {
    if (input.quarantined.has(e.allegroId)) {
      e.status = "quarantined"
      continue
    }
    if (budget > 0) budget -= 1
    else e.status = "deferred"
  }

  for (const e of entries) {
    if (e.status === "in_sync") counts.inSync += 1
    else if (e.status === "skipped") counts.skipped += 1
    else if (e.status === "quarantined") counts.quarantined += 1
    else if (e.status === "deferred") counts.deferred += 1
    else if (e.action === "decrease") counts.decrease += 1
    else if (e.action === "increase") counts.increase += 1
    else if (e.action === "end") counts.end += 1
  }
  return { entries, refused: null, counts }
}

/**
 * Right before the command: the planned change against the offer as Allegro
 * shows it NOW. A decrease never becomes a raise, an offer that ended or
 * went to a draft in the meantime is left alone, a quantity that already
 * matches needs nothing.
 */
export function recheck(
  entry: Pick<StockPlanEntry, "action" | "target">,
  fresh: { status: string; available: number | null } | null,
): { ok: true } | { ok: false; reason: "gone" | "not_live" | "changed" | "already_done" } {
  if (!fresh) return { ok: false, reason: "gone" }
  if (!live(fresh.status)) return { ok: false, reason: entry.action === "end" && fresh.status.toUpperCase() === "ENDED" ? "already_done" : "not_live" }
  if (fresh.available === null) return { ok: false, reason: "changed" }
  const now = Math.max(0, Math.floor(fresh.available))
  if (entry.action === "end") return now > 0 ? { ok: true } : { ok: false, reason: "already_done" }
  const target = entry.target ?? 0
  if (now === target) return { ok: false, reason: "already_done" }
  if (entry.action === "decrease") return now > target ? { ok: true } : { ok: false, reason: "changed" }
  if (entry.action === "increase") return now < target ? { ok: true } : { ok: false, reason: "changed" }
  return { ok: false, reason: "changed" }
}

/** Raising is safe only while every Allegro sale reaches Medusa quickly. */
export function raiseGuard(args: {
  importArmed: boolean
  lastImportOkAt: Date | null
  heldImports: number
  now: Date
  maxAgeMs?: number
}): { allowed: boolean; reason: string | null } {
  const maxAge = args.maxAgeMs ?? 15 * 60 * 1000
  if (!args.importArmed) return { allowed: false, reason: "The order import is not armed, so a sale on Allegro may not be in Medusa yet." }
  if (!args.lastImportOkAt || args.now.getTime() - args.lastImportOkAt.getTime() > maxAge) {
    return { allowed: false, reason: "The last successful order import is older than 15 minutes." }
  }
  if (args.heldImports > 0) return { allowed: false, reason: `${args.heldImports} Allegro order(s) are held and not in Medusa yet.` }
  return { allowed: true, reason: null }
}
