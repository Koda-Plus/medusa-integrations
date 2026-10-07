/**
 * WHO IS ASKING, AND WHICH BOARD THEY WORK ON. Pure, tested with `node --test`.
 *
 * Every admin route of the plugin starts here (`workflows/tasks/context.ts`
 * reads the request's auth context and the records behind it):
 *
 *   an admin user     works on the sandbox board when their e-mail is in
 *                     `sandboxAccounts`, on the main board otherwise; writes
 *                     as `agency` when the e-mail (or its domain) is in
 *                     `agencyAccounts`, as `client` (the store team) otherwise
 *   a secret API key  works on the board of the admin user who created it
 *                     (a key created by a sandbox account stays in the
 *                     sandbox); writes as `claude`, shown as "AI agent", under
 *                     the name the request sends (`author`), else the key's
 *                     title
 *
 * The board is decided here and nowhere else: a request body or a query
 * parameter never chooses it.
 */

import { MAIN_BOARD, SANDBOX_BOARD, type ActorType, type AuthorRole, type Board } from "./constants"
import { isAgencyEmail, isSandboxEmail, type ResolvedTasksOptions } from "./options"
import { cleanDisplayName, cleanLine } from "./text"

export interface UserProfile {
  id: string
  email: string | null
  first_name?: string | null
  last_name?: string | null
  avatar_url?: string | null
}

export interface ApiKeyProfile {
  id: string
  title: string | null
  /** The admin user who created the key. */
  created_by: string | null
}

/** Who acted: what activity entries, comments and events record. */
export interface Actor {
  type: ActorType
  id: string | null
  name: string | null
  email: string | null
  role: AuthorRole
}

export interface RequestContext {
  board: Board
  sandbox: boolean
  actor: Actor
}

/** "First Last", else the e-mail, else null. */
export function userName(p: Pick<UserProfile, "email" | "first_name" | "last_name">): string | null {
  const name = cleanLine([p.first_name, p.last_name].filter(Boolean).join(" "), 120)
  return name || (p.email ? p.email : null)
}

export function boardOf(sandbox: boolean): Board {
  return sandbox ? SANDBOX_BOARD : MAIN_BOARD
}

/** The context of an admin user. */
export function userContext(p: UserProfile, options: Pick<ResolvedTasksOptions, "sandboxAccounts" | "agencyAccounts">): RequestContext {
  const sandbox = isSandboxEmail(p.email, options)
  return {
    board: boardOf(sandbox),
    sandbox,
    actor: { type: "user", id: p.id, name: userName(p), email: p.email ?? null, role: isAgencyEmail(p.email, options) ? "agency" : "client" },
  }
}

/**
 * The context of a secret API key. `creator` is the admin user behind
 * `created_by`, or null when the key has none: such a key was made by server
 * code (a seed, a script with the admin's container), never by a sandbox
 * account through the admin, so it works on the main board.
 */
export function apiKeyContext(
  key: ApiKeyProfile,
  creator: UserProfile | null,
  author: unknown,
  options: Pick<ResolvedTasksOptions, "sandboxAccounts">,
): RequestContext {
  const sandbox = isSandboxEmail(creator?.email, options)
  const name = cleanDisplayName(author) ?? cleanDisplayName(key.title)
  return {
    board: boardOf(sandbox),
    sandbox,
    actor: { type: "api-key", id: key.id, name, email: null, role: "claude" },
  }
}

/** The plugin itself (sample tasks, custom code without a person behind it). */
export function systemActor(name: string | null = null): Actor {
  return { type: "system", id: null, name, email: null, role: "agency" }
}
