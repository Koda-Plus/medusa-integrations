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
import { cleanDisplayName, cleanLine, foldKey } from "./text"

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

/** A name or e-mail as the reserved names compare it: one line, without case and accents. */
export function nameKey(value: string): string {
  return foldKey(cleanLine(value, 254))
}

/**
 * The names a secret API key may not sign with: the full name and e-mail of
 * every admin user, and the names in `people` that are people (not agents).
 * A key that could sign as "Olga Owner" would look like Olga on the board.
 */
export function reservedNames(users: ReadonlyArray<Pick<UserProfile, "email" | "first_name" | "last_name">>, people: ReadonlyArray<{ name: string; kind: string }>): Set<string> {
  const out = new Set<string>()
  for (const u of users) {
    const name = userName(u)
    if (name) out.add(nameKey(name))
    if (u.email) out.add(nameKey(u.email))
  }
  for (const p of people) if (p.kind !== "agent" && p.name) out.add(nameKey(p.name))
  out.delete("")
  return out
}

/**
 * The name a key signs with: the `author` it sends, else its title. A
 * reserved `author` is refused on the main board (`refused`) and dropped on
 * the sandbox board, where a refusal would tell a public visitor who is on
 * the team; a reserved title signs with no name (shown as "AI agent").
 */
export function keyName(author: unknown, title: string | null, reserved: ReadonlySet<string>, sandbox: boolean): { name: string | null; refused: boolean } {
  const sent = cleanDisplayName(author)
  if (sent && reserved.has(nameKey(sent))) {
    if (!sandbox) return { name: null, refused: true }
  } else if (sent) {
    return { name: sent, refused: false }
  }
  const fallback = cleanDisplayName(title)
  return { name: fallback && !reserved.has(nameKey(fallback)) ? fallback : null, refused: false }
}

/**
 * The context of a secret API key. `creator` is the admin user behind
 * `created_by`, or null when the key has none: such a key was made by server
 * code (a seed, a script with the admin's container), never by a sandbox
 * account through the admin, so it works on the main board. `name` comes from
 * `keyName` (the reserved names already applied).
 */
export function apiKeyContext(
  key: ApiKeyProfile,
  creator: UserProfile | null,
  author: unknown,
  options: Pick<ResolvedTasksOptions, "sandboxAccounts">,
  reserved: ReadonlySet<string> = new Set(),
): RequestContext {
  const sandbox = isSandboxEmail(creator?.email, options)
  const { name } = keyName(author, key.title, reserved, sandbox)
  return {
    board: boardOf(sandbox),
    sandbox,
    actor: { type: "api-key", id: key.id, name, email: null, role: "claude" },
  }
}

/**
 * The plugin itself or custom code without a person behind it (a subscriber,
 * a job): an automation, so its comments read as `claude` ("AI agent")
 * unless the workflow input names another role.
 */
export function systemActor(name: string | null = null, role: AuthorRole = "claude"): Actor {
  return { type: "system", id: null, name, email: null, role }
}
