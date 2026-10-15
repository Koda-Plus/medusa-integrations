/** The shapes the routes answer with (snake case, like Medusa's own API). */

export interface SubscriberDto {
  id: string
  email: string
  first_name: string | null
  kit_subscriber_id: number | null
  state: string | null
  tags: number[] | null
  source: string | null
  status: "ok" | "failed"
  error: string | null
  created_at: string
}

export interface SubscriptionResult {
  ok: boolean
  configured: boolean
  /** "subscribed" - active on the list; "confirmation_sent" - waiting for the double opt-in email. */
  status: "subscribed" | "confirmation_sent"
  /** True when Kit answered 200 (the address was already there). */
  already: boolean
}

export interface StatusResponse {
  configured: boolean
  demo: boolean
  missing: string[]
  problems: string[]
  options: {
    apiKey: string
    source: string
    doubleOptIn: boolean
    formId: number | null
    tags: number[]
    storefrontUrl: string | null
  }
  account: {
    id: string
    name: string | null
    plan_type: string | null
    primary_email_address: string | null
  } | null
  settings: {
    tags: number[]
    form_id: number | null
    double_opt_in: boolean
    source_tags: Record<string, number[]>
    buyer_tags: number[]
    product_tags: boolean
    product_tag_prefix: string
  }
  counts: {
    subscribed: number
    failed: number
    last_7_days: number
  }
}
