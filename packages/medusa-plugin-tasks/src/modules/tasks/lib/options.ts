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
}

export interface ResolvedTasksOptions {
  /** Lower case e-mails. */
  sandboxAccounts: string[]
  sandboxResetHours: number
  /** Lower case e-mails and `@domain` entries. */
  agencyAccounts: string[]
  people: NamedPerson[]
  references: TasksReference[]
}

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

export function resolveOptions(o: TasksPluginOptions | undefined | null): ResolvedTasksOptions {
  const opts = o && typeof o === "object" ? o : {}
  return {
    sandboxAccounts: emails(opts.sandboxAccounts),
    sandboxResetHours: bounded(opts.sandboxResetHours, DEFAULT_SANDBOX_RESET_HOURS, 0, MAX_SANDBOX_RESET_HOURS),
    agencyAccounts: emailsAndDomains(opts.agencyAccounts),
    people: normalizePeople(opts.people),
    references: normalizeReferences(opts.references),
  }
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
