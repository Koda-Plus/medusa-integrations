/**
 * Options of `@koda-plus/medusa-plugin-kit`.
 *
 * The plugin subscribes the storefront newsletter form to the store's Kit
 * account (the Kit API v4, authenticated with the account's API key):
 * a subscriber is created or updated, tagged, and - with double opt-in
 * switched on - added to the configured double opt-in form, which makes Kit
 * send the confirmation email.
 *
 * NOTHING HERE THROWS. Missing options never break the boot: without an API
 * key the plugin says "Not configured" and the store route answers politely.
 * Numbers may come as strings (environment variables).
 */

export interface KitPluginOptions {
  /** The Kit API v4 key (Kit: Settings, Developer, API keys). Never leaves the server. */
  apiKey?: string
  /** The source shown in Kit for subscribers ("My Store"). Default: "Medusa". */
  source?: string
  /** A subscriber in the `inactive` state waits for the form's confirmation (double opt-in). Default false. */
  doubleOptIn?: boolean | string
  /** The double opt-in form (id) new subscribers are added to. Default: none. */
  formId?: number | string
  /** Tag ids applied to every new subscriber. Default: none. */
  tags?: Array<number | string> | string
  /** Self-imposed rate limit towards Kit. Default 90 per minute (Kit allows 120). */
  requestsPerMinute?: number | string
  /** Timeout of one Kit request in ms. Default 20000. */
  timeoutMs?: number | string
  /** The public storefront address, the referrer of form submissions. */
  storefrontUrl?: string
}

export interface ResolvedKitOptions {
  apiKey: string
  source: string
  doubleOptIn: boolean
  formId: number | null
  tags: number[]
  requestsPerMinute: number
  timeoutMs: number
  storefrontUrl: string | null
  /** Option values that were ignored, for the admin. */
  problems: string[]
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (v === undefined || v === null || v === "") return fallback
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function intList(v: unknown): { ids: number[]; bad: number } {
  if (v === undefined || v === null || v === "") return { ids: [], bad: 0 }
  const parts = Array.isArray(v) ? v : String(v).split(",")
  const ids: number[] = []
  let bad = 0
  for (const p of parts) {
    const n = Number(String(p).trim())
    if (Number.isInteger(n) && n > 0) ids.push(n)
    else bad += 1
  }
  return { ids: [...new Set(ids)], bad }
}

export function resolveOptions(input: KitPluginOptions | undefined | null): ResolvedKitOptions {
  const o = (input && typeof input === "object" ? input : {}) as KitPluginOptions
  const problems: string[] = []
  const apiKey = str(o.apiKey)
  const source = str(o.source) || "Medusa"
  const doubleOptIn = o.doubleOptIn === true || o.doubleOptIn === "true"
  const formId = o.formId === undefined || o.formId === null || o.formId === "" ? null : Number(o.formId)
  if (formId !== null && (!Number.isInteger(formId) || formId <= 0)) problems.push("formId (a Kit form id)")
  const tags = intList(o.tags)
  if (tags.bad > 0) problems.push(`tags (${tags.bad} value(s) were not tag ids)`)
  const url = str(o.storefrontUrl)
  const storefrontUrl = /^https?:\/\//i.test(url) ? url.replace(/\/+$/, "") : url ? (problems.push("storefrontUrl (an http(s) address)"), null) : null
  return {
    apiKey,
    source,
    doubleOptIn,
    formId: formId !== null && Number.isInteger(formId) && formId > 0 ? formId : null,
    tags: tags.ids,
    requestsPerMinute: num(o.requestsPerMinute, 90, 1, 120),
    timeoutMs: num(o.timeoutMs, 20_000, 1_000, 60_000),
    storefrontUrl,
    problems,
  }
}

/** Options live mode still needs; the admin lists them. */
export function missingOptions(o: ResolvedKitOptions): string[] {
  const missing: string[] = []
  if (!o.apiKey) missing.push("apiKey")
  return missing
}
