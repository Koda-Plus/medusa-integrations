/**
 * ROWS INTO ANSWERS. Pure, tested with `node --test`.
 *
 * Every answer starts from `normalizeThread`, so the admin, the Store API and
 * the events show the same prices. The Store API answer is the narrow one:
 * no internal notes, no writer records, no team names or ids, no demo story.
 */

import { MAX_CUSTOMER_MESSAGES_PER_THREAD, type AuthorType, type MessageKind } from "./constants"
import type {
  CartLineDto,
  CustomerDto,
  DraftOrderDto,
  DraftOrderState,
  LocalizedTextDto,
  MessageDto,
  MoneyDto,
  ReferenceDto,
  RunDto,
  RunKind,
  RunStatus,
  RunTrigger,
  StoreMessageDto,
  StoreThreadDto,
  ThreadDto,
} from "./contract"
import { legacySystemNote } from "./legacy"
import { amountFromMedusa, formatAmount, formatOrNull, multiply } from "./money"
import type { NegotiationsReference } from "./references"
import type { DraftOrderRow, MessageRow, RunRow } from "./rows"
import { isActive } from "./status"
import { snippet } from "./text"
import { toDate, type Thread } from "./thread"

export interface Enrichment {
  customers: ReadonlyMap<string, CustomerDto>
  products: ReadonlyMap<string, { id: string; title: string | null; thumbnail: string | null }>
  variants: ReadonlyMap<string, { id: string; title: string | null; sku: string | null }>
  /** Admin user id to a display name. */
  users: ReadonlyMap<string, string>
  /** Draft order outbox rows by negotiation id. */
  drafts: ReadonlyMap<string, DraftOrderRow>
}

export const EMPTY_ENRICHMENT: Enrichment = {
  customers: new Map(),
  products: new Map(),
  variants: new Map(),
  users: new Map(),
  drafts: new Map(),
}

export function money(amount: number | null | undefined, digits: number): MoneyDto | null {
  return typeof amount === "number" && Number.isSafeInteger(amount) ? { amount, value: formatAmount(amount, digits) } : null
}

function iso(v: unknown): string | null {
  const d = toDate(v)
  return d ? d.toISOString() : null
}

function localized(v: unknown): LocalizedTextDto | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const en = typeof o.en === "string" ? o.en : null
  const pl = typeof o.pl === "string" ? o.pl : null
  return en || pl ? { en, pl } : null
}

const KINDS: readonly string[] = ["message", "counter", "accepted", "rejected", "expired", "note", "draft_order"]

function kindOf(m: MessageRow): MessageKind {
  return typeof m.kind === "string" && KINDS.includes(m.kind) ? (m.kind as MessageKind) : "message"
}

function authorOf(m: MessageRow): AuthorType {
  return m.author_type === "customer" || m.author_type === "admin" ? m.author_type : "system"
}

/** A person's name for the admin: the user's name for a user id, an old free-text name as it is. */
export function personName(id: string | null | undefined, users: ReadonlyMap<string, string>): string | null {
  const s = typeof id === "string" ? id.trim() : ""
  if (!s || s === "admin" || s === "system") return null
  if (s.startsWith("user_")) return users.get(s) ?? null
  return s
}

function customerName(c: CustomerDto | null | undefined): string | null {
  if (!c) return null
  return c.company || c.name || c.email || null
}

export function toMessageDto(m: MessageRow, t: Thread, e: Enrichment): MessageDto {
  const author = authorOf(m)
  const kind = kindOf(m)
  const note = author === "system" && kind === "message" ? legacySystemNote(m.body) : null
  const legacyPrice = note?.amountText ? amountFromMedusa(note.amountText, t.digits) : null
  return {
    id: m.id,
    authorType: author,
    authorId: m.author_id ?? null,
    authorName: author === "admin" ? personName(m.author_id, e.users) : author === "customer" ? customerName(t.customerId ? e.customers.get(t.customerId) : null) : null,
    kind,
    body: m.body ?? "",
    text: localized(m.metadata && typeof m.metadata === "object" ? (m.metadata as Record<string, unknown>).text : null),
    price: money(typeof m.amount === "number" ? m.amount : null, t.digits),
    internal: m.internal === true || kind === "note" || kind === "draft_order",
    legacy: note ? { kind: note.kind, price: money(legacyPrice, t.digits) } : null,
    createdAt: iso(m.created_at) ?? new Date(0).toISOString(),
  }
}

export function toDraftOrderDto(row: DraftOrderRow): DraftOrderDto {
  const states: readonly string[] = ["pending", "creating", "created", "failed", "unknown", "blocked"]
  return {
    id: row.id,
    state: (states.includes(row.state) ? row.state : "pending") as DraftOrderState,
    draftOrderId: row.draft_order_id ?? null,
    displayId: typeof row.display_id === "number" ? row.display_id : null,
    error: row.error ?? null,
    attempts: Number(row.attempts) || 0,
    simulated: row.demo === true,
    requestedBy: row.requested_by ?? null,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
  }
}

function cartLineDtos(t: Thread): CartLineDto[] | null {
  if (!t.items) return null
  return t.items.map((l) => ({
    variantId: l.variant_id,
    productId: l.product_id,
    sku: l.sku,
    title: l.title,
    quantity: l.quantity,
    unit: money(l.unit_amount, t.digits),
    total: money(multiply(l.unit_amount, l.quantity), t.digits),
  }))
}

export function toThreadDto(t: Thread, e: Enrichment, extras: { lastMessage?: MessageRow | null; messages?: MessageRow[] } = {}): ThreadDto {
  const customer = t.customerId ? (e.customers.get(t.customerId) ?? null) : null
  const product = t.productId ? (e.products.get(t.productId) ?? null) : null
  const variant = t.variantId ? (e.variants.get(t.variantId) ?? null) : null
  const draft = e.drafts.get(t.id) ?? null
  const last = extras.lastMessage ?? null
  const dto: ThreadDto = {
    id: t.id,
    ref: t.ref,
    status: t.status,
    demo: t.demo,
    source: t.source,
    subject: t.subject,
    customerId: t.customerId,
    customer,
    customerLabel: localized(t.metadata?.demo_customer),
    productId: t.productId,
    variantId: t.variantId,
    cartId: t.cartId,
    orderId: t.orderId,
    product,
    variant,
    title: t.title ?? (product?.title && variant?.title && variant.title !== product.title ? `${product.title} / ${variant.title}` : (product?.title ?? null)),
    sku: t.sku ?? variant?.sku ?? null,
    qty: t.qty,
    currencyCode: t.currencyCode,
    currencyAssumed: t.currencyAssumed,
    requested: money(t.requested, t.digits),
    offered: money(t.offered, t.digits),
    agreed: money(t.agreed, t.digits),
    price: money(t.price, t.digits),
    list: money(t.list, t.digits),
    value: money(t.value, t.digits),
    discountPercent: t.discountPercent,
    items: cartLineDtos(t),
    waitingFor: t.waitingFor,
    lastActivityAt: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
    validUntil: isActive(t.status) && t.validUntil ? t.validUntil.toISOString() : null,
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    closedBy: t.closedBy,
    assignedTo: t.assignedTo,
    assignedName: personName(t.assignedTo, e.users),
    messageCount: t.messageCount,
    lastMessage: last
      ? {
          authorType: authorOf(last),
          kind: kindOf(last),
          snippet: snippet(last.body),
          text: localized(last.metadata && typeof last.metadata === "object" ? (last.metadata as Record<string, unknown>).text : null),
          createdAt: iso(last.created_at) ?? new Date(0).toISOString(),
        }
      : null,
    draftOrder: draft ? toDraftOrderDto(draft) : null,
  }
  if (extras.messages) dto.messages = extras.messages.map((m) => toMessageDto(m, t, e))
  return dto
}

/* ------------------------------------------------------------------ */
/* Store API                                                           */
/* ------------------------------------------------------------------ */

export interface StoreDtoOptions {
  customerAccept: boolean
  taxInclusive: boolean
  now: Date
}

/** What the customer may do now: write, accept the offer, decline. Nothing after the expiry moment. */
export function customerAbilities(t: Thread, o: StoreDtoOptions): { reply: boolean; accept: boolean; decline: boolean } {
  const overdue = t.expiresAt !== null && t.expiresAt.getTime() <= o.now.getTime()
  const active = isActive(t.status) && !overdue
  return {
    reply: active && t.messageCount < MAX_CUSTOMER_MESSAGES_PER_THREAD,
    accept: active && o.customerAccept && t.status === "counter_offered" && t.offered !== null,
    decline: active,
  }
}

/** A message as the customer sees it, or null for what the customer never sees (notes, writer records). */
export function toStoreMessageDto(m: MessageRow, t: Thread): StoreMessageDto | null {
  const kind = kindOf(m)
  if (m.internal === true || kind === "note" || kind === "draft_order") return null
  const author = authorOf(m)
  const note = author === "system" && kind === "message" ? legacySystemNote(m.body) : null
  const amount = typeof m.amount === "number" ? m.amount : note?.amountText ? amountFromMedusa(note.amountText, t.digits) : null
  return {
    id: m.id,
    author: author === "admin" ? "team" : author,
    kind: note ? note.kind : (kind as StoreMessageDto["kind"]),
    body: note ? "" : (m.body ?? ""),
    price: formatOrNull(amount, t.digits),
    created_at: iso(m.created_at) ?? new Date(0).toISOString(),
  }
}

export function toStoreThreadDto(t: Thread, o: StoreDtoOptions, messages?: MessageRow[]): StoreThreadDto {
  const can = customerAbilities(t, o)
  const dto: StoreThreadDto = {
    id: t.id,
    ref: t.ref,
    status: t.status,
    subject: t.subject,
    product_id: t.productId,
    variant_id: t.variantId,
    cart_id: t.cartId,
    title: t.title,
    sku: t.sku,
    quantity: t.qty,
    currency_code: t.currencyCode,
    requested_price: formatOrNull(t.requested, t.digits),
    offered_price: formatOrNull(t.offered, t.digits),
    agreed_price: formatOrNull(t.agreed, t.digits),
    price: formatOrNull(t.price, t.digits),
    tax_inclusive: o.taxInclusive,
    items: t.items ? t.items.map((l) => ({ variant_id: l.variant_id, sku: l.sku, title: l.title, quantity: l.quantity, unit_price: formatOrNull(l.unit_amount, t.digits) })) : null,
    waiting_for: t.waitingFor,
    expires_at: t.expiresAt ? t.expiresAt.toISOString() : null,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
    last_activity_at: t.lastActivityAt ? t.lastActivityAt.toISOString() : null,
    message_count: t.messageCount,
    can_reply: can.reply,
    can_accept: can.accept,
    can_decline: can.decline,
  }
  if (messages) dto.messages = messages.map((m) => toStoreMessageDto(m, t)).filter((m): m is StoreMessageDto => m !== null)
  return dto
}

/* ------------------------------------------------------------------ */
/* Runs and references                                                 */
/* ------------------------------------------------------------------ */

export function toRunDto(row: RunRow): RunDto {
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(row.counts ?? {})) if (typeof v === "number" && Number.isFinite(v)) counts[k] = v
  return {
    id: row.id,
    kind: row.kind as RunKind,
    trigger: row.trigger as RunTrigger,
    status: row.status as RunStatus,
    counts,
    message: row.message ?? null,
    startedAt: iso(row.started_at) ?? new Date(0).toISOString(),
    durationMs: Number(row.duration_ms) || 0,
  }
}

export function toReferenceDto(r: NegotiationsReference): ReferenceDto {
  return {
    name: r.name,
    url: r.url,
    soon: r.soon,
    icon: r.icon,
    description: r.description,
    metrics: r.metrics,
    links: r.links,
    review: r.review,
  }
}
