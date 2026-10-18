import type { Logger } from "@medusajs/framework/types"
import { KIT_API } from "./constants"
import type { ResolvedKitOptions } from "./options"

/**
 * A minimal Kit API v4 client: only what the plugin needs. GET and POST
 * against api.kit.com with the `X-Kit-Api-Key` header. The key stays on the
 * server and is masked in every error; errors are mapped to stable codes the
 * admin can act on (`auth`, `invalid`, `rate`, `error`).
 */

export interface KitAccount {
  id: string
  name: string | null
  plan_type: string | null
  primary_email_address: string | null
}

export interface KitTag {
  id: number
  name: string
  created_at?: string
  subscriber_count?: number
}

export interface KitForm {
  id: number
  name: string | null
  type: string | null
  status: string | null
  is_double_opt_in?: boolean | null
}

export interface KitSubscriber {
  id: number
  first_name: string | null
  email_address: string
  state: string
  created_at: string
  fields: Record<string, string>
}

/** The account's email stats (Kit counts the last 90 days). */
export interface KitEmailStats {
  sent: number
  opened: number
  clicked: number
  open_rate: number
  click_rate: number
  unsubscribe_rate: number
  bounce_rate: number
}

/** The list's growth between two dates. */
export interface KitGrowth {
  subscribers: number
  new_subscribers: number
  cancellations: number
  net_new_subscribers: number
  starting: string
  ending: string
}

/** One broadcast (a campaign) with its stats. */
export interface KitBroadcast {
  id: number
  subject: string | null
  status: string | null
  public: boolean
  public_url: string | null
  published_at: string | null
  send_at: string | null
  created_at: string | null
}

export interface KitBroadcastStats {
  recipients: number
  open_rate: number
  click_rate: number
  unsubscribes: number
  unsubscribe_rate: number
  total_clicks: number
  status: string | null
}

export type KitErrorKind = "auth" | "invalid" | "rate" | "not_found" | "error"

export class KitApiError extends Error {
  readonly kind: KitErrorKind
  readonly status: number | null
  constructor(kind: KitErrorKind, status: number | null, message: string) {
    super(message)
    this.name = "KitApiError"
    this.kind = kind
    this.status = status
  }
}

export function maskKitSecrets(text: string, apiKey: string): string {
  if (!apiKey) return text
  return text.split(apiKey).join(`***${apiKey.slice(-4)}`)
}

/** Creates a client for the resolved options; `keyed` re-keys an existing one. */
const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function createKitClient(options: ResolvedKitOptions, logger: Pick<Logger, "warn" | "error">) {
  const o = options
  let nextCallAt = 0
  let queue: Promise<unknown> = Promise.resolve()

  /** A rolling per-process throttle, under Kit's 120 requests per minute. */
  async function throttle(): Promise<void> {
    const turn = queue.then(async () => {
      const wait = nextCallAt - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      nextCallAt = Date.now() + Math.ceil(60_000 / Math.max(1, o.requestsPerMinute))
    })
    queue = turn.catch(() => undefined)
    return turn
  }

  async function request<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<{ status: number; json: any }> {
    if (!o.apiKey) throw new KitApiError("auth", null, "No Kit API key: set the apiKey option.")
    await throttle()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), o.timeoutMs)
    let res: Response
    try {
      res = await fetch(`${KIT_API}${path}`, {
        method,
        headers: {
          "X-Kit-Api-Key": o.apiKey,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      })
    } catch (e: any) {
      throw new KitApiError("error", null, e?.name === "AbortError" ? `przekroczono ${o.timeoutMs} ms` : e?.message ?? "network error")
    } finally {
      clearTimeout(timer)
    }
    let json: any = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { status: res.status, json }
  }

  function map(status: number, json: any, path: string): never {
    const msg = Array.isArray(json?.errors) && json.errors[0] ? String(json.errors[0]) : json?.message ?? json?.error ?? `HTTP ${status}`
    const kind: KitErrorKind =
      status === 401 || status === 403 ? "auth" : status === 404 ? "not_found" : status === 429 ? "rate" : status === 422 ? "invalid" : "error"
    const masked = maskKitSecrets(msg, o.apiKey)
    logger.warn(`[kit] ${path}: ${masked}`)
    throw new KitApiError(kind, status, masked)
  }

  return {
    apiKey: o.apiKey,
    source: o.source,

    /** GET /v4/account - the account behind the key (the connection check). */
    async account(): Promise<KitAccount> {
      const { status, json } = await request("GET", "/v4/account")
      if (status !== 200) map(status, json, "GET /v4/account")
      const a = json?.account ?? json
      return {
        id: String(a?.id ?? ""),
        name: typeof a?.name === "string" ? a.name : null,
        plan_type: typeof a?.plan_type === "string" ? a.plan_type : null,
        primary_email_address: typeof a?.primary_email_address === "string" ? a.primary_email_address : null,
      }
    },

    /** GET /v4/tags - the account's tags, for the settings select. */
    async tags(): Promise<KitTag[]> {
      const { status, json } = await request("GET", "/v4/tags")
      if (status !== 200) map(status, json, "GET /v4/tags")
      const list = Array.isArray(json?.tags) ? json.tags : []
      return list.map((t: any) => ({ id: Number(t.id), name: String(t.name ?? ""), created_at: t.created_at, subscriber_count: t.subscriber_count }))
    },

    /** GET /v4/forms?type=embed - the account's forms, for the double opt-in select. */
    async forms(): Promise<KitForm[]> {
      const { status, json } = await request("GET", "/v4/forms?type=embed")
      if (status !== 200) map(status, json, "GET /v4/forms")
      const list = Array.isArray(json?.forms) ? json.forms : []
      return list.map((f: any) => ({ id: Number(f.id), name: typeof f.name === "string" ? f.name : null, type: f.type ?? null, status: f.status ?? null, is_double_opt_in: f.is_double_opt_in ?? null }))
    },

    /**
     * POST /v4/subscribers - an upsert by email. `state: "inactive"` creates a
     * subscriber that waits for the form's confirmation (double opt-in).
     * Returns the subscriber and whether it was created (201) or already there.
     */
    async createSubscriber(input: { email: string; firstName?: string; state: "active" | "inactive"; fields?: Record<string, string> }): Promise<{ subscriber: KitSubscriber; created: boolean }> {
      const { status, json } = await request("POST", "/v4/subscribers", {
        email_address: input.email,
        ...(input.firstName ? { first_name: input.firstName } : {}),
        state: input.state,
        fields: input.fields ?? {},
      })
      if (status !== 200 && status !== 201 && status !== 202) map(status, json, "POST /v4/subscribers")
      const s = json?.subscriber ?? null
      return {
        created: status === 201,
        subscriber: {
          id: Number(s?.id ?? 0),
          first_name: typeof s?.first_name === "string" ? s.first_name : null,
          email_address: String(s?.email_address ?? input.email),
          state: String(s?.state ?? "unknown"),
          created_at: typeof s?.created_at === "string" ? s.created_at : new Date().toISOString(),
          fields: (s?.fields ?? {}) as Record<string, string>,
        },
      }
    },

    /** POST /v4/tags/{tagId}/subscribers/{id} - apply one tag. */
    async tagSubscriber(subscriberId: number, tagId: number): Promise<void> {
      const { status, json } = await request("POST", `/v4/tags/${tagId}/subscribers/${subscriberId}`, {})
      if (status !== 200 && status !== 201) map(status, json, `POST /v4/tags/${tagId}/subscribers/${subscriberId}`)
    },

    /** POST /v4/forms/{formId}/subscribers/{id} - the double opt-in form sends the confirmation. */
    async addToForm(subscriberId: number, formId: number, referrer: string | null): Promise<void> {
      const { status, json } = await request("POST", `/v4/forms/${formId}/subscribers/${subscriberId}`, { referrer: referrer ?? "" })
      if (status !== 200 && status !== 201) map(status, json, `POST /v4/forms/${formId}/subscribers/${subscriberId}`)
    },

    /** GET /v4/subscribers?email_address= - one subscriber by email (customer summary). */
    async subscriberByEmail(email: string): Promise<KitSubscriber | null> {
      const { status, json } = await request("GET", `/v4/subscribers?email_address=${encodeURIComponent(email)}`)
      if (status !== 200) map(status, json, "GET /v4/subscribers")
      const list = Array.isArray(json?.subscribers) ? json.subscribers : []
      const s = list[0] ?? null
      if (!s) return null
      return {
        id: Number(s.id ?? 0),
        first_name: typeof s.first_name === "string" ? s.first_name : null,
        email_address: String(s.email_address ?? email),
        state: String(s.state ?? "unknown"),
        created_at: typeof s.created_at === "string" ? s.created_at : "",
        fields: (s.fields ?? {}) as Record<string, string>,
      }
    },
    /** GET /v4/account/email_stats - opens, clicks and unsubscribes of the last 90 days. */
    async emailStats(): Promise<KitEmailStats> {
      const { status, json } = await request("GET", "/v4/account/email_stats")
      if (status !== 200) map(status, json, "GET /v4/account/email_stats")
      const st = json?.stats ?? {}
      return { sent: n(st.sent), opened: n(st.opened), clicked: n(st.clicked), open_rate: n(st.open_rate), click_rate: n(st.click_rate), unsubscribe_rate: n(st.unsubscribe_rate), bounce_rate: n(st.bounce_rate) }
    },

    /** GET /v4/account/growth_stats - new subscribers and cancellations between two days (YYYY-MM-DD). */
    async growth(starting: string, ending: string): Promise<KitGrowth> {
      const { status, json } = await request("GET", `/v4/account/growth_stats?starting=${starting}&ending=${ending}`)
      if (status !== 200) map(status, json, "GET /v4/account/growth_stats")
      const st = json?.stats ?? {}
      return { subscribers: n(st.subscribers), new_subscribers: n(st.new_subscribers), cancellations: Math.abs(n(st.cancellations)), net_new_subscribers: n(st.net_new_subscribers), starting: String(st.starting ?? starting), ending: String(st.ending ?? ending) }
    },

    /** The number of active subscribers (one page of one, with the total count). */
    async subscriberCount(): Promise<number> {
      const { status, json } = await request("GET", "/v4/subscribers?per_page=1&include_total_count=true")
      if (status !== 200) map(status, json, "GET /v4/subscribers")
      return n(json?.pagination?.total_count)
    },

    /** GET /v4/broadcasts - the newest campaigns, drafts included. */
    async broadcasts(perPage: number): Promise<KitBroadcast[]> {
      const { status, json } = await request("GET", `/v4/broadcasts?per_page=${Math.min(50, Math.max(1, perPage))}`)
      if (status !== 200) map(status, json, "GET /v4/broadcasts")
      const list = Array.isArray(json?.broadcasts) ? json.broadcasts : []
      return list.map((b: any) => ({
        id: n(b.id),
        subject: typeof b.subject === "string" ? b.subject : null,
        status: typeof b.status === "string" ? b.status : null,
        public: Boolean(b.public),
        public_url: typeof b.public_url === "string" ? b.public_url : null,
        published_at: typeof b.published_at === "string" ? b.published_at : null,
        send_at: typeof b.send_at === "string" ? b.send_at : null,
        created_at: typeof b.created_at === "string" ? b.created_at : null,
      }))
    },

    /** GET /v4/broadcasts/{id}/stats - recipients, opens, clicks, unsubscribes. */
    async broadcastStats(id: number): Promise<KitBroadcastStats> {
      const { status, json } = await request("GET", `/v4/broadcasts/${id}/stats`)
      if (status !== 200) map(status, json, `GET /v4/broadcasts/${id}/stats`)
      const st = json?.broadcast?.stats ?? {}
      return { recipients: n(st.recipients), open_rate: n(st.open_rate), click_rate: n(st.click_rate), unsubscribes: n(st.unsubscribes), unsubscribe_rate: n(st.unsubscribe_rate), total_clicks: n(st.total_clicks), status: typeof st.status === "string" ? st.status : null }
    },

    /** POST /v4/tags - creates a tag; Kit answers with the existing one when the name is taken. */
    async createTag(name: string): Promise<KitTag> {
      const { status, json } = await request("POST", "/v4/tags", { name })
      if (status !== 200 && status !== 201) map(status, json, "POST /v4/tags")
      return { id: n(json?.tag?.id), name: String(json?.tag?.name ?? name) }
    },
  }
}

export type KitClient = ReturnType<typeof createKitClient>
