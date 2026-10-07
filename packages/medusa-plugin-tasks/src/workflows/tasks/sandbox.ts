/**
 * THE SANDBOX BOARD: seeded with the sample tasks of `lib/sandbox.ts` the
 * first time a sandbox account opens it, seeded again after
 * `sandboxResetHours` (on the next opening) and on "Reset the sandbox".
 *
 * A seed replaces everything on the sandbox board, in one transaction under
 * the board's lock, and touches nothing else: the store that does it
 * (`createSandboxStore`) only knows the sandbox board.
 */

import { SANDBOX_KEY } from "../../modules/tasks/lib/constants"
import type { RequestContext } from "../../modules/tasks/lib/actor"
import { userName } from "../../modules/tasks/lib/actor"
import { buildSandboxSeed, sandboxStale, type SeedViewer } from "../../modules/tasks/lib/sandbox"
import { usersByEmail } from "./context"
import { seedEntities } from "./records"
import { ActionError, envOf, newId, warn, withLock, type Scope } from "./runtime"

export interface SandboxMarker {
  version?: string
  seeded_at?: string
  tasks?: number
}

async function marker(scope: Scope): Promise<SandboxMarker | null> {
  const row = await envOf(scope).stores.settings.get(SANDBOX_KEY)
  const v = row?.value
  return v && typeof v === "object" && !Array.isArray(v) ? (v as SandboxMarker) : null
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

async function seed(scope: Scope): Promise<void> {
  const env = envOf(scope)
  const viewer = await seedViewer(scope, env.options.sandboxAccounts)
  const result = buildSandboxSeed({ now: env.now, viewer, entities: await seedEntities(scope) })
  await env.stores.sandbox.replace(result, { key: SANDBOX_KEY, id: newId("tset"), value: result.marker }, env.now)
}

/**
 * Makes sure the sandbox board is seeded and fresh, for a sandbox account's
 * request. A no-op for everyone else, and a single settings read while the
 * seed is fresh.
 */
export async function ensureSandbox(scope: Scope, ctx: RequestContext): Promise<boolean> {
  if (!ctx.sandbox) return false
  const env = envOf(scope)
  if (!sandboxStale(await marker(scope), env.options.sandboxResetHours, env.now)) return false
  return withLock("sandbox", async () => {
    /* Another request of this process may have seeded it while this one waited. */
    if (!sandboxStale(await marker(scope), env.options.sandboxResetHours, new Date())) return false
    try {
      await seed(scope)
      return true
    } catch (err) {
      warn(scope, `Could not seed the sandbox board: ${(err as Error)?.message ?? String(err)}`)
      return false
    }
  })
}

/** "Reset the sandbox": everything on the sandbox board back to the sample tasks. Anyone in the admin may do it. */
export async function resetSandbox(scope: Scope, _ctx: RequestContext): Promise<{ ok: true; seeded_at: string }> {
  const env = envOf(scope)
  if (env.options.sandboxAccounts.length === 0) {
    throw new ActionError(409, "sandbox_off", "There is no sandbox board: no sandbox accounts are configured (sandboxAccounts).")
  }
  await withLock("sandbox", () => seed(scope))
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
