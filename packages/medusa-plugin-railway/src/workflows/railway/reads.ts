/**
 * The reads behind the admin page, for your own code too (a daily report, a
 * message when a deploy fails). Every function takes the Medusa container
 * (or a request scope) and goes through the same cache as the admin:
 *
 *   import { loadRailwayOverview } from "@koda-plus/medusa-plugin-railway/workflows"
 *   const overview = await loadRailwayOverview(container)
 *
 * All of them only read, and only with queries: the client refuses any
 * GraphQL document with a mutation.
 */
import { DEFAULT_LOG_LINES, DEPLOYMENTS_LIMIT, ERROR_SCAN_LINES, ERROR_SCAN_MINUTES, IDENTITY_CACHE_MS, MAX_LOG_LINES } from "../../modules/railway/lib/constants"
import type { DeploymentDto, DeploymentsResponse, LogKind, LogsResponse, MetricRange, MetricsResponse, OverviewResponse, ServiceDto, TokenKind, VariablesResponse } from "../../modules/railway/lib/contract"
import { DashboardLinks } from "../../modules/railway/lib/dashboard"
import { RailwayApiError } from "../../modules/railway/lib/errors"
import { rangeWindow, shapeMetrics } from "../../modules/railway/lib/metrics"
import { countErrors, deploymentOf, isDatabase, memoryByService, serviceOf, shapeLogs, sortServices, variableNames } from "../../modules/railway/lib/normalize"
import { problemsOf } from "../../modules/railway/lib/problems"
import { errorScanDocument, Q_BUILD_LOGS, Q_DEPLOYMENT_LOGS, Q_DEPLOYMENTS, Q_ENVIRONMENTS, Q_MEMORY, Q_OVERVIEW, Q_PROJECT_TOKEN, Q_SERVICE_METRICS, Q_VARIABLES } from "../../modules/railway/lib/queries"
import type { RawDeployment, RawEdges, RawLog, RawMetric, RawOverview } from "../../modules/railway/lib/railway-types"
import { nodesOf } from "../../modules/railway/lib/railway-types"
import { safeId } from "../../modules/railway/lib/security"
import { cachedRead, clientFor, peekGood, railwayService, type Scope } from "./runtime"

export interface Identity {
  kind: TokenKind
  projectId: string
  environmentId: string
}

const IDENTITY_KEY = "identity:main"
const OVERVIEW_KEY = "overview:main"

function ttl(scope: Scope): number {
  return railwayService(scope).getOptions().cacheSeconds * 1000
}

/** The kind of the token, once a read told; null before. */
export function knownTokenKind(scope: Scope): TokenKind | null {
  return peekGood<Identity>(railwayService(scope), IDENTITY_KEY)?.value.kind ?? null
}

/** The identity read last (project and environment), without a request. */
export function knownIdentity(scope: Scope): Identity | null {
  return peekGood<Identity>(railwayService(scope), IDENTITY_KEY)?.value ?? null
}

/** The environment called "production", otherwise the first one. */
function pickEnvironment(envs: Array<{ id?: string | null; name?: string | null }>): string | null {
  const list = envs.filter((e) => safeId(e.id))
  return (list.find((e) => String(e.name ?? "").toLowerCase() === "production") ?? list[0])?.id ?? null
}

/**
 * Who the token is: a project token names its project and environment
 * (`projectToken`); an account or workspace token needs `projectId`, and
 * the environment comes from the option or the project's production
 * environment. `auto` tries the project header first.
 */
export async function resolveIdentity(scope: Scope, force = false): Promise<Identity> {
  const svc = railwayService(scope)
  const o = svc.getOptions()
  if (!svc.isConfigured()) throw new RailwayApiError({ kind: "auth", message: `No Railway token: set ${o.tokenEnv}.` })
  const read = await cachedRead<Identity>(svc, IDENTITY_KEY, IDENTITY_CACHE_MS, force, async () => {
    const client = clientFor(scope, svc)
    if (o.tokenKind !== "account") {
      try {
        const r = await client.query<{ projectToken?: { projectId?: string | null; environmentId?: string | null } | null }>(Q_PROJECT_TOKEN, {}, "project")
        const projectId = o.projectId ?? safeId(r.projectToken?.projectId)
        const environmentId = o.environmentId ?? safeId(r.projectToken?.environmentId)
        if (projectId && environmentId) return { kind: "project", projectId, environmentId }
        throw new RailwayApiError({ kind: "invalid", message: "Railway named no project for this project token." })
      } catch (err) {
        if (o.tokenKind === "project" || !(err instanceof RailwayApiError) || (err.kind !== "auth" && err.kind !== "invalid")) throw err
      }
    }
    if (!o.projectId) {
      throw new RailwayApiError({ kind: "auth", message: "The token is not a project token. With an account or workspace token, set the projectId option." })
    }
    if (o.environmentId) {
      await client.query(Q_ENVIRONMENTS, { projectId: o.projectId }, "account")
      return { kind: "account", projectId: o.projectId, environmentId: o.environmentId }
    }
    const r = await client.query<{ project?: { environments?: RawEdges<{ id?: string | null; name?: string | null }> | null } | null }>(Q_ENVIRONMENTS, { projectId: o.projectId }, "account")
    const environmentId = pickEnvironment(nodesOf(r.project?.environments))
    if (!environmentId) throw new RailwayApiError({ kind: "not_found", message: "The project has no environment this token can read." })
    return { kind: "account", projectId: o.projectId, environmentId }
  })
  return read.value
}

export function linksFor(scope: Scope, id: Identity | null): DashboardLinks {
  return new DashboardLinks(railwayService(scope).getOptions().dashboardUrl, id?.projectId ?? null, id?.environmentId ?? null)
}

/**
 * The overview: every service of the environment with its latest and active
 * deployment, instances, domains and volumes (one request), the memory of
 * all of them (one request), the error lines of the last hour per app
 * service (one request, aliases per deployment), and the problems. A part
 * that fails is left out and named in `partial`.
 */
export async function loadRailwayOverview(scope: Scope, opts: { force?: boolean } = {}): Promise<OverviewResponse> {
  const svc = railwayService(scope)
  const o = svc.getOptions()
  const id = await resolveIdentity(scope)
  const read = await cachedRead<Omit<OverviewResponse, "fresh" | "stale" | "readAt">>(svc, OVERVIEW_KEY, ttl(scope), opts.force === true, async () => {
    const client = clientFor(scope, svc)
    const links = linksFor(scope, id)
    const secrets = [o.token]
    const raw = await client.query<RawOverview>(Q_OVERVIEW, { projectId: id.projectId, environmentId: id.environmentId }, id.kind)
    if (!raw.project?.id || !raw.environment?.id) throw new RailwayApiError({ kind: "not_found", message: "Railway does not show this project or environment to the token." })
    const volumes = nodesOf(raw.environment.volumeInstances)
    const services: ServiceDto[] = sortServices(
      nodesOf(raw.environment.serviceInstances)
        .map((s) => serviceOf(s, { links, volumes, secrets }))
        .filter((s): s is ServiceDto => s !== null),
    )
    const partial: OverviewResponse["partial"] = []
    const now = Date.now()

    try {
      const m = await client.query<{ metrics?: RawMetric[] }>(Q_MEMORY, { projectId: id.projectId, environmentId: id.environmentId, startDate: new Date(now - 15 * 60_000).toISOString() }, id.kind)
      const mem = memoryByService(m.metrics)
      for (const s of services) s.memory = mem.get(s.id) ?? null
    } catch {
      partial.push("memory")
    }

    if (o.scanErrors) {
      const scanned = services.filter((s) => !isDatabase(s.kind) && s.active).slice(0, 20)
      if (scanned.length) {
        try {
          const vars: Record<string, unknown> = { limit: ERROR_SCAN_LINES, startDate: new Date(now - ERROR_SCAN_MINUTES * 60_000).toISOString() }
          scanned.forEach((s, i) => (vars[`d${i}`] = s.active!.id))
          const r = await client.query<Record<string, RawLog[] | null>>(errorScanDocument(scanned.length), vars, id.kind)
          scanned.forEach((s, i) => {
            const lines = r[`d${i}`] ?? []
            s.errorsLastHour = countErrors(lines, now - ERROR_SCAN_MINUTES * 60_000)
            s.errorsCapped = lines.length >= ERROR_SCAN_LINES
          })
        } catch {
          partial.push("errors")
        }
      }
    }

    return {
      mode: o.demo ? "demo" : "live",
      project: { id: raw.project.id, name: String(raw.project.name ?? raw.project.id) },
      environment: { id: raw.environment.id, name: String(raw.environment.name ?? raw.environment.id) },
      services,
      problems: problemsOf(services, now),
      partial,
      dashboardUrl: links.project(),
    }
  })
  return { ...read.value, readAt: new Date(read.at).toISOString(), fresh: read.fresh, stale: read.stale }
}

/** The overview read last, without a request (for the board counters), with its time. */
export function lastOverview(scope: Scope): { value: Omit<OverviewResponse, "fresh" | "stale" | "readAt">; at: number } | null {
  return peekGood(railwayService(scope), OVERVIEW_KEY)
}

/** The service must be one of the environment's: ids from the browser are checked against the overview. */
async function knownService(scope: Scope, serviceId: string): Promise<{ id: Identity; service: ServiceDto }> {
  const sid = safeId(serviceId)
  const id = await resolveIdentity(scope)
  const overview = await loadRailwayOverview(scope)
  const service = sid ? overview.services.find((s) => s.id === sid) : undefined
  if (!service) throw new RailwayApiError({ kind: "not_found", message: "No such service in this Railway environment." })
  return { id, service }
}

export async function loadRailwayDeployments(scope: Scope, serviceId: string, opts: { force?: boolean } = {}): Promise<DeploymentsResponse> {
  const svc = railwayService(scope)
  const { id, service } = await knownService(scope, serviceId)
  const read = await cachedRead<DeploymentDto[]>(svc, `deployments:${service.id}`, ttl(scope), opts.force === true, async () => {
    const r = await clientFor(scope, svc).query<{ deployments?: RawEdges<RawDeployment> }>(Q_DEPLOYMENTS, { projectId: id.projectId, environmentId: id.environmentId, serviceId: service.id, first: DEPLOYMENTS_LIMIT }, id.kind)
    const links = linksFor(scope, id)
    return nodesOf(r.deployments)
      .map((d) => deploymentOf(d, links, service.id, [svc.getOptions().token]))
      .filter((d): d is DeploymentDto => d !== null)
      .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))
  })
  return { serviceId: service.id, items: read.value, readAt: new Date(read.at).toISOString(), fresh: read.fresh }
}

export interface LogQuery {
  kind?: LogKind
  errorsOnly?: boolean
  q?: string
  /** Only lines of the last N minutes; 0 or missing: the newest lines. */
  minutes?: number
  limit?: number
  force?: boolean
}

/**
 * Logs of one deployment. Railway is asked for the newest `limit` lines (of
 * the last `minutes`); the error filter and the search run on the server
 * over the masked lines, so switching them costs no request.
 */
export async function loadRailwayLogs(scope: Scope, deploymentId: string, opts: LogQuery = {}): Promise<LogsResponse> {
  const svc = railwayService(scope)
  const did = safeId(deploymentId)
  if (!did) throw new RailwayApiError({ kind: "not_found", message: "No such deployment." })
  const id = await resolveIdentity(scope)
  const kind: LogKind = opts.kind === "build" ? "build" : "deploy"
  const minutes = Math.max(0, Math.min(10_080, Math.floor(opts.minutes ?? 0)))
  const limit = Math.max(20, Math.min(MAX_LOG_LINES, Math.floor(opts.limit ?? DEFAULT_LOG_LINES)))
  const read = await cachedRead<{ serviceId: string | null; raw: RawLog[] }>(svc, `logs:${did}:${kind}:${minutes}:${limit}`, Math.min(ttl(scope), 30_000), opts.force === true, async () => {
    const vars: Record<string, unknown> = { deploymentId: did, limit }
    if (minutes > 0) vars.startDate = new Date(Date.now() - minutes * 60_000).toISOString()
    const r = await clientFor(scope, svc).query<{ deployment?: RawDeployment | null; deploymentLogs?: RawLog[]; buildLogs?: RawLog[] }>(kind === "build" ? Q_BUILD_LOGS : Q_DEPLOYMENT_LOGS, vars, id.kind)
    /* An account token sees other projects: a deployment of another project is answered as unknown. */
    if (!r.deployment || r.deployment.projectId !== id.projectId) throw new RailwayApiError({ kind: "not_found", message: "No such deployment in this Railway project." })
    /* Only what the panel shows is kept: the lines are masked before they leave, the raw ones stay in memory for the TTL. */
    return { serviceId: safeId(r.deployment.serviceId), raw: (kind === "build" ? r.buildLogs : r.deploymentLogs) ?? [] }
  })
  const q = String(opts.q ?? "").slice(0, 200)
  const shaped = shapeLogs(read.value.raw, { errorsOnly: opts.errorsOnly === true, q, secrets: [svc.getOptions().token] })
  return {
    deploymentId: did,
    serviceId: read.value.serviceId,
    kind,
    lines: shaped.lines,
    masked: shaped.masked,
    errorsOnly: opts.errorsOnly === true,
    q,
    minutes,
    limit,
    capped: read.value.raw.length >= limit,
    readAt: new Date(read.at).toISOString(),
    fresh: read.fresh,
  }
}

export async function loadRailwayMetrics(scope: Scope, serviceId: string, range: MetricRange, opts: { force?: boolean } = {}): Promise<MetricsResponse> {
  const svc = railwayService(scope)
  const { id, service } = await knownService(scope, serviceId)
  const read = await cachedRead<RawMetric[]>(svc, `metrics:${service.id}:${range}`, ttl(scope), opts.force === true, async () => {
    const w = rangeWindow(range)
    const r = await clientFor(scope, svc).query<{ metrics?: RawMetric[] }>(Q_SERVICE_METRICS, { projectId: id.projectId, environmentId: id.environmentId, serviceId: service.id, ...w }, id.kind)
    return r.metrics ?? []
  })
  return shapeMetrics(read.value, service.id, range, { readAt: new Date(read.at).toISOString(), fresh: read.fresh })
}

/** Variable NAMES of one service with set / empty / reference. The values are dropped before anything is cached. */
export async function loadRailwayVariables(scope: Scope, serviceId: string, opts: { force?: boolean } = {}): Promise<VariablesResponse> {
  const svc = railwayService(scope)
  const { id, service } = await knownService(scope, serviceId)
  const read = await cachedRead(svc, `variables:${service.id}`, ttl(scope), opts.force === true, async () => {
    const r = await clientFor(scope, svc).query<{ variables?: unknown }>(Q_VARIABLES, { projectId: id.projectId, environmentId: id.environmentId, serviceId: service.id }, id.kind)
    return variableNames(r.variables)
  })
  return { serviceId: service.id, items: read.value, readAt: new Date(read.at).toISOString(), fresh: read.fresh }
}
