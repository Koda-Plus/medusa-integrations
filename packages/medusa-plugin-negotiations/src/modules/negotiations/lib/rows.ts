/**
 * ROWS AS THE DATABASE RETURNS THEM (node-postgres through Knex): integers
 * as numbers, timestamps as Date, jsonb parsed, `numeric` as a string.
 * Types only.
 *
 * The thread table may be older than this plugin: the Koda Plus demo store
 * created it with an app module, whose rows keep a `target_price numeric`
 * (and a `raw_target_price jsonb`) and none of the columns added here until
 * the migration fills the defaults. Every column the migration adds is
 * therefore optional in these types, and the code reads rows through
 * `normalizeThread`, never field by field.
 */

import type { AuthorType, MessageKind, NegotiationStatus, Subject, ThreadSource, WaitingFor } from "./constants"

export interface ThreadRow {
  id: string
  ref: string
  status: string
  customer_id: string | null
  cart_id: string | null
  order_id: string | null
  product_id: string | null
  variant_id: string | null
  sku: string | null
  qty: number | null
  assigned_to: string | null
  metadata: Record<string, unknown> | null
  created_at: Date | string
  updated_at: Date | string
  deleted_at?: Date | string | null
  /* Added by this plugin. */
  demo?: boolean | null
  source?: string | null
  subject?: string | null
  title?: string | null
  currency_code?: string | null
  requested_amount?: number | null
  offered_amount?: number | null
  agreed_amount?: number | null
  price_amount?: number | null
  list_amount?: number | null
  items?: unknown
  waiting_for?: string | null
  last_activity_at?: Date | string | null
  message_count?: number | null
  expires_at?: Date | string | null
  closed_at?: Date | string | null
  closed_by?: string | null
  /* The app module's single price column (numeric, major units). */
  target_price?: string | number | null
}

export interface MessageRow {
  id: string
  negotiation_id: string
  author_type: string
  author_id: string | null
  body: string
  attachments?: unknown
  kind?: string | null
  amount?: number | null
  internal?: boolean | null
  metadata?: Record<string, unknown> | null
  created_at: Date | string
  updated_at?: Date | string
  deleted_at?: Date | string | null
}

export interface DraftOrderRow {
  id: string
  negotiation_id: string
  demo: boolean
  state: string
  draft_order_id: string | null
  display_id: number | null
  error: string | null
  attempts: number
  claim_token: string | null
  claimed_at: Date | string | null
  lease_until: Date | string | null
  payload: unknown
  requested_by: string | null
  created_at: Date | string
  updated_at: Date | string
}

export interface SettingRow {
  id: string
  key: string
  value: unknown
  updated_by: string | null
  created_at?: Date | string
  updated_at: Date | string | null
}

export interface RunRow {
  id: string
  kind: string
  trigger: string
  status: string
  demo: boolean
  counts: Record<string, unknown> | null
  message: string | null
  started_at: Date | string
  finished_at: Date | string | null
  duration_ms: number | null
}

/** A new thread, as the store inserts it. */
export interface ThreadInsert {
  id: string
  ref: string
  status: NegotiationStatus
  demo: boolean
  source: ThreadSource
  subject: Subject
  customer_id: string | null
  product_id: string | null
  variant_id: string | null
  cart_id: string | null
  sku: string | null
  title: string | null
  qty: number
  currency_code: string
  requested_amount: number | null
  offered_amount: number | null
  agreed_amount: number | null
  price_amount: number | null
  list_amount: number | null
  items: CartLine[] | null
  waiting_for: WaitingFor | null
  last_activity_at: Date
  message_count: number
  expires_at: Date | null
  closed_at: Date | null
  closed_by: string | null
  assigned_to: string | null
  metadata: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

/** A new message, as the store inserts it. */
export interface MessageInsert {
  id: string
  negotiation_id: string
  author_type: AuthorType
  author_id: string | null
  kind: MessageKind
  body: string
  amount: number | null
  internal: boolean
  metadata: Record<string, unknown> | null
  created_at: Date
}

/** A line of a cart, as the thread keeps it from the moment it was opened. */
export interface CartLine {
  variant_id: string | null
  product_id: string | null
  sku: string | null
  title: string
  quantity: number
  /** Minor units of the thread currency. */
  unit_amount: number | null
}
