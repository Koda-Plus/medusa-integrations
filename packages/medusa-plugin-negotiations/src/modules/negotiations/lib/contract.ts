/**
 * WHAT THE APIS ANSWER. Types only: the admin (React) and the routes share
 * them, so a renamed field breaks the build instead of the page.
 *
 * Admin answers use camelCase, like the other Koda Plus plugins; Store API
 * answers use snake_case, like Medusa's own store routes.
 */

import type { AuthorType, MessageKind, NegotiationStatus, Subject, ThreadSource, WaitingFor } from "./constants"
import type { WriterKey } from "./writers"

/** An amount: minor units and the same as decimal text in major units ("469.00"). */
export interface MoneyDto {
  amount: number
  value: string
}

export interface LocalizedTextDto {
  en: string | null
  pl: string | null
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface CustomerDto {
  id: string
  email: string | null
  name: string | null
  company: string | null
}

export interface CartLineDto {
  variantId: string | null
  productId: string | null
  sku: string | null
  title: string
  quantity: number
  unit: MoneyDto | null
  total: MoneyDto | null
}

export type DraftOrderState = "pending" | "creating" | "created" | "failed" | "unknown" | "blocked"

export interface DraftOrderDto {
  id: string
  state: DraftOrderState
  draftOrderId: string | null
  displayId: number | null
  error: string | null
  attempts: number
  /** Demo mode: no draft order was written to Medusa. */
  simulated: boolean
  requestedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface MessageDto {
  id: string
  authorType: AuthorType
  authorId: string | null
  /** The team member's name, or the customer's (company first). */
  authorName: string | null
  kind: MessageKind
  body: string
  /** The demo story's text in both languages; the admin shows the one of its language. */
  text: LocalizedTextDto | null
  price: MoneyDto | null
  /** Notes and writer records: never shown to the customer. */
  internal: boolean
  /** A system note of the app module this plugin replaced, read by its Polish text. */
  legacy: { kind: "counter" | "accepted" | "rejected"; price: MoneyDto | null } | null
  createdAt: string
}

export interface ThreadDto {
  id: string
  ref: string
  status: NegotiationStatus
  demo: boolean
  source: ThreadSource
  subject: Subject | null
  customerId: string | null
  customer: CustomerDto | null
  /** The demo story's placeholder customer, when the store has none. */
  customerLabel: LocalizedTextDto | null
  productId: string | null
  variantId: string | null
  cartId: string | null
  orderId: string | null
  product: { id: string; title: string | null; thumbnail: string | null } | null
  variant: { id: string; title: string | null; sku: string | null } | null
  title: string | null
  sku: string | null
  qty: number
  currencyCode: string | null
  /** No currency stored on the row: the default currency is assumed. */
  currencyAssumed: boolean
  requested: MoneyDto | null
  offered: MoneyDto | null
  agreed: MoneyDto | null
  /** The price on the table. */
  price: MoneyDto | null
  list: MoneyDto | null
  value: MoneyDto | null
  discountPercent: number | null
  items: CartLineDto[] | null
  waitingFor: WaitingFor | null
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
  /** When the thread expires under the current options. */
  expiresAt: string | null
  /** A validity a counter offer set. */
  validUntil: string | null
  closedAt: string | null
  closedBy: string | null
  assignedTo: string | null
  assignedName: string | null
  messageCount: number
  lastMessage: { authorType: AuthorType; kind: MessageKind; snippet: string; text: LocalizedTextDto | null; createdAt: string } | null
  draftOrder: DraftOrderDto | null
  /** Only in the thread detail. */
  messages?: MessageDto[]
}

export interface ThreadsResponse {
  threads: ThreadDto[]
  count: number
  limit: number
  offset: number
}

export interface ThreadResponse {
  thread: ThreadDto
}

export interface WriterDto {
  key: WriterKey
  allowed: boolean
  on: boolean
  armed: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export type RunKind = "expire" | "draft_orders" | "demo"
export type RunTrigger = "schedule" | "manual" | "auto"
export type RunStatus = "ok" | "partial" | "error" | "skipped"

export interface RunDto {
  id: string
  kind: RunKind
  trigger: RunTrigger
  status: RunStatus
  counts: Record<string, number>
  message: string | null
  startedAt: string
  durationMs: number
}

/** A text of the `references` option: either language may be missing. */
export interface ReferenceTextDto {
  en?: string
  pl?: string
}

export interface ReferenceDto {
  name: string
  /** https. Null only for a store that starts soon and has no address yet. */
  url: string | null
  /** The store starts on Medusa soon: a "Soon" badge, no link. */
  soon: boolean
  /** The store's icon: a data URI or an https URL. */
  icon: string | null
  description: ReferenceTextDto | null
  metrics: Array<{ label: ReferenceTextDto; value: string }>
  links: Array<{ label: ReferenceTextDto; url: string }>
  /** The store's rating of the work and where it was given, e.g. Clutch. */
  review: {
    rating: number
    scale: number
    source: string
    url: string | null
    icon: string | null
    quote: ReferenceTextDto | null
    author: string | null
  } | null
}

export interface CurrencyAmountDto {
  currencyCode: string
  amount: number
  value: string
}

export interface StatusResponse {
  mode: "demo" | "live"
  options: {
    expiryDays: number
    defaultCurrency: string | null
    /** The store's default currency, used when the option is not set. */
    storeCurrency: string | null
    taxInclusive: boolean
    storeApi: boolean
    customerAccept: boolean
    maxMessageLength: number
    maxQuantity: number
    maxActivePerCustomer: number
    openPerHour: number
    messagesPerHour: number
    draftOrders: { regionId: string | null; salesChannelId: string | null; maxPerRun: number }
    writersAllowed: Record<WriterKey, boolean>
  }
  counts: {
    all: number
    open: number
    counter_offered: number
    accepted: number
    rejected: number
    expired: number
    /** Active threads where the customer moved last. */
    waiting: number
    /** Active threads expiring within two days. */
    expiringSoon: number
    /** Threads opened through the Store API (real customers), all statuses. */
    fromStore: number
    acceptedLast30Days: number
  }
  /** What the active threads are worth, per currency. */
  valueInTalks: CurrencyAmountDto[]
  /** Agreed in the last 30 days, per currency. */
  acceptedValue30Days: CurrencyAmountDto[]
  writers: Record<WriterKey, WriterDto>
  draftOrders: { pending: number; creating: number; created: number; failed: number; unknown: number; blocked: number }
  lastRuns: Partial<Record<RunKind, RunDto>>
  references: ReferenceDto[]
  demo: { seededAt: string | null; threads: number } | null
}

export interface RunsResponse {
  runs: RunDto[]
}

export interface ExpireResponse {
  run: RunDto
}

export interface PlanItemDto {
  outboxId: string
  thread: { id: string; ref: string; customer: string | null; title: string | null; qty: number; price: MoneyDto | null; currencyCode: string | null }
  state: DraftOrderState
  /** Ready to create, or why not. */
  ready: boolean
  blocked: string | null
  error: string | null
  attempts: number
  /** The exact input of `createOrderWorkflow`, for the dry run. */
  input: Record<string, unknown> | null
}

export interface PlanResponse {
  writer: WriterDto
  items: PlanItemDto[]
}

export interface DraftRunResponse {
  dryRun: boolean
  items: PlanItemDto[]
  run: RunDto | null
}

/* ------------------------------------------------------------------ */
/* Store API                                                           */
/* ------------------------------------------------------------------ */

export interface StoreMessageDto {
  id: string
  /** "team" for anyone of the store; names of the team are not shown. */
  author: "customer" | "team" | "system"
  kind: Exclude<MessageKind, "note" | "draft_order">
  body: string
  /** The price the message carries (a target, an offer, the agreed price). */
  price: string | null
  created_at: string
}

export interface StoreThreadDto {
  id: string
  ref: string
  status: NegotiationStatus
  subject: Subject | null
  product_id: string | null
  variant_id: string | null
  cart_id: string | null
  title: string | null
  sku: string | null
  quantity: number
  currency_code: string | null
  /** Per unit, or for the whole cart (`subject: "cart"`). Decimal text, major units. */
  requested_price: string | null
  offered_price: string | null
  agreed_price: string | null
  price: string | null
  /** Whether prices include tax (the store's `taxInclusive` option). */
  tax_inclusive: boolean
  items: Array<{ variant_id: string | null; sku: string | null; title: string; quantity: number; unit_price: string | null }> | null
  waiting_for: WaitingFor | null
  expires_at: string | null
  created_at: string
  updated_at: string
  last_activity_at: string | null
  message_count: number
  can_reply: boolean
  can_accept: boolean
  can_decline: boolean
  messages?: StoreMessageDto[]
}

export interface StoreThreadsResponse {
  negotiations: StoreThreadDto[]
  count: number
  limit: number
  offset: number
}

export interface StoreThreadResponse {
  negotiation: StoreThreadDto
}
