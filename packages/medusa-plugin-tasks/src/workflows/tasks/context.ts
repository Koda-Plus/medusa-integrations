/**
 * THE REQUEST CONTEXT: who asks, and the board they work on. Every admin
 * route of the plugin calls `contextOf` first and hands the result to the
 * flows; the flows reach the database only through the store of that board.
 *
 * The rules are in `lib/actor.ts`. Here: reading the admin user, or the
 * secret API key and the admin user who created it, from Medusa, with a
 * short cache (a minute) so a board that polls does not ask the user module
 * on every request.
 *
 * FAIL CLOSED. When sandbox accounts are configured and the account behind a
 * request cannot be read, the request is refused (503) rather than guessed:
 * a sandbox account must never land on the main board because a lookup
 * failed. Without sandbox accounts every board decision is `main` anyway, and
 * a failed lookup only costs the display name.
 */

import { Modules } from "@medusajs/framework/utils"
import { PEOPLE_MAX, PROFILE_TTL_MS } from "../../modules/tasks/lib/constants"
import { apiKeyContext, keyName, reservedNames, userContext, type ApiKeyProfile, type RequestContext, type UserProfile } from "../../modules/tasks/lib/actor"
import { isSandboxEmail, normalizeEmail } from "../../modules/tasks/lib/options"
import { ActionError, envOf, resolveOptional, type Scope } from "./runtime"

export type { RequestContext }

/** The part of `req.auth_context` the plugin reads. */
export interface AuthLike {
  actor_id?: string | null
  actor_type?: string | null
}

interface UserModuleLike {
  listUsers(filters: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>
}

interface ApiKeyModuleLike {
  listApiKeys(filters: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<Record<string, unknown>>>
}

const USER_FIELDS = ["id", "email", "first_name", "last_name", "avatar_url"]

function toProfile(u: Record<string, unknown>): UserProfile | null {
  if (typeof u?.id !== "string") return null
  return {
    id: u.id,
    email: normalizeEmail(u.email) ?? (typeof u.email === "string" ? u.email : null),
    first_name: typeof u.first_name === "string" ? u.first_name : null,
    last_name: typeof u.last_name === "string" ? u.last_name : null,
    avatar_url: typeof u.avatar_url === "string" ? u.avatar_url : null,
  }
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

const CACHE_KEY = Symbol.for("koda.tasks.profiles")
type Cached<T> = { at: number; value: T }
type CacheHolder = typeof globalThis & {
  [CACHE_KEY]?: { users: Map<string, Cached<UserProfile | null>>; keys: Map<string, Cached<ApiKeyProfile | null>>; team: Map<string, Cached<Set<string>>> }
}

function cache() {
  const holder = globalThis as CacheHolder
  if (!holder[CACHE_KEY]?.team) holder[CACHE_KEY] = { users: new Map(), keys: new Map(), team: new Map() }
  return holder[CACHE_KEY] as NonNullable<CacheHolder[typeof CACHE_KEY]>
}

function fresh<T>(entry: Cached<T> | undefined): entry is Cached<T> {
  return Boolean(entry) && Date.now() - (entry as Cached<T>).at < PROFILE_TTL_MS
}

function remember<T>(map: Map<string, Cached<T>>, key: string, value: T): void {
  if (map.size > 1000) map.clear()
  map.set(key, { at: Date.now(), value })
}

/** Forgets every cached profile and key (tests, or right after an account changed). */
export function forgetProfiles(): void {
  const c = cache()
  c.users.clear()
  c.keys.clear()
  c.team.clear()
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/** Admin users by id, from the cache or the user module. Throws when the module cannot be read. */
export async function userProfiles(scope: Scope, ids: readonly string[]): Promise<Map<string, UserProfile>> {
  const out = new Map<string, UserProfile>()
  const c = cache()
  const missing: string[] = []
  for (const id of new Set(ids.filter((v) => typeof v === "string" && v))) {
    const hit = c.users.get(id)
    if (fresh(hit)) {
      if (hit.value) out.set(id, hit.value)
    } else missing.push(id)
  }
  if (missing.length === 0) return out
  const users = resolveOptional<UserModuleLike>(scope, Modules.USER)
  if (!users) throw new Error("The user module is not available")
  const rows = await users.listUsers({ id: missing }, { select: USER_FIELDS, take: missing.length })
  const found = new Map<string, UserProfile>()
  for (const r of rows) {
    const p = toProfile(r)
    if (p) found.set(p.id, p)
  }
  for (const id of missing) {
    const p = found.get(id) ?? null
    remember(c.users, id, p)
    if (p) out.set(id, p)
  }
  return out
}

export async function userProfile(scope: Scope, id: string): Promise<UserProfile | null> {
  return (await userProfiles(scope, [id])).get(id) ?? null
}

/** Admin users by e-mail (not cached: assignment by e-mail and the sandbox people list). */
export async function usersByEmail(scope: Scope, emails: readonly string[]): Promise<UserProfile[]> {
  const wanted = [...new Set(emails.map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e)))]
  if (wanted.length === 0) return []
  const users = resolveOptional<UserModuleLike>(scope, Modules.USER)
  if (!users) throw new Error("The user module is not available")
  const rows = await users.listUsers({ email: wanted }, { select: USER_FIELDS, take: wanted.length * 2 })
  return rows.map(toProfile).filter((p): p is UserProfile => p !== null && wanted.includes(normalizeEmail(p.email) ?? ""))
}

/** Every admin user, for the assignee picker. */
export async function allUsers(scope: Scope, take: number): Promise<UserProfile[]> {
  const users = resolveOptional<UserModuleLike>(scope, Modules.USER)
  if (!users) return []
  const rows = await users.listUsers({}, { select: USER_FIELDS, take, order: { email: "ASC" } })
  return rows.map(toProfile).filter((p): p is UserProfile => p !== null)
}

/** A secret API key by id: its title and the admin user who created it. */
export async function apiKeyProfile(scope: Scope, id: string): Promise<ApiKeyProfile | null> {
  const c = cache()
  const hit = c.keys.get(id)
  if (fresh(hit)) return hit.value
  const keys = resolveOptional<ApiKeyModuleLike>(scope, Modules.API_KEY)
  if (!keys) throw new Error("The API key module is not available")
  const [row] = await keys.listApiKeys({ id }, { select: ["id", "title", "created_by"], take: 1 })
  const value: ApiKeyProfile | null =
    row && typeof row.id === "string"
      ? { id: row.id, title: typeof row.title === "string" ? row.title : null, created_by: typeof row.created_by === "string" ? row.created_by : null }
      : null
  remember(c.keys, id, value)
  return value
}

/** The names a key may not sign with (`lib/actor.ts`), from the first admin users and `people`, cached for a minute. */
export async function teamNames(scope: Scope): Promise<Set<string>> {
  const c = cache()
  const hit = c.team.get("names")
  if (fresh(hit)) return hit.value
  const users = resolveOptional<UserModuleLike>(scope, Modules.USER)
  if (!users) throw new Error("The user module is not available")
  const rows = await users.listUsers({}, { select: USER_FIELDS, take: PEOPLE_MAX, order: { email: "ASC" } })
  const value = reservedNames(rows.map(toProfile).filter((p): p is UserProfile => p !== null), envOf(scope).options.people)
  remember(c.team, "names", value)
  return value
}

/* ------------------------------------------------------------------ */
/* The context                                                         */
/* ------------------------------------------------------------------ */

/**
 * The context of an admin request: its auth context (`req.auth_context`) and
 * its body (scripts sign with `author`). Refuses requests without an admin
 * user or a secret API key (401), and unreadable accounts while sandbox
 * accounts exist (503).
 */
export async function contextOf(scope: Scope, auth: AuthLike | null | undefined, body?: unknown): Promise<RequestContext> {
  const { options } = envOf(scope)
  const strict = options.sandboxAccounts.length > 0
  const actorId = typeof auth?.actor_id === "string" && auth.actor_id ? auth.actor_id : null
  const actorType = auth?.actor_type
  const author = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).author : undefined
  if (!actorId) throw new ActionError(401, "unauthorized", "Sign in to the admin, or send a secret API key.")

  if (actorType === "api-key") {
    let key: ApiKeyProfile | null
    let creator: UserProfile | null = null
    try {
      key = await apiKeyProfile(scope, actorId)
      if (key?.created_by) creator = await userProfile(scope, key.created_by)
    } catch {
      if (strict) throw new ActionError(503, "account_unavailable", "The API key could not be checked. Try again in a moment.")
      key = { id: actorId, title: null, created_by: null }
    }
    if (!key) throw new ActionError(401, "unauthorized", "Unknown API key.")
    /* With sandbox accounts, a key whose creator is gone cannot prove which board it belongs to. */
    if (strict && key.created_by && !creator) {
      throw new ActionError(403, "key_owner_missing", "The admin user who created this API key no longer exists. Create a new key.")
    }
    const sandbox = isSandboxEmail(creator?.email, options)
    let reserved: Set<string> = new Set()
    try {
      reserved = await teamNames(scope)
    } catch {
      /* Without the team's names a sent name cannot be checked: refused on the main board, dropped on the sandbox. */
      if (author !== undefined && author !== null && author !== "" && !sandbox) {
        throw new ActionError(503, "account_unavailable", "The name in author could not be checked. Try again in a moment.")
      }
      reserved = new Set(["*"])
    }
    const signed = reserved.has("*") ? { name: null, refused: false } : keyName(author, key.title, reserved, sandbox)
    if (signed.refused) {
      throw new ActionError(400, "author_reserved", "author is the name or e-mail of a person on the team. A key signs with its own name, like \"Claude Code\".", {
        errors: [{ field: "author", code: "author_reserved", message: "A person on the team has this name or e-mail." }],
      })
    }
    const ctx = apiKeyContext(key, creator, undefined, options)
    return { ...ctx, actor: { ...ctx.actor, name: signed.name } }
  }

  if (actorType !== "user" && actorType !== undefined && actorType !== null) {
    throw new ActionError(401, "unauthorized", "Only admin users and secret API keys can use the board.")
  }
  let profile: UserProfile | null
  try {
    profile = await userProfile(scope, actorId)
  } catch {
    if (strict) throw new ActionError(503, "account_unavailable", "Your account could not be checked. Try again in a moment.")
    profile = { id: actorId, email: null }
  }
  if (!profile) throw new ActionError(401, "unauthorized", "Unknown admin user.")
  return userContext(profile, options)
}
