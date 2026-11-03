/**
 * What the admin routes answer: the DTOs shared by the server and the admin
 * bundle. No runtime imports. Nothing here carries a token or a variable
 * value; log lines and commit messages are masked before they are put here.
 */

export type RailwayMode = "demo" | "live" | "unconfigured"

/** How the token authenticates: `Project-Access-Token` (project) or `Authorization: Bearer` (account or workspace). */
export type TokenKind = "project" | "account"

/** The option `tokenKind`: auto tries a project token first, then an account token. */
export type TokenKindOption = TokenKind | "auto"

/** Railway's deployment states, folded into what the panel tells apart. */
export type DeployState = "success" | "building" | "deploying" | "queued" | "waiting" | "failed" | "crashed" | "sleeping" | "removed" | "skipped" | "unknown"

export type Tone = "green" | "orange" | "red" | "blue" | "grey"

export type ServiceKind = "app" | "postgres" | "redis" | "mysql" | "mongo" | "bucket" | "other"

export interface StatusResponse {
  mode: RailwayMode
  configured: boolean
  /** Options that keep the plugin from reading: `token`, or `projectId` with an account token. */
  missing: string[]
  /** The kind the token turned out to be, once a read told; null before. Never the token. */
  tokenKind: TokenKind | null
  tokenEnv: string
  options: {
    projectId: string | null
    environmentId: string | null
    tokenKind: TokenKindOption
    dashboardUrl: string
    cacheSeconds: number
    requestsPerSecond: number
    requestsPerHour: number
    timeoutMs: number
  }
  /** Railway's own counter from the last answer (X-RateLimit-*), when it sent one. */
  rateLimit: RateLimitDto | null
  /** Requests the plugin sent in the last hour, against its own budget. */
  usedThisHour: number
  /** The project page in the Railway dashboard, once the project is known. */
  dashboardUrl: string
}

export interface RateLimitDto {
  limit: number | null
  remaining: number | null
  /** ISO time the window resets. */
  resetAt: string | null
}

export interface CommitDto {
  sha: string | null
  short: string | null
  message: string | null
  author: string | null
  branch: string | null
  repo: string | null
}

export interface DeploymentDto {
  id: string
  /** Railway's own status word (SUCCESS, BUILDING, CRASHED...). */
  status: string
  state: DeployState
  tone: Tone
  createdAt: string | null
  /** When the status last changed: the end of the build for a finished one. */
  updatedAt: string | null
  /** From created to the last status change, for a finished deployment. */
  durationMs: number | null
  commit: CommitDto | null
  /** Who started it (a person, or a GitHub push). */
  creator: string | null
  /** Public URL of the deployment, when it has one. */
  url: string | null
  dashboardUrl: string | null
}

export interface InstancesDto {
  total: number
  running: number
  crashed: number
  restarting: number
}

export interface DomainDto {
  domain: string
  kind: "railway" | "custom"
  /** Custom domains: verified with a valid certificate. Railway domains: true while active. */
  ok: boolean | null
  /** Railway's word for a custom domain's certificate, when it is not valid. */
  note: string | null
}

export interface VolumeDto {
  id: string
  name: string
  mountPath: string
  sizeMB: number | null
  usedMB: number | null
  pct: number | null
  state: string | null
}

export interface MemoryDto {
  usedGb: number | null
  limitGb: number | null
  pct: number | null
}

export interface ServiceDto {
  id: string
  name: string
  kind: ServiceKind
  repo: string | null
  image: string | null
  region: string | null
  replicas: number | null
  /** The newest deployment, whatever its state. */
  latest: DeploymentDto | null
  /** The deployment serving traffic now (may be older than `latest` while a build runs). */
  active: DeploymentDto | null
  /** Since when the active deployment runs (its last status change), for "up for 3 days". */
  upSince: string | null
  instances: InstancesDto
  domains: DomainDto[]
  volumes: VolumeDto[]
  memory: MemoryDto | null
  /** Error lines of the last hour in the active deployment's logs; null when not read. */
  errorsLastHour: number | null
  /** The error scan hit its line cap: the real number is higher. */
  errorsCapped: boolean
  dashboardUrl: string | null
}

export type ProblemKey = "deploy_failed" | "deploy_crashed" | "instance_crashed" | "instance_restarting" | "memory_high" | "volume_full" | "errors_many" | "domain_issue" | "building_long"

export interface ProblemDto {
  key: ProblemKey
  tone: "red" | "orange"
  serviceId: string
  serviceName: string
  /** Numbers and names for the sentence: pct, count, domain, volume, minutes. */
  params: Record<string, string | number>
}

export interface OverviewResponse {
  mode: RailwayMode
  project: { id: string; name: string }
  environment: { id: string; name: string }
  services: ServiceDto[]
  problems: ProblemDto[]
  /** When the data was read from Railway. */
  readAt: string
  /** Read for this answer (false: from the cache). */
  fresh: boolean
  /** Railway did not answer: this is the last good read. */
  stale: boolean
  /** Parts that could not be read (metrics, errors), the rest is still shown. */
  partial: Array<"memory" | "errors" | "volumes">
  dashboardUrl: string
}

export interface DeploymentsResponse {
  serviceId: string
  items: DeploymentDto[]
  readAt: string
  fresh: boolean
}

export type LogKind = "deploy" | "build"
export type Severity = "error" | "warn" | "info" | "debug"

export interface LogLineDto {
  ts: string
  severity: Severity
  /** Counted as an error line: an error severity, or an error word or a 5xx status in the message. */
  error: boolean
  message: string
}

export interface LogsResponse {
  deploymentId: string
  serviceId: string | null
  kind: LogKind
  /** Newest first. */
  lines: LogLineDto[]
  /** How many secrets were masked in these lines. */
  masked: number
  errorsOnly: boolean
  q: string
  minutes: number
  limit: number
  /** Railway sent as many lines as asked: older ones exist. */
  capped: boolean
  readAt: string
  fresh: boolean
}

export type MetricRange = "1h" | "6h" | "24h"

export interface PointDto {
  /** Seconds since the epoch. */
  t: number
  v: number
}

export interface MetricsResponse {
  serviceId: string
  range: MetricRange
  sampleSeconds: number
  cpu: PointDto[]
  cpuLimit: number | null
  memory: PointDto[]
  memoryLimit: number | null
  rx: PointDto[]
  tx: PointDto[]
  summary: {
    cpuAvg: number | null
    cpuMax: number | null
    memoryMax: number | null
    memoryLast: number | null
    memoryPct: number | null
    rxTotal: number | null
    txTotal: number | null
  }
  readAt: string
  fresh: boolean
}

export type VariableState = "set" | "empty" | "reference"

export interface VariableDto {
  name: string
  state: VariableState
}

export interface VariablesResponse {
  serviceId: string
  /** Names only, sorted. A value never leaves the server. */
  items: VariableDto[]
  readAt: string
  fresh: boolean
}

export interface ErrorBody {
  type: string
  message: string
  kind?: string
}
