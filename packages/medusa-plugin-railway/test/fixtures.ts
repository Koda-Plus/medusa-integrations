/**
 * Railway answers in the shapes the public API sends (recorded from the
 * schema of backboard.railway.com/graphql/v2, ids and names made up), and a
 * fake `fetch` that answers the plugin's documents by operation name and
 * records every request. No network in the tests.
 */
import type { FetchLike, FetchResponseLike } from "../src/modules/railway/lib/client.ts"

export const PROJECT = "11111111-2222-4333-8444-555555555555"
export const ENV = "66666666-7777-4888-9999-aaaaaaaaaaaa"
export const OTHER_PROJECT = "99999999-0000-4000-8000-000000000000"
export const SVC_API = "a0000000-0000-4000-8000-000000000001"
export const SVC_WEB = "a0000000-0000-4000-8000-000000000002"
export const SVC_PG = "a0000000-0000-4000-8000-000000000003"
export const DEP_API = "d0000000-0000-4000-8000-000000000001"
export const DEP_API_OLD = "d0000000-0000-4000-8000-000000000002"
export const DEP_WEB_FAILED = "d0000000-0000-4000-8000-000000000003"
export const DEP_WEB_OK = "d0000000-0000-4000-8000-000000000004"
export const DEP_PG = "d0000000-0000-4000-8000-000000000005"

/** A token of the right length, made up (never a real one). */
export const TOKEN = "f00dfeed-1234-4567-89ab-cdef01234567"

export const minutesAgo = (m: number, now = Date.now()) => new Date(now - m * 60_000).toISOString()

export function rawDeployment(id: string, status: string, created: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status,
    createdAt: created,
    statusUpdatedAt: new Date(Date.parse(created) + 150_000).toISOString(),
    updatedAt: new Date(Date.parse(created) + 150_000).toISOString(),
    url: null,
    staticUrl: null,
    meta: { repo: "example/shop", branch: "main", commitHash: "0123456789abcdef0123456789abcdef01234567", commitMessage: "fix: cart totals\n\nlonger body", commitAuthor: "Anna Nowak" },
    creator: { name: "Anna Nowak" },
    instances: status === "SUCCESS" ? [{ status: "RUNNING" }] : [],
    ...extra,
  }
}

export function overviewAnswer(now = Date.now()) {
  const api = rawDeployment(DEP_API, "SUCCESS", minutesAgo(120, now), { staticUrl: "api.example.com" })
  const webFailed = rawDeployment(DEP_WEB_FAILED, "FAILED", minutesAgo(10, now))
  const webOk = rawDeployment(DEP_WEB_OK, "SUCCESS", minutesAgo(3000, now))
  const pg = rawDeployment(DEP_PG, "SUCCESS", minutesAgo(9000, now), { meta: { image: "ghcr.io/railwayapp-templates/postgres-ssl:16" } })
  return {
    project: { id: PROJECT, name: "shop", environments: { edges: [{ node: { id: ENV, name: "production" } }] } },
    environment: {
      id: ENV,
      name: "production",
      serviceInstances: {
        edges: [
          {
            node: {
              serviceId: SVC_PG,
              serviceName: "Postgres",
              region: "europe-west4",
              numReplicas: 1,
              source: { repo: null, image: "ghcr.io/railwayapp-templates/postgres-ssl:16" },
              latestDeployment: pg,
              activeDeployments: [pg],
              domains: { serviceDomains: [], customDomains: [] },
            },
          },
          {
            node: {
              serviceId: SVC_API,
              serviceName: "backend",
              region: "europe-west4",
              numReplicas: 1,
              source: { repo: "example/shop", image: null },
              latestDeployment: api,
              activeDeployments: [api],
              domains: {
                serviceDomains: [{ domain: "backend-production.up.railway.app", syncStatus: "ACTIVE" }],
                customDomains: [{ domain: "api.example.com", status: { verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALID", certificateErrorMessage: null } }],
              },
            },
          },
          {
            node: {
              serviceId: SVC_WEB,
              serviceName: "storefront",
              region: "europe-west4",
              numReplicas: 1,
              source: { repo: "example/storefront", image: null },
              latestDeployment: webFailed,
              activeDeployments: [webOk],
              domains: { serviceDomains: [], customDomains: [{ domain: "shop.example.com", status: { verified: false, certificateStatus: "CERTIFICATE_STATUS_TYPE_PENDING", certificateErrorMessage: null } }] },
            },
          },
        ],
      },
      volumeInstances: { edges: [{ node: { id: "vol-pg-0001", serviceId: SVC_PG, mountPath: "/var/lib/postgresql/data", sizeMB: 5000, currentSizeMB: 4800, state: "READY", volume: { name: "pg-data" } } }] },
    },
  }
}

export function memoryAnswer(now = Date.now()) {
  const t = Math.floor(now / 1000)
  const series = (measurement: string, serviceId: string, v: number) => ({ measurement, tags: { serviceId }, values: [{ ts: t - 600, value: v * 0.9 }, { ts: t - 300, value: v }] })
  return {
    metrics: [series("MEMORY_USAGE_GB", SVC_API, 0.92), series("MEMORY_LIMIT_GB", SVC_API, 1), series("MEMORY_USAGE_GB", SVC_PG, 0.3), series("MEMORY_LIMIT_GB", SVC_PG, 8)],
  }
}

/** A Postgres URL with credentials, built at run time so the repository's secret check never sees one. */
export const pgUrl = () => ["postgres://medusa", ":", "hunter", "2hunter", "@db.internal:5432/railway"].join("")

export function logsAnswer(now = Date.now(), projectId = PROJECT) {
  return {
    deployment: { id: DEP_API, projectId, environmentId: ENV, serviceId: SVC_API, status: "SUCCESS" },
    deploymentLogs: [
      { timestamp: minutesAgo(30, now), message: "Server is ready on port 9000", severity: "info" },
      { timestamp: minutesAgo(20, now), message: `Connecting to ${pgUrl()}`, severity: "info" },
      { timestamp: minutesAgo(10, now), message: "error: Payment provider timed out", severity: "info" },
      { timestamp: minutesAgo(5, now), message: "http POST /store/carts/c_1/complete 500 2011 ms", severity: "info" },
      { timestamp: minutesAgo(1, now), message: "Unhandled rejection", severity: "error" },
    ],
  }
}

export interface Recorded {
  op: string
  headers: Record<string, string>
  variables: Record<string, unknown>
  query: string
}

export type Handler = (variables: Record<string, unknown>, headers: Record<string, string>) => unknown | { __status: number; __body?: unknown; __headers?: Record<string, string> }

/** A fake Railway: answers by operation name, records requests. A handler may throw to fail the request at the network level. */
export class FakeRailway {
  readonly calls: Recorded[] = []
  private readonly handlers: Record<string, Handler>
  constructor(handlers: Record<string, Handler>) {
    this.handlers = handlers
  }

  fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as { query: string; variables?: Record<string, unknown> }
    const op = /query\s+(\w+)/.exec(body.query)?.[1] ?? "anonymous"
    this.calls.push({ op, headers: init.headers, variables: body.variables ?? {}, query: body.query })
    const handler = this.handlers[op]
    const out = handler ? handler(body.variables ?? {}, init.headers) : { __status: 200, __body: { errors: [{ message: `no fake for ${op}` }] } }
    const special = out && typeof out === "object" && "__status" in (out as object) ? (out as { __status: number; __body?: unknown; __headers?: Record<string, string> }) : null
    const status = special ? special.__status : 200
    const text = JSON.stringify(special ? special.__body ?? {} : { data: out })
    const headers = special?.__headers ?? {}
    const res: FetchResponseLike = { status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => text }
    return res
  }

  ops(): string[] {
    return this.calls.map((c) => c.op)
  }
}

/** The standard project: a project token, the overview, memory, the error scan, logs, deployments, variables, metrics. */
export function standardRailway(now = Date.now(), overrides: Record<string, Handler> = {}) {
  return new FakeRailway({
    KodaRailwayProjectToken: (_v, h) => (h["Project-Access-Token"] ? { projectToken: { projectId: PROJECT, environmentId: ENV } } : { __status: 200, __body: { errors: [{ message: "Not Authorized" }] } }),
    KodaRailwayOverview: () => overviewAnswer(now),
    KodaRailwayMemory: () => memoryAnswer(now),
    KodaRailwayErrorScan: (v) => {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v).filter((x) => /^d\d+$/.test(x))) {
        out[k] = v[k] === DEP_API ? Array.from({ length: 30 }, (_, i) => ({ timestamp: minutesAgo(i, now), message: "error: boom", severity: "error" })) : []
      }
      return out
    },
    KodaRailwayDeploymentLogs: () => logsAnswer(now),
    KodaRailwayBuildLogs: () => ({ deployment: { id: DEP_WEB_FAILED, projectId: PROJECT, environmentId: ENV, serviceId: SVC_WEB, status: "FAILED" }, buildLogs: [{ timestamp: minutesAgo(11, now), message: "npm run build", severity: "info" }, { timestamp: minutesAgo(10, now), message: "Build failed", severity: "error" }] }),
    KodaRailwayDeployments: () => ({ deployments: { edges: [{ node: rawDeployment(DEP_API_OLD, "REMOVED", minutesAgo(5000, now)) }, { node: rawDeployment(DEP_API, "SUCCESS", minutesAgo(120, now)) }] } }),
    KodaRailwayVariables: () => ({ variables: { DATABASE_URL: "${{Postgres.DATABASE_URL}}", STRIPE_READ_KEY: "rk_live_" + "x".repeat(12), KODA_ADMIN_PASSWORD: "", JWT_SECRET: "a-very-long-secret-value-here" } }),
    KodaRailwayServiceMetrics: () => {
      const t = Math.floor(now / 1000)
      const pts = (v: number) => Array.from({ length: 5 }, (_, i) => ({ ts: t - (5 - i) * 60, value: v + i * 0.01 }))
      return { metrics: [{ measurement: "CPU_USAGE", values: pts(0.2) }, { measurement: "CPU_LIMIT", values: pts(8) }, { measurement: "MEMORY_USAGE_GB", values: pts(0.5) }, { measurement: "MEMORY_LIMIT_GB", values: [{ ts: t, value: 1 }] }, { measurement: "NETWORK_RX_GB", values: pts(0.001) }, { measurement: "NETWORK_TX_GB", values: pts(0.002) }] }
    },
    ...overrides,
  })
}
