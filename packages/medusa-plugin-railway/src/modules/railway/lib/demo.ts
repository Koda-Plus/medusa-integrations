/**
 * DEMO MODE: a sample Railway project answered in-process. No runtime
 * imports beyond the pure helpers.
 *
 * Instead of sample DTOs, demo mode gives the client a `fetch` that answers
 * the plugin's own GraphQL documents (by operation name) with sample data in
 * Railway's shapes. So the demo runs through the same client, guard, cache,
 * shaping and masking as a real project: what the demo shows is what the
 * code does. Nothing leaves the server.
 *
 * The project: a Medusa backend, a storefront whose last build failed (the
 * previous deployment still serves), a worker with an instance restarting,
 * Postgres with a volume near full and Redis.
 */
import type { FetchLike } from "./client"

export const DEMO_PROJECT_ID = "demo-project-0000-0000-000000000001"
export const DEMO_ENVIRONMENT_ID = "demo-env-0000-0000-0000-000000000001"

const SERVICES = {
  backend: "demo-svc-backend-0000-000000000001",
  storefront: "demo-svc-storefront-0000-00000000002",
  worker: "demo-svc-worker-0000-0000-000000000003",
  postgres: "demo-svc-postgres-0000-000000000004",
  redis: "demo-svc-redis-0000-0000-000000000005",
} as const

type Key = keyof typeof SERVICES

const COMMITS: Array<{ message: string; author: string }> = [
  { message: "fix(checkout): keep the cart when the payment is retried", author: "Anna Nowak" },
  { message: "feat(admin): order export with invoice numbers", author: "Jan Kowalski" },
  { message: "chore: bump Medusa to 2.13", author: "Anna Nowak" },
  { message: "fix(emails): order confirmation in Polish", author: "Jan Kowalski" },
  { message: "feat(storefront): free shipping banner", author: "Anna Nowak" },
  { message: "perf: cache the product list for 60 s", author: "Jan Kowalski" },
]

const hex = (seed: number) => {
  let x = seed * 2654435761
  let out = ""
  for (let i = 0; i < 40; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    out += (x % 16).toString(16)
  }
  return out
}

function deployment(service: Key, i: number, now: number, status: string, minutesAgo: number, buildMinutes = 3) {
  const c = COMMITS[i % COMMITS.length]
  const created = now - minutesAgo * 60_000
  const repo = service === "backend" || service === "worker" ? "demo-store/backend" : service === "storefront" ? "demo-store/storefront" : null
  return {
    id: `demo-dep-${service}-${String(i).padStart(4, "0")}`,
    status,
    createdAt: new Date(created).toISOString(),
    statusUpdatedAt: new Date(created + buildMinutes * 60_000).toISOString(),
    updatedAt: new Date(created + buildMinutes * 60_000).toISOString(),
    url: null,
    staticUrl: service === "backend" ? "api.demo-store.example" : service === "storefront" ? "demo-store.example" : null,
    meta: repo ? { repo, branch: "main", commitHash: hex(i + service.length * 31), commitMessage: c.message, commitAuthor: c.author } : { image: service === "postgres" ? "ghcr.io/railwayapp-templates/postgres-ssl:16" : "redis:7" },
    creator: { name: repo ? c.author : "Railway" },
    instances: status === "SUCCESS" ? [{ status: "RUNNING" }] : [],
  }
}

function history(service: Key, now: number) {
  const list: Array<ReturnType<typeof deployment>> = []
  for (let i = 0; i < 12; i++) {
    let status = "REMOVED"
    if (i === 0) status = "SUCCESS"
    if (service === "storefront" && i === 0) status = "FAILED"
    if (service === "storefront" && i === 1) status = "SUCCESS"
    if (i === 3 && service === "backend") status = "FAILED"
    list.push(deployment(service, 20 - i, now, status, 40 + i * 600 + (service.length * 7), status === "FAILED" ? 1 : 3))
  }
  return list
}

function instance(service: Key, now: number) {
  const h = history(service, now)
  const active = h.find((d) => d.status === "SUCCESS")!
  const activeDep = service === "worker" ? { ...active, instances: [{ status: "RUNNING" }, { status: "RESTARTING" }] } : active
  const image = service === "postgres" ? "ghcr.io/railwayapp-templates/postgres-ssl:16" : service === "redis" ? "redis:7" : null
  return {
    serviceId: SERVICES[service],
    serviceName: service === "postgres" ? "Postgres" : service === "redis" ? "Redis" : service,
    region: "europe-west4-drams3a",
    numReplicas: service === "worker" ? 2 : 1,
    source: { repo: image ? null : service === "storefront" ? "demo-store/storefront" : "demo-store/backend", image },
    latestDeployment: h[0],
    activeDeployments: [activeDep],
    domains: {
      serviceDomains: service === "backend" ? [{ domain: "demo-backend-production.up.railway.app", syncStatus: "ACTIVE" }] : [],
      customDomains:
        service === "backend"
          ? [{ domain: "api.demo-store.example", status: { verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALID", certificateErrorMessage: null } }]
          : service === "storefront"
            ? [{ domain: "demo-store.example", status: { verified: true, certificateStatus: "CERTIFICATE_STATUS_TYPE_VALID", certificateErrorMessage: null } }]
            : [],
    },
  }
}

const wave = (t: number, base: number, amp: number, period: number) => Math.max(0, base + amp * Math.sin(t / period) + amp * 0.3 * Math.sin(t / (period / 7)))

function series(measurement: string, start: number, end: number, step: number, service: Key) {
  const values: Array<{ ts: number; value: number }> = []
  const scale = service === "backend" ? 1 : service === "worker" ? 0.6 : service === "postgres" ? 0.5 : 0.2
  for (let t = Math.floor(start / 1000); t <= Math.floor(end / 1000); t += step) {
    let value = 0
    if (measurement === "CPU_USAGE") value = wave(t, 0.35 * scale, 0.2 * scale, 1800)
    if (measurement === "CPU_LIMIT") value = 8
    if (measurement === "MEMORY_USAGE_GB") value = service === "backend" ? wave(t, 0.88, 0.02, 3000) : wave(t, 0.4 * scale, 0.05, 3000)
    if (measurement === "MEMORY_LIMIT_GB") value = service === "backend" ? 1 : 8
    if (measurement === "NETWORK_RX_GB") value = wave(t, 0.002 * scale, 0.0015 * scale, 900) * (step / 60)
    if (measurement === "NETWORK_TX_GB") value = wave(t, 0.004 * scale, 0.003 * scale, 900) * (step / 60)
    values.push({ ts: t, value: Math.round(value * 1e6) / 1e6 })
  }
  return { measurement, tags: { serviceId: SERVICES[service] }, values }
}

const keyOf = (serviceId: unknown): Key | null => (Object.entries(SERVICES).find(([, id]) => id === serviceId)?.[0] as Key | undefined) ?? null

/** A connection string built at run time, so the masking has something to mask in the demo logs. */
const demoUrl = () => ["postgres://medusa", ":", "demo", "Pass", "word", "@postgres.railway.internal:5432/railway"].join("")

function logs(service: Key, now: number, kind: "deploy" | "build", count: number) {
  const out: Array<{ timestamp: string; message: string; severity: string }> = []
  if (kind === "build") {
    const steps = ["[internal] load build definition", "npm ci", "added 1116 packages in 41s", "npm run build", "error TS2322: Type 'string' is not assignable to type 'number'.", "Build failed with exit code 2"]
    for (let i = 0; i < steps.length; i++) out.push({ timestamp: new Date(now - (steps.length - i) * 9_000).toISOString(), message: steps[i], severity: i >= 4 ? "error" : "info" })
    return out
  }
  const lines = [
    ["info", "http GET /store/products?limit=12 200 41 ms"],
    ["info", "http POST /store/carts/cart_demo/line-items 200 88 ms"],
    ["info", `Connecting to ${demoUrl()}`],
    ["warn", "Slow query: product list took 1240 ms"],
    ["info", "http GET /admin/orders?limit=20 200 63 ms"],
    ["error", "error: Payment provider timed out after 20000 ms"],
    ["info", "http POST /store/carts/cart_demo/complete 500 20113 ms"],
    ["info", "Job snapshot-prices finished in 2.1 s"],
  ]
  for (let i = 0; i < count; i++) {
    const [severity, message] = lines[i % lines.length]
    out.push({ timestamp: new Date(now - i * 47_000 - (service.length * 1000)).toISOString(), message, severity })
  }
  return out.reverse()
}

/** Answers one document of queries.ts by its operation name. */
export function demoAnswer(document: string, variables: Record<string, unknown>, now: number = Date.now()): unknown {
  const op = /query\s+(\w+)/.exec(document)?.[1] ?? ""
  const keys = Object.keys(SERVICES) as Key[]
  switch (op) {
    case "KodaRailwayProjectToken":
      return { projectToken: { projectId: DEMO_PROJECT_ID, environmentId: DEMO_ENVIRONMENT_ID } }
    case "KodaRailwayEnvironments":
      return { project: { id: DEMO_PROJECT_ID, name: "demo-store", environments: { edges: [{ node: { id: DEMO_ENVIRONMENT_ID, name: "production" } }] } } }
    case "KodaRailwayOverview":
      return {
        project: { id: DEMO_PROJECT_ID, name: "demo-store", environments: { edges: [{ node: { id: DEMO_ENVIRONMENT_ID, name: "production" } }] } },
        environment: {
          id: DEMO_ENVIRONMENT_ID,
          name: "production",
          serviceInstances: { edges: keys.map((k) => ({ node: instance(k, now) })) },
          volumeInstances: {
            edges: [
              { node: { id: "demo-vol-postgres-0001", serviceId: SERVICES.postgres, mountPath: "/var/lib/postgresql/data", sizeMB: 5000, currentSizeMB: 4410.5, state: "READY", volume: { name: "postgres-volume" } } },
              { node: { id: "demo-vol-redis-0001", serviceId: SERVICES.redis, mountPath: "/data", sizeMB: 1000, currentSizeMB: 48.2, state: "READY", volume: { name: "redis-volume" } } },
            ],
          },
        },
      }
    case "KodaRailwayMemory": {
      const start = Date.parse(String(variables.startDate ?? "")) || now - 3_600_000
      return { metrics: keys.flatMap((k) => [series("MEMORY_USAGE_GB", start, now, 300, k), series("MEMORY_LIMIT_GB", start, now, 300, k)]) }
    }
    case "KodaRailwayServiceMetrics": {
      const k = keyOf(variables.serviceId)
      if (!k) return { metrics: [] }
      const start = Date.parse(String(variables.startDate ?? "")) || now - 3_600_000
      const step = Number(variables.sampleRateSeconds) || 60
      return { metrics: ["CPU_USAGE", "CPU_LIMIT", "MEMORY_USAGE_GB", "MEMORY_LIMIT_GB", "NETWORK_RX_GB", "NETWORK_TX_GB"].map((m) => ({ measurement: m, values: series(m, start, now, step, k).values })) }
    }
    case "KodaRailwayDeployments": {
      const k = keyOf(variables.serviceId)
      return { deployments: { edges: k ? history(k, now).map((node) => ({ node })) : [] } }
    }
    case "KodaRailwayDeploymentLogs":
    case "KodaRailwayBuildLogs": {
      const id = String(variables.deploymentId ?? "")
      const k = keys.find((x) => id.startsWith(`demo-dep-${x}-`)) ?? null
      const build = op === "KodaRailwayBuildLogs"
      const deploymentInfo = k ? { id, projectId: DEMO_PROJECT_ID, environmentId: DEMO_ENVIRONMENT_ID, serviceId: SERVICES[k], status: "SUCCESS" } : null
      const limit = Math.min(Number(variables.limit) || 100, 400)
      const lines = k ? logs(k, now, build ? "build" : "deploy", limit) : []
      return build ? { deployment: deploymentInfo, buildLogs: lines } : { deployment: deploymentInfo, deploymentLogs: lines }
    }
    case "KodaRailwayVariables": {
      const k = keyOf(variables.serviceId)
      if (!k) return { variables: {} }
      const common: Record<string, string> = { RAILWAY_ENVIRONMENT: "production", PORT: "9000" }
      if (k === "backend" || k === "worker")
        return {
          variables: {
            ...common,
            DATABASE_URL: "${{Postgres.DATABASE_URL}}",
            REDIS_URL: "${{Redis.REDIS_URL}}",
            JWT_SECRET: "x",
            COOKIE_SECRET: "x",
            STRIPE_READ_KEY: "x",
            RAILWAY_READ_TOKEN: "x",
            ADMIN_PASSWORD: "",
            STORE_CORS: "https://demo-store.example",
          },
        }
      if (k === "storefront") return { variables: { ...common, MEDUSA_BACKEND_URL: "https://api.demo-store.example", PUBLISHABLE_KEY: "x", ANALYTICS_ID: "" } }
      return { variables: { ...common, PGDATA: "/var/lib/postgresql/data/pgdata", POSTGRES_PASSWORD: "x" } }
    }
    case "KodaRailwayErrorScan": {
      const out: Record<string, unknown> = {}
      for (const [alias, id] of Object.entries(variables)) {
        if (!/^d\d+$/.test(alias)) continue
        const k = keys.find((x) => String(id).startsWith(`demo-dep-${x}-`))
        const n = k === "backend" ? 160 : k === "worker" ? 40 : 10
        out[alias] = k ? logs(k, now, "deploy", n).map((l, i) => (k === "backend" && i % 5 === 0 ? { ...l, severity: "error", message: "error: upstream timed out" } : l)) : []
      }
      return out
    }
    default:
      return {}
  }
}

/** The demo's `fetch`: same headers and body as the real one, answered here. */
export function demoFetch(clock: () => number = Date.now): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(init.body) as { query: string; variables?: Record<string, unknown> }
    const text = JSON.stringify({ data: demoAnswer(body.query, body.variables ?? {}, clock()) })
    return { status: 200, headers: { get: () => null }, text: async () => text }
  }
}
