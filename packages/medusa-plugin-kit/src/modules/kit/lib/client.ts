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
  }
}

export type KitClient = ReturnType<typeof createKitClient>
