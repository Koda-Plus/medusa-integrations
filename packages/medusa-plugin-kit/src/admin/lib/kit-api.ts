import { kitFetch, type KitInit } from "./kit-kit"

/** The data hooks of the Kit admin, over the plugin's own routes. */

export type Status = {
  configured: boolean
  demo?: boolean
  missing: string[]
  problems: string[]
  options: { apiKey: string; source: string; doubleOptIn: boolean; formId: number | null; tags: number[]; storefrontUrl: string | null }
  account: { id: string; name: string | null; plan_type: string | null; primary_email_address: string | null } | null
  settings: {
    tags: number[]
    form_id: number | null
    double_opt_in: boolean
    source_tags: Record<string, number[]>
    buyer_tags: number[]
    product_tags: boolean
    product_tag_prefix: string
  }
  counts: { subscribed: number; failed: number; last_7_days: number }
}

export type KitTag = { id: number; name: string; subscriber_count?: number }
export type KitForm = { id: number; name: string | null; type: string | null; status: string | null; is_double_opt_in?: boolean | null }
export type SubscriberRow = {
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
export type Growth = { subscribers: number; new_subscribers: number; cancellations: number; net_new_subscribers: number; starting: string; ending: string }
export type EmailStats = { sent: number; opened: number; clicked: number; open_rate: number; click_rate: number; unsubscribe_rate: number; bounce_rate: number }
export type Overview = { subscribers: number; growth_30: Growth | null; growth_90: Growth | null; email_stats: EmailStats | null; fetched_at: string }
export type Broadcast = {
  id: number
  subject: string | null
  status: string | null
  public: boolean
  public_url: string | null
  published_at: string | null
  send_at: string | null
  created_at: string | null
  stats: { recipients: number; open_rate: number; click_rate: number; unsubscribes: number; unsubscribe_rate: number; total_clicks: number; status: string | null } | null
}
export type Check = { ok: boolean; account: Status["account"]; tags: KitTag[]; forms: KitForm[] }

const get = <T,>(path: string, init?: KitInit) => kitFetch<T>(path, init)

export const status = () => get<Status>("/admin/kit")
export const check = () => get<Check>("/admin/kit/check")
export const tags = () => get<{ tags: KitTag[] }>("/admin/kit/tags")
export const forms = () => get<{ forms: KitForm[] }>("/admin/kit/forms")
export const subscribers = (params: { take?: number; offset?: number; status?: string } = {}) => {
  const qs = new URLSearchParams()
  if (params.take) qs.set("take", String(params.take))
  if (params.offset) qs.set("offset", String(params.offset))
  if (params.status) qs.set("status", params.status)
  const s = qs.toString()
  return get<{ subscribers: SubscriberRow[]; count: number }>(`/admin/kit/subscribers${s ? `?${s}` : ""}`)
}
export const overview = (fresh = false) => get<{ configured: boolean; overview: Overview | null }>(`/admin/kit/overview${fresh ? "?fresh=1" : ""}`)
export const broadcasts = (fresh = false) => get<{ configured: boolean; broadcasts: Broadcast[] }>(`/admin/kit/broadcasts${fresh ? "?fresh=1" : ""}`)
export const saveSettings = (body: {
  tags?: number[]
  form_id?: number | null
  double_opt_in?: boolean
  source_tags?: Record<string, number[]>
  buyer_tags?: number[]
  product_tags?: boolean
  product_tag_prefix?: string
}) =>
  get<{ ok: boolean }>("/admin/kit/settings", { method: "POST", body })
