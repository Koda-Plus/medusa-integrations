/**
 * THE ADMIN GUARD: what a sandbox account and an AI agent's key may reach in
 * the rest of the admin API. Pure, tested with `node --test`; the middleware
 * in `src/api/middlewares.ts` feeds it the request and the account behind it.
 *
 * Two rules, both decided on the server from the account, never from the
 * request:
 *
 *   an agent key   a secret API key whose title starts with `agentKeyPrefix`
 *                  ("tasks:" by default) reaches `/admin/tasks` and nothing
 *                  else: an AI agent that reads e-mails or web pages can be
 *                  talked into anything, so its key never opens orders,
 *                  customers, refunds, users or keys
 *   a sandbox      with `sandboxGuard` on, an account in `sandboxAccounts`
 *     account      (and every key it created) cannot read or create invites,
 *                  admin users, API keys, workflow executions or
 *                  notifications outside the feed, and cannot write anywhere
 *                  outside `/admin/tasks` and the `allowWrites` prefixes. Its
 *                  own profile takes only the language form (names unchanged).
 *
 * Paths are compared after decoding, without case, with repeated slashes
 * folded and dot segments resolved, so `/admin//Invites` or
 * `/admin/tasks/../invites` cannot slip past.
 */

export interface GuardActor {
  type: "user" | "api-key"
  /** The admin user behind the request (the user, or the key's creator) is a sandbox account. */
  sandbox: boolean
  /** A secret API key whose title marks it as an AI agent's. */
  agentKey: boolean
  /** The admin user's own id, for a user: they may read their own profile. */
  userId: string | null
}

export interface GuardRequest {
  method: string
  /** The path as requested (`req.originalUrl`), with or without the query. */
  url: string
  /** The parsed query (`channel=feed` for the notification feed). */
  query?: Record<string, unknown>
}

export type GuardDecision =
  | { allow: true; ownProfile?: false }
  /** A write to the account's own profile: allowed only when it changes no name (the runtime compares). */
  | { allow: true; ownProfile: true }
  | { allow: false; status: 403; code: "sandbox_guard" | "agent_key_scope"; message: string }

const READS = new Set(["GET", "HEAD", "OPTIONS"])

/** Admin routes a sandbox account never reaches with the guard on, with the exceptions below. */
export const SANDBOX_CLOSED = ["/admin/invites", "/admin/users", "/admin/api-keys", "/admin/workflows-executions", "/admin/notifications"] as const

export const TASKS_PREFIX = "/admin/tasks"

/**
 * The path of a request as the guard compares it: decoded, lower case,
 * repeated slashes folded, `.` and `..` resolved, no trailing slash. Null
 * when it cannot be decoded (the guard then refuses).
 */
export function normalizeAdminPath(url: string): string | null {
  if (typeof url !== "string") return null
  const raw = url.split(/[?#]/)[0]
  let decoded = raw
  try {
    /* Twice: a path encoded twice ("%252e") decodes to what a lenient router may see. */
    for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(decoded); i++) decoded = decodeURIComponent(decoded)
  } catch {
    return null
  }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null
  const parts: string[] = []
  for (const segment of decoded.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      parts.pop()
      continue
    }
    parts.push(segment.toLowerCase())
  }
  return `/${parts.join("/")}`
}

/** True when `path` is `prefix` or below it, on a segment boundary. */
export function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function single(value: unknown): string | null {
  if (Array.isArray(value)) return value.length === 1 && typeof value[0] === "string" ? value[0] : null
  return typeof value === "string" ? value : null
}

const deny = (code: "sandbox_guard" | "agent_key_scope", message: string): GuardDecision => ({ allow: false, status: 403, code, message })

/** What the guard decides for one request. `allowWrites` are the extra prefixes a sandbox account may write to. */
export function guardDecision(req: GuardRequest, actor: GuardActor, opts: { sandboxGuard: boolean; allowWrites?: readonly string[] }): GuardDecision {
  const path = normalizeAdminPath(req.url)
  const method = String(req.method ?? "GET").toUpperCase()
  if (actor.agentKey) {
    if (!path || !under(path, TASKS_PREFIX)) {
      return deny("agent_key_scope", "This API key is an AI agent's key (its title starts with the agent prefix): it reaches only the Tasks routes.")
    }
  }
  if (!actor.sandbox || !opts.sandboxGuard) return { allow: true }
  if (!path) return deny("sandbox_guard", "This path cannot be read.")
  if (under(path, TASKS_PREFIX)) return { allow: true }

  const closed = SANDBOX_CLOSED.find((p) => under(path, p))
  if (closed) {
    const read = READS.has(method)
    if (closed === "/admin/users" && actor.type === "user" && actor.userId) {
      const own = `/admin/users/${actor.userId.toLowerCase()}`
      if (read && (path === "/admin/users/me" || path === own)) return { allow: true }
      if (method === "POST" && path === own) return { allow: true, ownProfile: true }
    }
    if (closed === "/admin/notifications" && read && path === "/admin/notifications" && single(req.query?.channel) === "feed") return { allow: true }
    return deny("sandbox_guard", "Sandbox accounts do not reach invites, admin users, API keys, workflow executions or notifications.")
  }
  if (READS.has(method)) return { allow: true }
  if ((opts.allowWrites ?? []).some((p) => under(path, p))) return { allow: true }
  return deny("sandbox_guard", "Sandbox accounts change only the sandbox board of Tasks.")
}

/** Body fields the own profile write may carry: the language form sends the names unchanged. */
export const OWN_PROFILE_FIELDS = ["first_name", "last_name", "metadata"] as const

const sameName = (a: unknown, b: unknown) => (typeof a === "string" ? a.trim() : "") === (typeof b === "string" ? b.trim() : "")

/** True when a write to the own profile changes no name and nothing outside `metadata`. */
export function ownProfileWriteAllowed(body: unknown, current: { first_name?: string | null; last_name?: string | null }): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return true
  const b = body as Record<string, unknown>
  for (const key of Object.keys(b)) if (!(OWN_PROFILE_FIELDS as readonly string[]).includes(key)) return false
  if ("first_name" in b && !sameName(b.first_name, current.first_name)) return false
  if ("last_name" in b && !sameName(b.last_name, current.last_name)) return false
  return true
}
