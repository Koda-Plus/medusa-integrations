import { KIT_MODULE } from "../../modules/kit/lib/constants"
import { createKitClient, type KitClient } from "../../modules/kit/lib/client"
import type { ResolvedKitOptions } from "../../modules/kit/lib/options"
import { effectiveSettings, readSettings, type KitSettings } from "../../modules/kit/lib/store"

/**
 * What the admin routes share: the module service, the options, the settings
 * in effect and ONE client per process (the throttle counts across requests,
 * not per request).
 */

export type Scope = { resolve: (key: string) => unknown }

export function kitServiceOf(scope: Scope) {
  return scope.resolve(KIT_MODULE) as any
}

export function optionsOf(scope: Scope): ResolvedKitOptions {
  const svc = kitServiceOf(scope)
  return (svc.getOptions?.() ?? { apiKey: "", source: "Medusa", doubleOptIn: false, formId: null, tags: [], requestsPerMinute: 90, timeoutMs: 20_000, storefrontUrl: null, demo: false, problems: [] }) as ResolvedKitOptions
}

export async function settingsOf(scope: Scope): Promise<KitSettings> {
  return effectiveSettings(optionsOf(scope), await readSettings(scope))
}

let client: KitClient | null = null

export function clientOf(scope: Scope): KitClient {
  if (!client) {
    const logger = scope.resolve("logger") as { warn: (m: string) => void; error: (m: string) => void }
    client = createKitClient(optionsOf(scope), logger)
  }
  return client
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i
