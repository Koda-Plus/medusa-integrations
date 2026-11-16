/**
 * THE WRITERS OF KUP TERAZ. Pure decisions, zero imports.
 *
 * Every write the plugin makes after reading belongs to one writer:
 *
 *   orders  Kup Teraz orders become Medusa orders (writes Medusa, not Ceneo)
 *   status  Ceneo learns what the store did: the shop order number and the
 *           confirmation after the import, the parcel number and "sent"
 *           after a shipment, the cancellation after a cancelled order
 *   bids    CPC bids, one planned step per run towards a person's target
 *   promo   promotion texts per product and per category
 *
 * Every writer has TWO SWITCHES, both off by default:
 *
 *   1. the hard switch, `writes.<writer>` in the plugin options. Off wins and
 *      nothing in the admin can override it;
 *   2. the runtime toggle, a `ceneo_writer` row a person flips in the admin,
 *      with who and when. A toggle flipped in demo mode does not arm a real
 *      account later (`mode`).
 *
 * The CIRCUIT BREAKER turns the toggle off by itself after
 * WRITER_BREAKER_THRESHOLD systemic failures in a row and says why.
 */

export const WRITER_KEYS = ["orders", "status", "bids", "promo"] as const
export type WriterKey = (typeof WRITER_KEYS)[number]

export function isWriterKey(value: unknown): value is WriterKey {
  return typeof value === "string" && (WRITER_KEYS as readonly string[]).includes(value)
}

export const WRITER_BREAKER_THRESHOLD = 5
export const BREAKER_ACTOR = "circuit breaker"

/** `ceneo_writer` row as the generated service returns it (`id` is the writer key). */
export interface WriterRow {
  id: string
  armed: boolean
  mode: string | null
  changed_by: string | null
  changed_by_id: string | null
  changed_at: Date | string | null
  failure_streak: number
  last_failure: string | null
  last_failure_at: Date | string | null
  tripped_at: Date | string | null
  trip_reason: string | null
  last_success_at: Date | string | null
}

export type WriterBlocker =
  /** `writes.<writer>` is not true in the plugin options. */
  | "hard_switch"
  /** Live mode without the API key. */
  | "missing_key"
  /** The order import, live, without `orders.importStates`: which Ceneo states mean "ready to ship" is the store's call. */
  | "no_import_states"
  /** The bids writer, live, without `cpc.maxBid`: no bid is ever sent without a ceiling. */
  | "no_max_bid"

export interface WriterState {
  key: WriterKey
  allowed: boolean
  requested: boolean
  effective: boolean
  blockers: WriterBlocker[]
  modeChanged: boolean
}

export function writerState(args: {
  key: WriterKey
  allowed: boolean
  row: Pick<WriterRow, "armed" | "mode"> | null
  mode: "demo" | "live"
  hasKey: boolean
  importStates: readonly number[]
  maxBid?: number | null
}): WriterState {
  const blockers: WriterBlocker[] = []
  if (!args.allowed) blockers.push("hard_switch")
  if (args.mode === "live" && !args.hasKey) blockers.push("missing_key")
  if (args.key === "orders" && args.importStates.length === 0) blockers.push("no_import_states")
  if (args.key === "bids" && (args.maxBid === null || args.maxBid === undefined)) blockers.push("no_max_bid")
  const armed = Boolean(args.row?.armed)
  const requested = armed && args.row?.mode === args.mode
  return { key: args.key, allowed: args.allowed, requested, effective: requested && blockers.length === 0, blockers, modeChanged: armed && args.row?.mode !== args.mode }
}

/** Why a person cannot arm the writer now, or null. Disarming is always allowed. */
export function armRefusal(state: WriterState): string | null {
  if (state.blockers.includes("hard_switch")) return `The ${state.key} writer is off in the plugin options (writes.${state.key} is not true). Only the configuration can allow it.`
  if (state.blockers.includes("missing_key")) return "Set the Ceneo API key (apiKey) first."
  if (state.blockers.includes("no_import_states")) return "Set orders.importStates: the Ceneo state ids of orders ready to ship."
  if (state.blockers.includes("no_max_bid")) return "Set cpc.maxBid: the highest bid the plugin may ever send, in PLN."
  return null
}

/**
 * What one write ended with:
 *   ok        accepted
 *   item      failed for reasons of that one order (a parcel number Ceneo refuses): counted on the order, the writer runs on
 *   systemic  would fail the next one too (network, 5xx, 429, 401, 403, an answer we do not understand)
 */
export type WriteOutcome = { kind: "ok" } | { kind: "item"; message: string } | { kind: "systemic"; message: string }

export type WriterPatch = Partial<Pick<WriterRow, "armed" | "changed_by" | "changed_by_id" | "changed_at" | "failure_streak" | "last_failure" | "last_failure_at" | "tripped_at" | "trip_reason" | "last_success_at">>

export function afterOutcome(row: Pick<WriterRow, "failure_streak" | "armed">, outcome: WriteOutcome, now: Date, threshold = WRITER_BREAKER_THRESHOLD): { patch: WriterPatch; tripped: boolean } {
  if (outcome.kind === "ok") return { patch: { failure_streak: 0, last_success_at: now }, tripped: false }
  const message = outcome.message.slice(0, 500)
  if (outcome.kind === "item") return { patch: { last_failure: message, last_failure_at: now }, tripped: false }
  const streak = (Number(row.failure_streak) || 0) + 1
  if (streak >= Math.max(1, threshold) && row.armed) {
    return {
      patch: {
        armed: false,
        failure_streak: streak,
        last_failure: message,
        last_failure_at: now,
        tripped_at: now,
        trip_reason: `Disarmed by the circuit breaker after ${streak} failures in a row. Last error: ${message}`.slice(0, 1000),
        changed_by: BREAKER_ACTOR,
        changed_by_id: null,
        changed_at: now,
      },
      tripped: true,
    }
  }
  return { patch: { failure_streak: streak, last_failure: message, last_failure_at: now }, tripped: false }
}

/** A Ceneo error as an outcome: 4xx other than 401, 403 and 429 belong to the order, the rest to the writer. */
export function outcomeOfStatus(status: number | null, message: string): WriteOutcome {
  if (status !== null && status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429) return { kind: "item", message }
  return { kind: "systemic", message }
}

/** What arming or disarming writes on the row. */
export function togglePatch(armed: boolean, mode: "demo" | "live", actor: { name: string | null; id: string | null }, now: Date): Record<string, unknown> {
  return {
    armed,
    mode,
    changed_by: actor.name ?? actor.id ?? "admin",
    changed_by_id: actor.id,
    changed_at: now,
    ...(armed ? { failure_streak: 0, tripped_at: null, trip_reason: null } : {}),
  }
}
