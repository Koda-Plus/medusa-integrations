/**
 * THE SANDBOX BOARD: seeded with the sample tasks of `lib/sandbox.ts` when a
 * sandbox account opens the Tasks page and the board is not seeded yet or is
 * older than `sandboxResetHours` (`POST /admin/tasks/sandbox/ensure`), by the
 * `tasks-sandbox` job every hour after `sandboxResetHours`, and on "Reset
 * the sandbox".
 *
 * READS NEVER SEED. A widget, a counter or a summary only reads the board as
 * it is, so a visitor's open task never disappears under them because some
 * other page asked for the board.
 *
 * A seed replaces everything on the sandbox board, in one transaction under
 * the board's lock, and touches nothing else: the store that does it
 * (`createSandboxStore`) only knows the sandbox board. The marker is read
 * again under that lock, so two instances (or the job and a page) seed once.
 */

import { SANDBOX_KEY } from "../../modules/tasks/lib/constants"
import type { RequestContext } from "../../modules/tasks/lib/actor"
import { userName } from "../../modules/tasks/lib/actor"
import { buildSandboxSeed, sandboxStale, type SeedEntities, type SeedViewer } from "../../modules/tasks/lib/sandbox"
import type { SandboxSeedLinks } from "../../modules/tasks/lib/options"
import { usersByEmail } from "./context"
import { seedEntities } from "./records"
import { ActionError, envOf, newId, sandboxPace, warn, withLock, type Scope } from "./runtime"

export interface SandboxMarker {
  version?: string
  seeded_at?: string
  tasks?: number
}

/** A reset right after another one changes nothing (a double click, or two visitors at once). */
export const RESET_COOLDOWN_MS = 10_000

async function marker(scope: Scope): Promise<SandboxMarker | null> {
  const row = await envOf(scope).stores.settings.get(SANDBOX_KEY)
  const v = row?.value
  return v && typeof v === "object" && !Array.isArray(v) ? (v as SandboxMarker) : null
}

function asMarker(value: unknown): SandboxMarker | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as SandboxMarker) : null
}

/** The sandbox account the sample tasks are assigned to: the first configured one that exists. */
async function seedViewer(scope: Scope, emails: readonly string[]): Promise<SeedViewer | null> {
  try {
    const users = await usersByEmail(scope, emails)
    const first = emails.map((e) => users.find((u) => u.email === e)).find(Boolean)
    return first ? { id: first.id, name: userName(first) } : null
  } catch {
    return null
  }
}

/** What the sample tasks link to, by `sandboxSeedLinks`: the store's real orders and customers only when asked. */
export function seedTargets(found: SeedEntities, links: SandboxSeedLinks): SeedEntities {
  if (links === "none") return {}
  if (links === "product") return { productId: found.productId ?? null }
  return found
}

async function seed(scope: Scope, onlyIf?: (current: unknown) => boolean): Promise<boolean> {
  const env = envOf(scope)
  const viewer = await seedViewer(scope, env.options.sandboxAccounts)
  const entities = env.options.sandboxSeedLinks === "none" ? {} : seedTargets(await seedEntities(scope), env.options.sandboxSeedLinks)
  const result = buildSandboxSeed({ now: env.now, viewer, entities })
  return env.stores.sandbox.replace(result, { key: SANDBOX_KEY, id: newId("tset"), value: result.marker }, env.now, onlyIf)
}

/** True when the sandbox board needs its sample tasks (never seeded, an older seed version, or older than `sandboxResetHours`). */
export async function sandboxIsStale(scope: Scope): Promise<boolean> {
  const env = envOf(scope)
  if (env.options.sandboxAccounts.length === 0) return false
  try {
    return sandboxStale(await marker(scope), env.options.sandboxResetHours, env.now)
  } catch {
    return false
  }
}

/**
 * Seeds the sandbox board when it is stale. For the Tasks page of a sandbox
 * account (`POST /admin/tasks/sandbox/ensure`) and the job; a no-op for the
 * team and while the seed is fresh.
 */
export async function ensureSandbox(scope: Scope, ctx: RequestContext | null): Promise<boolean> {
  if (ctx && !ctx.sandbox) return false
  const env = envOf(scope)
  if (env.options.sandboxAccounts.length === 0) return false
  if (!sandboxStale(await marker(scope), env.options.sandboxResetHours, env.now)) return false
  return withLock("sandbox", async () => {
    try {
      return await seed(scope, (current) => sandboxStale(asMarker(current), env.options.sandboxResetHours, new Date()))
    } catch (err) {
      warn(scope, `Could not seed the sandbox board: ${(err as Error)?.message ?? String(err)}`)
      return false
    }
  })
}

/** "Reset the sandbox": everything on the sandbox board back to the sample tasks. Anyone in the admin may do it. */
export async function resetSandbox(scope: Scope, ctx: RequestContext): Promise<{ ok: true; seeded_at: string }> {
  const env = envOf(scope)
  if (env.options.sandboxAccounts.length === 0) {
    throw new ActionError(409, "sandbox_off", "There is no sandbox board: no sandbox accounts are configured (sandboxAccounts).")
  }
  sandboxPace(scope, ctx)
  const fresh = (current: unknown) => {
    const at = new Date(String(asMarker(current)?.seeded_at ?? "")).getTime()
    return !(Number.isFinite(at) && Date.now() - at >= 0 && Date.now() - at < RESET_COOLDOWN_MS)
  }
  const replaced = await withLock("sandbox", () => seed(scope, fresh))
  if (!replaced) {
    const m = await marker(scope).catch(() => null)
    return { ok: true, seeded_at: typeof m?.seeded_at === "string" ? m.seeded_at : env.now.toISOString() }
  }
  return { ok: true, seeded_at: env.now.toISOString() }
}

/** The marker for the status: when the sandbox was seeded. */
export async function sandboxMarker(scope: Scope): Promise<SandboxMarker | null> {
  try {
    return await marker(scope)
  } catch {
    return null
  }
}
