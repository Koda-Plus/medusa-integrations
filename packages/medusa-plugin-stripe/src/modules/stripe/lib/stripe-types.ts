/**
 * THE PARTS OF STRIPE'S OBJECTS THE PLUGIN READS (API version 2024-04-10).
 * No runtime imports. Every field is optional and nullable on purpose: the
 * parsers never trust a shape, so a field Stripe drops or renames degrades
 * one value instead of breaking the page.
 *
 * Fields with personal data (billing details, e-mails, names, the BLIK buyer
 * id) are left out of these types and never read.
 */

export interface RawList<T> {
  object?: "list"
  data?: T[] | null
  has_more?: boolean | null
}

export interface RawBalanceTransaction {
  id?: string
  amount?: number | null
  fee?: number | null
  net?: number | null
  currency?: string | null
  exchange_rate?: number | null
  available_on?: number | null
  status?: string | null
  type?: string | null
  fee_details?: Array<{ amount?: number | null; currency?: string | null; description?: string | null; type?: string | null }> | null
}

export interface RawCardDetails {
  brand?: string | null
  last4?: string | null
  funding?: string | null
  country?: string | null
  wallet?: { type?: string | null } | null
}

export interface RawPaymentMethodDetails {
  type?: string | null
  card?: RawCardDetails | null
  p24?: { bank?: string | null; reference?: string | null } | null
  blik?: Record<string, unknown> | null
  link?: Record<string, unknown> | null
}

export interface RawRefund {
  id?: string
  object?: string
  amount?: number | null
  currency?: string | null
  created?: number | null
  status?: string | null
  reason?: string | null
  failure_reason?: string | null
  payment_intent?: string | { id?: string } | null
  charge?: string | { id?: string } | null
}

export interface RawCharge {
  id?: string
  object?: string
  amount?: number | null
  amount_captured?: number | null
  amount_refunded?: number | null
  currency?: string | null
  created?: number | null
  status?: string | null
  paid?: boolean | null
  captured?: boolean | null
  refunded?: boolean | null
  disputed?: boolean | null
  failure_code?: string | null
  failure_message?: string | null
  outcome?: {
    type?: string | null
    risk_level?: string | null
    risk_score?: number | null
    seller_message?: string | null
    network_status?: string | null
    reason?: string | null
  } | null
  payment_intent?: string | { id?: string } | null
  payment_method_details?: RawPaymentMethodDetails | null
  balance_transaction?: string | RawBalanceTransaction | null
  refunds?: RawList<RawRefund> | null
  livemode?: boolean | null
}

export interface RawPaymentMethod {
  id?: string
  type?: string | null
  card?: RawCardDetails | null
  p24?: { bank?: string | null } | null
}

export interface RawPaymentIntent {
  id?: string
  object?: string
  amount?: number | null
  amount_received?: number | null
  amount_capturable?: number | null
  currency?: string | null
  created?: number | null
  status?: string | null
  capture_method?: string | null
  payment_method_types?: string[] | null
  automatic_payment_methods?: { enabled?: boolean | null } | null
  metadata?: Record<string, string | null | undefined> | null
  livemode?: boolean | null
  canceled_at?: number | null
  cancellation_reason?: string | null
  latest_charge?: string | RawCharge | null
  payment_method?: string | RawPaymentMethod | null
  last_payment_error?: {
    code?: string | null
    decline_code?: string | null
    message?: string | null
    type?: string | null
    payment_method?: RawPaymentMethod | null
  } | null
}

export interface RawDispute {
  id?: string
  amount?: number | null
  currency?: string | null
  created?: number | null
  status?: string | null
  reason?: string | null
  charge?: string | { id?: string } | null
  payment_intent?: string | { id?: string } | null
  is_charge_refundable?: boolean | null
  evidence_details?: {
    due_by?: number | null
    has_evidence?: boolean | null
    past_due?: boolean | null
    submission_count?: number | null
  } | null
  payment_method_details?: { type?: string | null; card?: { brand?: string | null } | null } | null
  livemode?: boolean | null
}

export interface RawBalanceAmount {
  amount?: number | null
  currency?: string | null
}

export interface RawBalance {
  available?: RawBalanceAmount[] | null
  pending?: RawBalanceAmount[] | null
  livemode?: boolean | null
}

export interface RawPayout {
  id?: string
  amount?: number | null
  currency?: string | null
  created?: number | null
  arrival_date?: number | null
  status?: string | null
  method?: string | null
  automatic?: boolean | null
  failure_message?: string | null
  failure_code?: string | null
}

export type CapabilityState = "active" | "inactive" | "pending" | string

export interface RawAccount {
  id?: string
  country?: string | null
  default_currency?: string | null
  charges_enabled?: boolean | null
  payouts_enabled?: boolean | null
  details_submitted?: boolean | null
  capabilities?: Record<string, CapabilityState | null | undefined> | null
  requirements?: {
    currently_due?: string[] | null
    past_due?: string[] | null
    disabled_reason?: string | null
    current_deadline?: number | null
  } | null
  settings?: {
    dashboard?: { display_name?: string | null } | null
    payouts?: { schedule?: { interval?: string | null; delay_days?: number | null } | null } | null
  } | null
  business_profile?: { name?: string | null } | null
}

export interface RawWebhookEndpoint {
  id?: string
  url?: string | null
  status?: string | null
  enabled_events?: string[] | null
  api_version?: string | null
  description?: string | null
  application?: string | null
  livemode?: boolean | null
}

export interface RawEvent {
  id?: string
  type?: string | null
  created?: number | null
  pending_webhooks?: number | null
  livemode?: boolean | null
  data?: { object?: { id?: string | null; object?: string | null } | null } | null
}

export interface RawDomainMethodStatus {
  status?: string | null
  status_details?: { error_message?: string | null } | null
}

export interface RawPaymentMethodDomain {
  id?: string
  domain_name?: string | null
  enabled?: boolean | null
  apple_pay?: RawDomainMethodStatus | null
  google_pay?: RawDomainMethodStatus | null
  link?: RawDomainMethodStatus | null
  livemode?: boolean | null
}

export interface RawMethodConfigEntry {
  available?: boolean | null
  display_preference?: { value?: string | null; preference?: string | null } | null
}

export interface RawPaymentMethodConfiguration {
  id?: string
  name?: string | null
  active?: boolean | null
  is_default?: boolean | null
  application?: string | null
  parent?: string | null
  [method: string]: unknown
}
