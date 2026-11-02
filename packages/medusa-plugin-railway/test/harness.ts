/**
 * A fake Medusa container for the reads: the module service with its
 * options and a Railway client over a fake `fetch`. Each container has its
 * own service, so caches never leak between tests.
 */
import KodaRailwayModuleService from "../src/modules/railway/service.ts"
import { RailwayReadClient } from "../src/modules/railway/lib/client.ts"
import { RAILWAY_MODULE } from "../src/modules/railway/lib/constants.ts"
import type { RailwayPluginOptions } from "../src/modules/railway/lib/options.ts"
import { CLIENT_KEY } from "../src/workflows/railway/runtime.ts"
import type { FakeRailway } from "./fixtures.ts"
import { TOKEN } from "./fixtures.ts"

export const logs: string[] = []
export const logger = {
  info: (m: string) => void logs.push(`info ${m}`),
  warn: (m: string) => void logs.push(`warn ${m}`),
  error: (m: string) => void logs.push(`error ${m}`),
  debug: () => undefined,
} as never

export const noSleep = { now: () => Date.now(), sleep: async () => undefined }

export function container(fake: FakeRailway | null, options: RailwayPluginOptions = { token: TOKEN }) {
  const svc = new KodaRailwayModuleService({ logger }, options)
  const client = fake ? new RailwayReadClient({ token: svc.getOptions().token, fetch: fake.fetch, clock: noSleep, requestsPerSecond: 50 }) : null
  const registry: Record<string, unknown> = { [RAILWAY_MODULE]: svc, ...(client ? { [CLIENT_KEY]: client } : {}) }
  return {
    svc,
    client,
    resolve<T>(key: string, opts?: { allowUnregistered?: boolean }): T {
      if (key in registry) return registry[key] as T
      if (opts?.allowUnregistered) return undefined as T
      throw new Error(`not registered: ${key}`)
    },
  }
}
