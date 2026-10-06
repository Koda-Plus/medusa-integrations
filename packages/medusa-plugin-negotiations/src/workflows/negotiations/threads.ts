/**
 * THE MOVES OF A NEGOTIATION, for the customer (Store API) and the team
 * (admin). Each move:
 *
 *   1. reads the thread in the current mode (demo or live) and, for the
 *      customer, checks it is theirs: someone else's thread answers 404,
 *      exactly like one that does not exist;
 *   2. checks the move against the status machine (`lib/status.ts`) and the
 *      body against `lib/validation.ts`;
 *   3. writes it as ONE conditional update plus its message
 *      (`ThreadStore.act`): when the status (or the offer the person saw)
 *      changed meanwhile, nothing is written and the answer is 409;
 *   4. emits its event (`lib/events.ts`) after the write.
 *
 * A customer move on a thread past its expiry closes the thread first (the
 * job would at its next pass) and answers 409 `expired`. Team moves are not
 * held to the clock: the team decides.
 *
 * Rows of the app module this plugin replaced get their amounts written into
 * the new columns before the first move (`materialize`).
 */

import {
  ACTIVE_STATUSES,
  DEMO_ID_PREFIX,
  EXPIRED_TEXT,
  MAX_CUSTOMER_MESSAGES_PER_THREAD,
  type AuthorType,
  type MessageKind,
  type NegotiationStatus,
} from "../../modules/negotiations/lib/constants"
import { eventData, eventForAction, NEGOTIATION_OPENED } from "../../modules/negotiations/lib/events"
import { isOverdue, validityFrom } from "../../modules/negotiations/lib/expiry"
import { currencyDigits, formatAmount } from "../../modules/negotiations/lib/money"
import type { MessageInsert, MessageRow, ThreadInsert, ThreadRow } from "../../modules/negotiations/lib/rows"
import { applyMove, MOVES, type ThreadAction } from "../../modules/negotiations/lib/status"
import type { ThreadPatch } from "../../modules/negotiations/lib/store"
import { formatRef, isEntityId } from "../../modules/negotiations/lib/text"
import type { Thread } from "../../modules/negotiations/lib/thread"
import {
  parseAdminAccept,
  parseAdminMessage,
  parseCounter,
  parseCustomerAccept,
  parseCustomerMessage,
  parseNote,
  parseOpenBody,
  parseOptionalMessage,
  parsePrice,
  type FieldError,
  type Limits,
} from "../../modules/negotiations/lib/validation"
import { queueOnAccept } from "./draft-orders"
import { ActionError, emitEvent, envOf, newId, normalize, storeDefaults, withLock, type Env, type Scope } from "./runtime"
import { resolveSubject } from "./subject"

export interface MoveResult {
  thread: Thread
  row: ThreadRow
  message: MessageRow | null
  /** The status before the move; null for a new thread. */
  previous: NegotiationStatus | null
}

function limitsOf(env: Env): Limits {
  return { maxMessageLength: env.options.maxMessageLength, maxQuantity: env.options.maxQuantity }
}

export function invalid(errors: FieldError[]): ActionError {
  return new ActionError(400, "invalid_data", errors[0]?.message ?? "Invalid request.", { errors })
}

const notFound = () => new ActionError(404, "not_found", "Negotiation not found.")

function message(env: Env, threadId: string, m: { author: AuthorType; authorId: string | null; kind: MessageKind; body: string | null; amount: number | null; internal?: boolean }): MessageInsert {
  return {
    id: newId("negmsg"),
    negotiation_id: threadId,
    author_type: m.author,
    author_id: m.authorId,
    kind: m.kind,
    body: m.body ?? "",
    amount: m.amount,
    internal: m.internal === true,
    metadata: null,
    created_at: env.now,
  }
}

/** The amounts of an app-module row, written into the new columns once, before the first move. */
async function materialize(env: Env, t: Thread): Promise<void> {
  if (!t.legacy) return
  await env.stores.threads.materialize(t.id, {
    currency_code: t.currencyCode,
    requested_amount: t.requested,
    offered_amount: t.offered,
    agreed_amount: t.agreed,
    price_amount: t.price,
  })
}

/** The currency an old row gets stored with its first move (it had none). */
function currencyPatch(t: Thread): ThreadPatch {
  return t.currencyAssumed && t.currencyCode ? { currency_code: t.currencyCode } : {}
}

async function emitMove(scope: Scope, action: ThreadAction, r: MoveResult, previous: NegotiationStatus, actor: AuthorType, actorId: string | null): Promise<void> {
  const name = eventForAction(action)
  if (!name) return
  await emitEvent(scope, name, eventData(r.thread, { previousStatus: previous, actor, actorId, messageId: r.message?.id ?? null }) as unknown as Record<string, unknown>)
}

/**
 * Explains a move that wrote nothing: the thread closed meanwhile, the offer
 * changed, or the thread is full. Reads the thread again to tell which.
 */
async function refusal(env: Env, id: string, why: { offeredAmount?: number; priceAmount?: number; maxMessages?: number }): Promise<ActionError> {
  const row = await env.stores.threads.getThread(id)
  if (!row || Boolean(row.demo) !== env.options.demo) return notFound()
  const t = normalize(env, row)
  if (!(ACTIVE_STATUSES as readonly string[]).includes(t.status)) {
    return new ActionError(409, "closed", `This negotiation is ${t.status.replace("_", " ")}. Open a new one to talk about a new price.`, { status: t.status })
  }
  if (why.offeredAmount !== undefined && t.offered !== why.offeredAmount) {
    return new ActionError(409, "offer_changed", "The offer changed in the meantime. Read the new one before you accept.", {
      offered_price: t.offered === null ? null : formatAmount(t.offered, t.digits),
    })
  }
  if (why.priceAmount !== undefined && t.price !== why.priceAmount) {
    return new ActionError(409, "price_changed", "The price on the table changed in the meantime.", { price: t.price === null ? null : formatAmount(t.price, t.digits) })
  }
  if (why.maxMessages !== undefined && t.messageCount >= why.maxMessages) {
    return new ActionError(409, "thread_full", "This negotiation has reached its message limit. Open a new one to go on.")
  }
  return new ActionError(409, "conflict", "The negotiation changed in the meantime. Load it again.")
}

async function act(
  scope: Scope,
  env: Env,
  t: Thread,
  action: ThreadAction,
  args: {
    actor: AuthorType
    actorId: string | null
    patch: ThreadPatch
    message: MessageInsert | null
    countMessage: boolean
    guard?: { offeredAmount?: number; priceAmount?: number; maxMessages?: number }
  },
): Promise<MoveResult> {
  const move = applyMove(t.status, t.waitingFor, action)
  if (!move.ok) {
    if (move.reason === "no_offer") throw new ActionError(409, "no_offer", "There is no counter offer to accept yet.")
    throw new ActionError(409, "closed", `This negotiation is ${t.status.replace("_", " ")}.`, { status: t.status })
  }
  const base: ThreadPatch = MOVES[action].to === "same" ? {} : { status: move.status }
  if (MOVES[action].waitingFor !== "same") base.waiting_for = move.waitingFor
  if (move.closedBy) {
    base.closed_at = env.now
    base.closed_by = move.closedBy
  }
  if (MOVES[action].activity) base.last_activity_at = env.now
  const result = await env.stores.threads.act({
    id: t.id,
    demo: env.options.demo,
    from: MOVES[action].from,
    guard: args.guard,
    patch: { ...base, ...currencyPatch(t), ...args.patch },
    countMessage: args.countMessage,
    message: args.message,
    now: env.now,
  })
  if (!result) throw await refusal(env, t.id, args.guard ?? {})
  const out: MoveResult = { thread: normalize(env, result.thread), row: result.thread, message: result.message, previous: t.status }
  await emitMove(scope, action, out, t.status, args.actor, args.actorId)
  return out
}

/** Closes an overdue thread on the spot, the way the expiry job would. */
async function expireNow(scope: Scope, env: Env, t: Thread): Promise<void> {
  try {
    await act(scope, env, t, "expire", {
      actor: "system",
      actorId: null,
      patch: {},
      message: message(env, t.id, { author: "system", kind: "expired", authorId: null, body: EXPIRED_TEXT, amount: null }),
      countMessage: true,
    })
  } catch {
    /* someone moved first: the answer below stays right either way */
  }
}

/* ------------------------------------------------------------------ */
/* Customer moves (Store API)                                          */
/* ------------------------------------------------------------------ */

/** A thread of the customer, in the current mode, outside the demo story. Anything else is 404. */
export async function customerThread(env: Env, customerId: string, id: string): Promise<{ row: ThreadRow; thread: Thread }> {
  if (!isEntityId(id)) throw notFound()
  const row = await env.stores.threads.getThread(id)
  if (!row || !row.customer_id || row.customer_id !== customerId || Boolean(row.demo) !== env.options.demo || row.id.startsWith(DEMO_ID_PREFIX)) throw notFound()
  return { row, thread: normalize(env, row) }
}

async function liveForCustomer(scope: Scope, env: Env, customerId: string, id: string): Promise<Thread> {
  const { thread } = await customerThread(env, customerId, id)
  if (isOverdue({ status: thread.status, expiresAt: thread.expiresAt, lastActivityAt: null }, 0, env.now)) {
    await expireNow(scope, env, thread)
    throw new ActionError(409, "expired", "This negotiation has expired. Open a new one to go on.", { status: "expired" })
  }
  return thread
}

export interface OpenArgs {
  customerId: string
  body: unknown
  /** Sales channels of the publishable key of the request. */
  salesChannelIds?: readonly string[] | null
}

export async function openNegotiation(scope: Scope, args: OpenArgs): Promise<MoveResult> {
  const env = await envOf(scope)
  const parsed = parseOpenBody(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const v = parsed.value
  const subject = await resolveSubject(scope, {
    productId: v.productId,
    variantId: v.variantId,
    cartId: v.cartId,
    customerId: args.customerId,
    qty: v.qty,
    salesChannelIds: args.salesChannelIds ?? [],
  })

  let currency: string | null
  if (subject.subject === "cart") {
    if (v.currencyCode && v.currencyCode !== subject.cartCurrency) throw invalid([{ field: "currency_code", code: "currency_mismatch", message: "A cart thread is in the cart's currency." }])
    currency = subject.cartCurrency
  } else {
    const defaults = await storeDefaults(scope)
    currency = v.currencyCode ?? env.options.defaultCurrency ?? defaults.currency
    if (v.currencyCode && defaults.currencies.length > 0 && !defaults.currencies.includes(v.currencyCode)) {
      throw invalid([{ field: "currency_code", code: "currency_not_supported", message: "The store does not sell in this currency." }])
    }
  }
  if (!currency) throw invalid([{ field: "currency_code", code: "required", message: "currency_code is required: the store has no default currency." }])
  const digits = currencyDigits(currency)
  let requested: number | null = null
  if (v.price !== null) {
    const p = parsePrice(v.price, digits, "target_price")
    if (!p.ok) throw invalid(p.errors)
    requested = p.value
  }
  const list = subject.listFor(currency, digits)
  const items = subject.itemsFor(digits)

  return withLock(`open:${args.customerId}`, async () => {
    /* The demo story borrows customers but is never theirs: it neither blocks nor counts. */
    const active = (await env.stores.threads.activeForCustomer(args.customerId, env.options.demo)).filter((r) => !r.id.startsWith(DEMO_ID_PREFIX))
    const same = active.find((r) =>
      subject.subject === "cart"
        ? r.cart_id === subject.cartId
        : subject.variantId
          ? r.variant_id === subject.variantId
          : r.product_id === subject.productId && !r.variant_id && !r.cart_id,
    )
    if (same) throw new ActionError(409, "already_open", "There is already an open negotiation about this. Write in it instead.", { negotiation_id: same.id, ref: same.ref })
    if (active.length >= env.options.maxActivePerCustomer) {
      throw new ActionError(409, "too_many_active", `You have ${active.length} open negotiations. Close one before opening another.`)
    }
    const id = newId("neg")
    const ref = formatRef(env.now.getUTCFullYear(), await env.stores.threads.nextRefNumber())
    const first = message(env, id, { author: "customer", authorId: args.customerId, kind: "message", body: v.message, amount: requested })
    const thread: ThreadInsert = {
      id,
      ref,
      status: "open",
      demo: env.options.demo,
      source: "store",
      subject: subject.subject,
      customer_id: args.customerId,
      product_id: subject.productId,
      variant_id: subject.variantId,
      cart_id: subject.cartId,
      sku: subject.sku,
      title: subject.title,
      qty: subject.subject === "cart" ? 1 : v.qty,
      currency_code: currency,
      requested_amount: requested,
      offered_amount: null,
      agreed_amount: null,
      price_amount: requested,
      list_amount: list,
      items,
      waiting_for: "team",
      last_activity_at: env.now,
      message_count: 1,
      expires_at: null,
      closed_at: null,
      closed_by: null,
      assigned_to: null,
      metadata: null,
      created_at: env.now,
      updated_at: env.now,
    }
    const created = await env.stores.threads.insertThread(thread, first)
    const out: MoveResult = { thread: normalize(env, created.thread), row: created.thread, message: created.message, previous: null }
    await emitEvent(scope, NEGOTIATION_OPENED, eventData(out.thread, { previousStatus: null, actor: "customer", actorId: args.customerId, messageId: created.message?.id ?? null }) as unknown as Record<string, unknown>)
    return out
  })
}

/** The customer writes; with `target_price` it is a new target, and a countered thread is open again. */
export async function customerMessage(scope: Scope, args: { customerId: string; id: string; body: unknown }): Promise<MoveResult> {
  const env = await envOf(scope)
  const parsed = parseCustomerMessage(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const t = await liveForCustomer(scope, env, args.customerId, args.id)
  let amount: number | null = null
  if (parsed.value.price !== null) {
    const p = parsePrice(parsed.value.price, t.digits, "target_price")
    if (!p.ok) throw invalid(p.errors)
    amount = p.value
  }
  await materialize(env, t)
  const action: ThreadAction = amount !== null ? "customer_proposal" : "customer_message"
  return act(scope, env, t, action, {
    actor: "customer",
    actorId: args.customerId,
    patch: amount !== null ? { requested_amount: amount, price_amount: amount, expires_at: null } : {},
    message: message(env, t.id, { author: "customer", authorId: args.customerId, kind: "message", body: parsed.value.message, amount }),
    countMessage: true,
    guard: { maxMessages: MAX_CUSTOMER_MESSAGES_PER_THREAD },
  })
}

/**
 * The customer accepts the team's counter offer. With `price` (the offer as
 * the customer read it) the accept is refused when the offer changed since.
 */
export async function customerAccept(scope: Scope, args: { customerId: string; id: string; body: unknown }): Promise<MoveResult> {
  const env = await envOf(scope)
  if (!env.options.customerAccept) throw new ActionError(403, "accept_disabled", "Offers are accepted by the store team. Reply in the thread instead.")
  const parsed = parseCustomerAccept(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const t = await liveForCustomer(scope, env, args.customerId, args.id)
  if (t.status === "open") throw new ActionError(409, "no_offer", "There is no counter offer to accept yet.")
  await materialize(env, t)
  const offered = t.offered
  if (t.status === "counter_offered" && offered === null) throw new ActionError(409, "no_offer", "There is no counter offer to accept yet.")
  if (parsed.value.price !== null && offered !== null) {
    const p = parsePrice(parsed.value.price, t.digits, "price")
    if (!p.ok) throw invalid(p.errors)
    if (p.value !== offered) {
      throw new ActionError(409, "offer_changed", "The offer changed in the meantime. Read the new one before you accept.", { offered_price: formatAmount(offered, t.digits) })
    }
  }
  const result = await act(scope, env, t, "customer_accept", {
    actor: "customer",
    actorId: args.customerId,
    patch: offered === null ? {} : { agreed_amount: offered, price_amount: offered },
    message: message(env, t.id, { author: "customer", authorId: args.customerId, kind: "accepted", body: parsed.value.message, amount: offered }),
    countMessage: true,
    guard: offered === null ? undefined : { offeredAmount: offered },
  })
  await queueOnAccept(scope, result.thread, args.customerId)
  return result
}

/** The customer declines and closes the negotiation. */
export async function customerDecline(scope: Scope, args: { customerId: string; id: string; body: unknown }): Promise<MoveResult> {
  const env = await envOf(scope)
  const parsed = parseOptionalMessage(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const t = await liveForCustomer(scope, env, args.customerId, args.id)
  await materialize(env, t)
  return act(scope, env, t, "customer_decline", {
    actor: "customer",
    actorId: args.customerId,
    patch: {},
    message: message(env, t.id, { author: "customer", authorId: args.customerId, kind: "rejected", body: parsed.value.message, amount: null }),
    countMessage: true,
  })
}

/* ------------------------------------------------------------------ */
/* Team moves (admin)                                                  */
/* ------------------------------------------------------------------ */

/** A thread of the current mode for the admin, or 404. */
export async function adminThread(env: Env, id: string): Promise<Thread> {
  if (!isEntityId(id)) throw notFound()
  const row = await env.stores.threads.getThread(id)
  if (!row || Boolean(row.demo) !== env.options.demo) throw notFound()
  return normalize(env, row)
}

export async function adminMessage(scope: Scope, args: { id: string; actorId: string | null; body: unknown }): Promise<MoveResult> {
  const env = await envOf(scope)
  const parsed = parseAdminMessage(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const t = await adminThread(env, args.id)
  await materialize(env, t)
  return act(scope, env, t, "admin_message", {
    actor: "admin",
    actorId: args.actorId,
    patch: { assigned_to: args.actorId ?? undefined },
    message: message(env, t.id, { author: "admin", authorId: args.actorId, kind: "message", body: parsed.value.message, amount: null }),
    countMessage: true,
  })
}

/** The team offers a price (per unit, or for the whole cart), optionally valid for a number of days. */
export async function adminCounter(scope: Scope, args: { id: string; actorId: string | null; body: unknown }): Promise<MoveResult> {
  const env = await envOf(scope)
  const parsed = parseCounter(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const t = await adminThread(env, args.id)
  const p = parsePrice(parsed.value.price, t.digits, "price")
  if (!p.ok) throw invalid(p.errors)
  await materialize(env, t)
  return act(scope, env, t, "admin_counter", {
    actor: "admin",
    actorId: args.actorId,
    patch: { offered_amount: p.value, price_amount: p.value, expires_at: validityFrom(env.now, parsed.value.validDays), assigned_to: args.actorId ?? undefined },
    message: message(env, t.id, { author: "admin", authorId: args.actorId, kind: "counter", body: parsed.value.message, amount: p.value }),
    countMessage: true,
  })
}

/**
 * The team accepts the price on the table: the customer's target while the
 * thread is open, the team's own offer when the customer agreed to it
 * outside the store. With `price` the accept is refused when the price on
 * the table changed since the person read it.
 */
export async function adminAccept(scope: Scope, args: { id: string; actorId: string | null; body: unknown }): Promise<MoveResult> {
  const env = await envOf(scope)
  const parsed = parseAdminAccept(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const t = await adminThread(env, args.id)
  const price = t.status === "counter_offered" ? (t.offered ?? t.price) : (t.requested ?? t.price)
  if ((ACTIVE_STATUSES as readonly string[]).includes(t.status) && price === null) {
    throw new ActionError(409, "no_price", "There is no price on the table yet. Send a counter offer first.")
  }
  if (parsed.value.price !== null && price !== null) {
    const p = parsePrice(parsed.value.price, t.digits, "price")
    if (!p.ok) throw invalid(p.errors)
    if (p.value !== price) throw new ActionError(409, "price_changed", "The price on the table changed in the meantime.", { price: formatAmount(price, t.digits) })
  }
  await materialize(env, t)
  const result = await act(scope, env, t, "admin_accept", {
    actor: "admin",
    actorId: args.actorId,
    patch: price === null ? { assigned_to: args.actorId ?? undefined } : { agreed_amount: price, price_amount: price, assigned_to: args.actorId ?? undefined },
    message: message(env, t.id, { author: "admin", authorId: args.actorId, kind: "accepted", body: parsed.value.message, amount: price }),
    countMessage: true,
    guard: price === null ? undefined : { priceAmount: price },
  })
  await queueOnAccept(scope, result.thread, args.actorId)
  return result
}

export async function adminReject(scope: Scope, args: { id: string; actorId: string | null; body: unknown }): Promise<MoveResult> {
  const env = await envOf(scope)
  const parsed = parseOptionalMessage(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const t = await adminThread(env, args.id)
  await materialize(env, t)
  return act(scope, env, t, "admin_reject", {
    actor: "admin",
    actorId: args.actorId,
    patch: { assigned_to: args.actorId ?? undefined },
    message: message(env, t.id, { author: "admin", authorId: args.actorId, kind: "rejected", body: parsed.value.message, amount: null }),
    countMessage: true,
  })
}

/** An internal note: on any thread, open or closed, never shown to the customer, no event. */
export async function adminNote(scope: Scope, args: { id: string; actorId: string | null; body: unknown }): Promise<MoveResult> {
  const env = await envOf(scope)
  const parsed = parseNote(args.body, limitsOf(env))
  if (!parsed.ok) throw invalid(parsed.errors)
  const t = await adminThread(env, args.id)
  return act(scope, env, t, "note", {
    actor: "admin",
    actorId: args.actorId,
    patch: {},
    message: message(env, t.id, { author: "admin", authorId: args.actorId, kind: "note", body: parsed.value.note, amount: null, internal: true }),
    countMessage: false,
  })
}

