/**
 * The admin guard as a Medusa middleware (`src/api/middlewares.ts` puts it on
 * every `/admin` route): reads the account behind the request and applies
 * the rules of `lib/guard.ts`. Medusa authenticates `/admin` routes before
 * any plugin middleware, so `req.auth_context` is there.
 *
 * Nothing is looked up unless a rule can apply: a request of a signed in
 * user passes untouched while `sandboxGuard` is off, a key is looked up only
 * outside `/admin/tasks` (from the one minute cache of `context.ts`).
 *
 * FAIL CLOSED. When the account cannot be read, a request the rules would
 * check is refused (503) instead of guessed.
 */

import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { guardDecision, normalizeAdminPath, ownProfileWriteAllowed, TASKS_PREFIX, under, type GuardActor } from "../../modules/tasks/lib/guard"
import { isAgentKeyTitle, isSandboxEmail, type ResolvedTasksOptions } from "../../modules/tasks/lib/options"
import { apiKeyProfile, userProfile } from "./context"
import { tasksService, type Scope } from "./runtime"

type AuthContext = { actor_id?: string | null; actor_type?: string | null }

function refuse(res: MedusaResponse, status: number, code: string, message: string): void {
  res.status(status).json({ type: status === 503 ? "unexpected_state" : "not_allowed", code, message })
}

/** The account behind the request, as the guard sees it; null when no rule can apply. */
async function actorOf(scope: Scope, auth: AuthContext, options: ResolvedTasksOptions): Promise<GuardActor | null> {
  const id = typeof auth.actor_id === "string" ? auth.actor_id : ""
  if (auth.actor_type === "api-key") {
    const key = await apiKeyProfile(scope, id)
    if (!key) return null
    const creator = key.created_by ? await userProfile(scope, key.created_by) : null
    /* With the guard on, a key whose creator is gone cannot prove it is not a sandbox account's. */
    const sandbox = isSandboxEmail(creator?.email, options) || (options.sandboxGuard.enabled && Boolean(key.created_by) && !creator)
    return { type: "api-key", sandbox, agentKey: isAgentKeyTitle(key.title, options), userId: null }
  }
  if (auth.actor_type === "user") {
    const profile = await userProfile(scope, id)
    if (!profile) return null
    return { type: "user", sandbox: isSandboxEmail(profile.email, options), agentKey: false, userId: profile.id }
  }
  return null
}

export function tasksAdminGuard() {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): Promise<void> => {
    const auth = (req as MedusaRequest & { auth_context?: AuthContext }).auth_context
    if (!auth?.actor_id) return next()
    let options: ResolvedTasksOptions
    try {
      options = tasksService(req.scope).getOptions()
    } catch {
      return next()
    }
    const isKey = auth.actor_type === "api-key"
    const sandboxRules = options.sandboxGuard.enabled && options.sandboxAccounts.length > 0
    const agentRules = isKey && options.agentKeyPrefix !== ""
    if (!sandboxRules && !agentRules) return next()

    const url = String((req as { originalUrl?: string }).originalUrl ?? req.url ?? "")
    const path = normalizeAdminPath(url)
    /* Everything under /admin/tasks decides its board itself (context.ts). */
    if (path && under(path, TASKS_PREFIX)) return next()

    let actor: GuardActor | null
    try {
      actor = await actorOf(req.scope, auth, options)
    } catch {
      return refuse(res, 503, "account_unavailable", "Your account could not be checked. Try again in a moment.")
    }
    if (!actor) return next()

    const decision = guardDecision(
      { method: req.method ?? "GET", url, query: (req.query ?? {}) as Record<string, unknown> },
      actor,
      { sandboxGuard: sandboxRules, allowWrites: options.sandboxGuard.allowWrites },
    )
    if (!decision.allow) return refuse(res, decision.status, decision.code, decision.message)
    if (decision.ownProfile) {
      let current
      try {
        current = actor.userId ? await userProfile(req.scope, actor.userId) : null
      } catch {
        return refuse(res, 503, "account_unavailable", "Your account could not be checked. Try again in a moment.")
      }
      if (!current || !ownProfileWriteAllowed((req as { body?: unknown }).body, current)) {
        return refuse(res, 403, "sandbox_guard", "A sandbox account keeps its name and photo; only the language can change.")
      }
    }
    next()
  }
}
