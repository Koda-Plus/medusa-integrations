import { DEFAULT_SANDBOX_RESET_HOURS, MAX_SANDBOX_RESET_HOURS } from "./constants"
import { normalizePeople, type NamedPerson, type PersonOption } from "./people"
import { normalizeReferences, type TasksReference, type TasksReferenceOption } from "./references"

/**
 * Options of `@koda-plus/medusa-plugin-tasks`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-tasks", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting: a
 * value that does not make sense falls back to its default. Lists may come
 * as one comma separated string (an environment variable).
 */
export interface TasksPluginOptions {
  /**
   * Admin user e-mails that only ever see and change the sandbox board: sample
   * tasks, seeded the first time the board is opened, apart from the team's
   * board on every route. For a public demo account. Default: none.
   */
  sandboxAccounts?: string[] | string
  /** Hours after which the sandbox board is seeded again on its next opening. 0: only on "Reset the sandbox". Default 24. */
  sandboxResetHours?: number | string
  /**
   * Admin users whose comments are marked as the agency's: e-mails, or whole
   * domains as `@agency.com`. Everyone else writes as the store team.
   * Default: none.
   */
  agencyAccounts?: string[] | string
  /**
   * Faces for free text names on the board (assignees and comment authors
   * such as "Koda AI"): `{ name, avatar?, role?, kind? }`, with
   * `kind: "agent"` for an AI agent or an automation. Shown next to the admin
   * users in the assignee picker. Default: none.
   */
  people?: PersonOption[]
  /** Stores running the plugin, shown on the Tasks page and in the setup guide. Default: none. */
  references?: TasksReferenceOption[]
  /**
   * Keeps sandbox accounts (and keys they created) inside Tasks: off by
   * default, because it refuses admin routes the rest of the store may need.
   * `true`, or `{ allowWrites: ["/admin/views"] }` for more prefixes a
   * sandbox account may write to. With it, sandbox accounts cannot read or
   * create invites, admin users, API keys, workflow executions or
   * notifications outside the feed, and cannot write anywhere outside
   * `/admin/tasks` (their own profile: only the language form).
   */
  sandboxGuard?: boolean | { allowWrites?: string[] | string }
  /** Events of the sandbox board: `"skip"` (default) or `"emit"` (with `demo: true`). */
  sandboxEvents?: "skip" | "emit"
  /**
   * Limits of the shared sandbox board: tasks on it, comments per task and
   * changes per minute per account. Default 200, 50 and 60. `false` lifts them.
   */
  sandboxLimits?: false | { tasks?: number | string; commentsPerTask?: number | string; writesPerMinute?: number | string }
  /**
   * What the sample tasks link to: `"product"` (default: the newest product
   * only), `"all"` (also the newest order and its customer, for stores with
   * demo data only) or `"none"`.
   */
  sandboxSeedLinks?: "product" | "all" | "none"
  /**
   * Secret API keys whose title starts with this text (without case) reach
   * only the Tasks routes: every other admin route answers 403. Default
   * `"tasks:"`, so a key titled "tasks: Claude Code" is a key for an AI agent
   * that cannot touch orders, customers or settings. `false` turns it off.
   */
  agentKeyPrefix?: string | false
}

export type SandboxSeedLinks = "product" | "all" | "none"

export interface SandboxLimits {
  /** 0: no limit. */
  tasks: number
  commentsPerTask: number
  writesPerMinute: number
}

export interface ResolvedTasksOptions {
  /** Lower case e-mails. */
  sandboxAccounts: string[]
  sandboxResetHours: number
  /** Lower case e-mails and `@domain` entries. */
  agencyAccounts: string[]
  people: NamedPerson[]
  references: TasksReference[]
  sandboxGuard: { enabled: boolean; allowWrites: string[] }
  sandboxEvents: "skip" | "emit"
  sandboxLimits: SandboxLimits
  sandboxSeedLinks: SandboxSeedLinks
  /** Lower case; empty when agent keys are off. */
  agentKeyPrefix: string
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = { tasks: 200, commentsPerTask: 50, writesPerMinute: 60 }
export const DEFAULT_AGENT_KEY_PREFIX = "tasks:"

const LIST_MAX = 50
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/** A list option as strings: an array, or one comma (or whitespace) separated string. */
function entries(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\s]+/) : []
  return raw.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()).filter(Boolean)
}

/** A lower case e-mail, or null. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim().toLowerCase()
  return s.length <= 254 && EMAIL.test(s) ? s : null
}

function emails(value: unknown): string[] {
  const out: string[] = []
  for (const e of entries(value)) {
    const email = normalizeEmail(e)
    if (email && !out.includes(email)) out.push(email)
    if (out.length >= LIST_MAX) break
  }
  return out
}

/** E-mails and domains: `@agency.com` (a bare `agency.com` counts as the domain too). */
function emailsAndDomains(value: unknown): string[] {
  const out: string[] = []
  for (const e of entries(value)) {
    const email = normalizeEmail(e)
    const domain = email ? null : e.replace(/^@/, "")
    const entry = email ?? (domain && DOMAIN.test(domain) ? `@${domain}` : null)
    if (entry && !out.includes(entry)) out.push(entry)
    if (out.length >= LIST_MAX) break
  }
  return out
}

/** An integer within bounds; the fallback for anything that is not a number. */
export function bounded(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v)
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** Admin route prefixes a sandbox account may write to besides `/admin/tasks`: `/admin/...` paths, lower case. */
function adminPrefixes(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\s]+/) : []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== "string") continue
    const p = v.trim().toLowerCase().replace(/\/+$/, "")
    if (!/^\/admin\/[a-z0-9][a-z0-9_\-/]*$/.test(p) || p.includes("//") || out.includes(p)) continue
    out.push(p)
    if (out.length >= LIST_MAX) break
  }
  return out
}

function guardOf(value: unknown): ResolvedTasksOptions["sandboxGuard"] {
  if (value === true || value === "true") return { enabled: true, allowWrites: [] }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { enabled: true, allowWrites: adminPrefixes((value as { allowWrites?: unknown }).allowWrites) }
  }
  return { enabled: false, allowWrites: [] }
}

function limitsOf(value: unknown): SandboxLimits {
  if (value === false || value === "false") return { tasks: 0, commentsPerTask: 0, writesPerMinute: 0 }
  const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    tasks: bounded(v.tasks, DEFAULT_SANDBOX_LIMITS.tasks, 0, 10_000),
    commentsPerTask: bounded(v.commentsPerTask, DEFAULT_SANDBOX_LIMITS.commentsPerTask, 0, 10_000),
    writesPerMinute: bounded(v.writesPerMinute, DEFAULT_SANDBOX_LIMITS.writesPerMinute, 0, 10_000),
  }
}

function agentPrefixOf(value: unknown): string {
  if (value === false || value === "") return ""
  if (typeof value !== "string") return DEFAULT_AGENT_KEY_PREFIX
  const p = value.trim().toLowerCase().slice(0, 40)
  return p.length >= 2 ? p : DEFAULT_AGENT_KEY_PREFIX
}

export function resolveOptions(o: TasksPluginOptions | undefined | null): ResolvedTasksOptions {
  const opts = o && typeof o === "object" ? o : {}
  return {
    sandboxAccounts: emails(opts.sandboxAccounts),
    sandboxResetHours: bounded(opts.sandboxResetHours, DEFAULT_SANDBOX_RESET_HOURS, 0, MAX_SANDBOX_RESET_HOURS),
    agencyAccounts: emailsAndDomains(opts.agencyAccounts),
    people: normalizePeople(opts.people),
    references: normalizeReferences(opts.references),
    sandboxGuard: guardOf(opts.sandboxGuard),
    sandboxEvents: opts.sandboxEvents === "emit" ? "emit" : "skip",
    sandboxLimits: limitsOf(opts.sandboxLimits),
    sandboxSeedLinks: opts.sandboxSeedLinks === "all" || opts.sandboxSeedLinks === "none" ? opts.sandboxSeedLinks : "product",
    agentKeyPrefix: agentPrefixOf(opts.agentKeyPrefix),
  }
}

/** True for the title of a secret API key meant for an AI agent: it reaches only the Tasks routes. */
export function isAgentKeyTitle(title: unknown, options: Pick<ResolvedTasksOptions, "agentKeyPrefix">): boolean {
  if (!options.agentKeyPrefix || typeof title !== "string") return false
  return title.trim().toLowerCase().startsWith(options.agentKeyPrefix)
}

/** True for an e-mail on the sandbox list. Unknown or missing e-mails are not sandbox accounts. */
export function isSandboxEmail(email: unknown, options: Pick<ResolvedTasksOptions, "sandboxAccounts">): boolean {
  const e = normalizeEmail(email)
  return e !== null && options.sandboxAccounts.includes(e)
}

/** True for an e-mail on the agency list, by the address or by its domain. */
export function isAgencyEmail(email: unknown, options: Pick<ResolvedTasksOptions, "agencyAccounts">): boolean {
  const e = normalizeEmail(email)
  if (!e) return false
  const domain = `@${e.slice(e.lastIndexOf("@") + 1)}`
  return options.agencyAccounts.includes(e) || options.agencyAccounts.includes(domain)
}
