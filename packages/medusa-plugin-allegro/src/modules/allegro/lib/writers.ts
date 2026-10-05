/**
 * THE WRITERS. Pure decisions, zero Medusa imports.
 *
 * Every write the plugin can make belongs to one writer, and every writer has
 * TWO SWITCHES:
 *
 *   1. the hard switch, `writes.<writer>` in the plugin options. `false` (the
 *      default in live mode) wins and nothing in the admin can override it;
 *   2. the runtime toggle, a row in `allegro_writer` a person flips in the
 *      admin. The row remembers who flipped it and when.
 *
 * A writer is EFFECTIVE only when both are on, the account is connected, the
 * stored token holds the scopes the writer needs and the toggle was flipped
 * in the current mode (a toggle armed in demo mode does not arm a real
 * account later). The CIRCUIT BREAKER turns the toggle off by itself after a
 * number of consecutive systemic failures and says why.
 */

import {
  DISPUTES_SCOPE,
  MESSAGING_SCOPE,
  OFFERS_SCOPE,
  OFFERS_WRITE_SCOPE,
  ORDERS_SCOPE,
  ORDERS_WRITE_SCOPE,
} from "./constants"

export const WRITER_KEYS = ["stock", "orders", "shipping", "invoices", "prices", "publish"] as const
export type WriterKey = (typeof WRITER_KEYS)[number]

export function isWriterKey(value: unknown): value is WriterKey {
  return typeof value === "string" && (WRITER_KEYS as readonly string[]).includes(value)
}

export interface WriterDefinition {
  key: WriterKey
  /** Scopes the stored token must hold before the writer can be armed. */
  scopes: readonly string[]
  /** False for the order import: it writes Medusa orders, not Allegro. */
  writesAllegro: boolean
}

export const WRITERS: Readonly<Record<WriterKey, WriterDefinition>> = {
  stock: { key: "stock", scopes: [OFFERS_SCOPE, OFFERS_WRITE_SCOPE], writesAllegro: true },
  orders: { key: "orders", scopes: [ORDERS_SCOPE], writesAllegro: false },
  shipping: { key: "shipping", scopes: [ORDERS_SCOPE, ORDERS_WRITE_SCOPE], writesAllegro: true },
  invoices: { key: "invoices", scopes: [ORDERS_SCOPE, ORDERS_WRITE_SCOPE], writesAllegro: true },
  prices: { key: "prices", scopes: [OFFERS_SCOPE, OFFERS_WRITE_SCOPE], writesAllegro: true },
  publish: { key: "publish", scopes: [OFFERS_SCOPE, OFFERS_WRITE_SCOPE], writesAllegro: true },
}

/** `allegro_writer` row as the generated service returns it. */
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
  last_run_at: Date | string | null
  last_success_at: Date | string | null
}

export type WriterBlocker =
  /** `writes.<writer>` is not true in the plugin options. */
  | "hard_switch"
  /** Live mode without the client id, secret or key. */
  | "not_configured"
  /** Live mode without a connected account. */
  | "not_connected"
  /** The stored token lacks a scope this writer needs: connect the account again. */
  | "missing_scope"

export interface WriterState {
  key: WriterKey
  /** The hard switch from the options. */
  allowed: boolean
  /** The toggle as a person left it, in the current mode. */
  requested: boolean
  /** Both switches on and nothing blocking: the writer may write now. */
  effective: boolean
  blockers: WriterBlocker[]
  missingScopes: string[]
  /** The toggle was flipped in the other mode (demo or live), so it counts as off. */
  modeChanged: boolean
}

/** Scopes a stored token holds, from the `scope` field of the token answer. */
export function grantedScopes(scope: string | null | undefined): string[] {
  return String(scope ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function missingScopes(needed: readonly string[], granted: readonly string[]): string[] {
  const have = new Set(granted)
  return needed.filter((s) => !have.has(s))
}

export function writerState(args: {
  key: WriterKey
  allowed: boolean
  row: Pick<WriterRow, "armed" | "mode"> | null
  mode: "demo" | "live"
  configured: boolean
  connected: boolean
  scope: string | null
}): WriterState {
  const def = WRITERS[args.key]
  const blockers: WriterBlocker[] = []
  let missing: string[] = []
  if (!args.allowed) blockers.push("hard_switch")
  if (args.mode === "live") {
    if (!args.configured) blockers.push("not_configured")
    else if (!args.connected) blockers.push("not_connected")
    else {
      missing = missingScopes(def.scopes, grantedScopes(args.scope))
      if (missing.length > 0) blockers.push("missing_scope")
    }
  }
  const modeChanged = Boolean(args.row?.armed) && args.row?.mode !== args.mode
  const requested = Boolean(args.row?.armed) && args.row?.mode === args.mode
  return {
    key: args.key,
    allowed: args.allowed,
    requested,
    effective: requested && blockers.length === 0,
    blockers,
    missingScopes: missing,
    modeChanged,
  }
}

/** Why a person cannot arm the writer right now, or null when they can. */
export function armRefusal(state: WriterState): string | null {
  if (state.blockers.includes("hard_switch")) {
    return `The ${state.key} writer is off in the plugin options (writes.${state.key} is not true). Only the configuration can allow it.`
  }
  if (state.blockers.includes("not_configured")) return "The plugin is not configured: set clientId, clientSecret and encryptionKey."
  if (state.blockers.includes("not_connected")) return "Connect the Allegro account first."
  if (state.blockers.includes("missing_scope")) {
    return `The stored token lacks ${state.missingScopes.join(", ")}. Connect the account again so the seller grants it.`
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/* ------------------------------------------------------------------ */

/**
 * What one write call ended with:
 *
 *   ok        Allegro (or the simulation) accepted it
 *   item      the call failed for reasons of that one item (an offer that
 *             cannot change, a parcel number Allegro refuses): the item is
 *             counted and quarantined, the writer keeps running
 *   systemic  the call failed for reasons that would fail the next one too
 *             (network, 5xx, 429, 401 or 403, a command where every offer
 *             failed, an answer we do not understand)
 */
export type WriteOutcome = { kind: "ok" } | { kind: "item"; message: string } | { kind: "systemic"; message: string }

export type WriterPatch = Partial<
  Pick<
    WriterRow,
    | "armed"
    | "changed_by"
    | "changed_by_id"
    | "changed_at"
    | "failure_streak"
    | "last_failure"
    | "last_failure_at"
    | "tripped_at"
    | "trip_reason"
    | "last_success_at"
  >
>

export const BREAKER_ACTOR = "circuit breaker"

export function afterOutcome(
  row: Pick<WriterRow, "failure_streak" | "armed">,
  outcome: WriteOutcome,
  threshold: number,
  now: Date,
): { patch: WriterPatch; tripped: boolean } {
  if (outcome.kind === "ok") {
    return { patch: { failure_streak: 0, last_success_at: now }, tripped: false }
  }
  const message = outcome.message.slice(0, 500)
  if (outcome.kind === "item") {
    return { patch: { last_failure: message, last_failure_at: now }, tripped: false }
  }
  const streak = (Number(row.failure_streak) || 0) + 1
  const limit = Math.max(1, Math.floor(threshold) || 1)
  if (streak >= limit && row.armed) {
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

/** A person flipped the toggle: the breaker history is cleared on arming. */
export function toggledPatch(armed: boolean, actor: { id: string | null; name: string }, now: Date, mode: "demo" | "live"): WriterPatch & { mode: string } {
  return {
    armed,
    mode,
    changed_by: actor.name.slice(0, 200),
    changed_by_id: actor.id,
    changed_at: now,
    ...(armed ? { failure_streak: 0, tripped_at: null, trip_reason: null } : {}),
  }
}

/* ------------------------------------------------------------------ */
/* Scopes asked for in the device login                                */
/* ------------------------------------------------------------------ */

export interface ScopeInputs {
  ordersEnabled: boolean
  writes: Readonly<Record<WriterKey, boolean>>
  issues: { returns: boolean; disputes: boolean; messages: boolean }
}

/**
 * The consent asks for read scopes, plus the write scopes of the writers the
 * options ALLOW. A writer the options do not allow never widens the consent.
 */
export function scopesFor(o: ScopeInputs): string {
  const out = new Set<string>([OFFERS_SCOPE])
  const ordersRead = o.ordersEnabled || o.writes.orders || o.writes.shipping || o.writes.invoices || o.issues.returns
  if (ordersRead) out.add(ORDERS_SCOPE)
  for (const key of WRITER_KEYS) {
    if (!o.writes[key]) continue
    for (const s of WRITERS[key].scopes) out.add(s)
  }
  if (o.issues.disputes) out.add(DISPUTES_SCOPE)
  if (o.issues.messages) out.add(MESSAGING_SCOPE)
  return [...out].join(" ")
}

/** Scopes the read features need (customer issues), to warn about a narrow consent. */
export function readScopesNeeded(o: ScopeInputs): string[] {
  const out: string[] = [OFFERS_SCOPE]
  if (o.ordersEnabled || o.issues.returns) out.push(ORDERS_SCOPE)
  if (o.issues.disputes) out.push(DISPUTES_SCOPE)
  if (o.issues.messages) out.push(MESSAGING_SCOPE)
  return out
}
