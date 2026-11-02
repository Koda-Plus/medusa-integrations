/**
 * FROM RAILWAY'S ANSWERS TO THE PANEL'S DTOS. No runtime imports beyond the
 * pure helpers. Railway's shapes are read defensively (every field may be
 * missing or null); text that reaches the browser (commit messages, log
 * lines) is masked here.
 */
import { MAX_POINTS } from "./constants"
import type {
  CommitDto,
  DeployState,
  DeploymentDto,
  DomainDto,
  InstancesDto,
  LogLineDto,
  MemoryDto,
  PointDto,
  ServiceDto,
  ServiceKind,
  Severity,
  Tone,
  VariableDto,
  VolumeDto,
} from "./contract"
import { maskSecretsCounted } from "./security"
import type { RawDeployment, RawLog, RawMetric, RawServiceInstance, RawVolumeInstance } from "./railway-types"

/* ------------------------------------------------------------------ */
/* Deployment states                                                   */
/* ------------------------------------------------------------------ */

const STATE_OF: Record<string, DeployState> = {
  SUCCESS: "success",
  BUILDING: "building",
  DEPLOYING: "deploying",
  INITIALIZING: "deploying",
  QUEUED: "queued",
  WAITING: "waiting",
  NEEDS_APPROVAL: "waiting",
  FAILED: "failed",
  CRASHED: "crashed",
  SLEEPING: "sleeping",
  REMOVED: "removed",
  REMOVING: "removed",
  SKIPPED: "skipped",
}

/** Railway's status word to the panel's state; an unknown word is "unknown", never an error. */
export function deployState(status: unknown): DeployState {
  return STATE_OF[String(status ?? "").toUpperCase()] ?? "unknown"
}

const TONE_OF_STATE: Record<DeployState, Tone> = {
  success: "green",
  building: "blue",
  deploying: "blue",
  queued: "blue",
  waiting: "orange",
  failed: "red",
  crashed: "red",
  sleeping: "grey",
  removed: "grey",
  skipped: "grey",
  unknown: "grey",
}

export function toneOfState(state: DeployState): Tone {
  return TONE_OF_STATE[state]
}

/** Still on its way: building, deploying, queued or waiting. */
export function inProgress(state: DeployState): boolean {
  return state === "building" || state === "deploying" || state === "queued" || state === "waiting"
}

/* ------------------------------------------------------------------ */
/* Small readers                                                       */
/* ------------------------------------------------------------------ */

export function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  const d = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits

export interface Links {
  service(serviceId: string): string | null
  deployment(serviceId: string | null, deploymentId: string): string | null
}

/** The commit behind a deployment, from Railway's `meta` (commitHash, commitMessage, commitAuthor, branch, repo). */
export function commitOf(meta: unknown, secrets: readonly string[] = []): CommitDto | null {
  if (!meta || typeof meta !== "object") return null
  const m = meta as Record<string, unknown>
  const sha = str(m.commitHash)
  const rawMessage = str(m.commitMessage)
  const message = rawMessage ? maskSecretsCounted(rawMessage.split("\n")[0].slice(0, 300), secrets).text : null
  const author = str(m.commitAuthor)
  const branch = str(m.branch)
  const repo = str(m.repo)
  if (!sha && !message && !author && !branch) return null
  return { sha, short: sha ? sha.slice(0, 7) : null, message, author, branch, repo }
}

export function deploymentOf(raw: RawDeployment | null | undefined, links: Links, serviceId: string | null, secrets: readonly string[] = []): DeploymentDto | null {
  const id = str(raw?.id)
  if (!raw || !id) return null
  const status = String(raw.status ?? "").toUpperCase()
  const state = deployState(status)
  const createdAt = iso(raw.createdAt)
  const updatedAt = iso(raw.statusUpdatedAt ?? raw.updatedAt)
  const finished = !inProgress(state)
  const durationMs = finished && createdAt && updatedAt ? Math.max(0, Date.parse(updatedAt) - Date.parse(createdAt)) : null
  return {
    id,
    status: status || "UNKNOWN",
    state,
    tone: toneOfState(state),
    createdAt,
    updatedAt,
    durationMs,
    commit: commitOf(raw.meta, secrets),
    creator: str(raw.creator?.name),
    url: str(raw.staticUrl) ? `https://${String(raw.staticUrl).replace(/^https?:\/\//, "")}` : str(raw.url),
    dashboardUrl: links.deployment(serviceId, id),
  }
}

export function instancesOf(raw: RawDeployment | null | undefined): InstancesDto {
  const list = Array.isArray(raw?.instances) ? raw!.instances! : []
  const count = (s: string) => list.filter((i) => String(i?.status ?? "").toUpperCase() === s).length
  return { total: list.length, running: count("RUNNING"), crashed: count("CRASHED"), restarting: count("RESTARTING") }
}

/** Postgres, Redis and the like from the image (or the name), so the panel can say what a service is. */
export function serviceKind(name: string, image: string | null, repo: string | null): ServiceKind {
  const hay = `${image ?? ""} ${repo ? "" : name}`.toLowerCase()
  if (/postgres|postgis|timescale|pgvector/.test(hay)) return "postgres"
  if (/redis|valkey|keydb|dragonfly/.test(hay)) return "redis"
  if (/mysql|mariadb/.test(hay)) return "mysql"
  if (/mongo/.test(hay)) return "mongo"
  if (/minio|bucket/.test(hay)) return "bucket"
  if (repo || image) return repo ? "app" : "other"
  return "app"
}

export function isDatabase(kind: ServiceKind): boolean {
  return kind === "postgres" || kind === "redis" || kind === "mysql" || kind === "mongo"
}

export function domainsOf(raw: RawServiceInstance["domains"]): DomainDto[] {
  const out: DomainDto[] = []
  for (const d of raw?.customDomains ?? []) {
    const domain = str(d?.domain)
    if (!domain) continue
    const verified = d?.status?.verified
    const cert = str(d?.status?.certificateStatus)
    const certOk = !cert || /^(valid|issued|active|certificate_status_type_valid)$/i.test(cert) || /valid/i.test(cert)
    const ok = verified === false ? false : verified === true ? certOk : null
    out.push({ domain, kind: "custom", ok, note: ok === false ? str(d?.status?.certificateErrorMessage) ?? cert ?? (verified === false ? "not verified" : null) : null })
  }
  for (const d of raw?.serviceDomains ?? []) {
    const domain = str(d?.domain)
    if (!domain) continue
    const sync = String(d?.syncStatus ?? "").toUpperCase()
    out.push({ domain, kind: "railway", ok: sync ? sync === "ACTIVE" || sync === "UNSPECIFIED" : null, note: null })
  }
  return out
}

export function volumeOf(raw: RawVolumeInstance): VolumeDto | null {
  const id = str(raw?.id)
  if (!id) return null
  const sizeMB = num(raw.sizeMB)
  const usedMB = num(raw.currentSizeMB)
  return {
    id,
    name: str(raw.volume?.name) ?? id.slice(0, 8),
    mountPath: str(raw.mountPath) ?? "",
    sizeMB,
    usedMB: usedMB === null ? null : round(usedMB, 1),
    pct: sizeMB && usedMB !== null ? Math.min(100, round((usedMB / sizeMB) * 100, 1)) : null,
    state: str(raw.state),
  }
}

/** The newest deployment of a list (Railway's active list may hold more than one while one drains). */
function newest(list: RawDeployment[] | null | undefined): RawDeployment | null {
  const items = (list ?? []).filter((d) => d && str(d.id))
  if (!items.length) return null
  return items.reduce((a, b) => (Date.parse(String(b.createdAt ?? "")) > Date.parse(String(a.createdAt ?? "")) ? b : a))
}

export function serviceOf(raw: RawServiceInstance, ctx: { links: Links; volumes: RawVolumeInstance[]; secrets?: readonly string[] }): ServiceDto | null {
  const id = str(raw?.serviceId)
  if (!id) return null
  const name = str(raw.serviceName) ?? id.slice(0, 8)
  const repo = str(raw.source?.repo)
  const image = str(raw.source?.image)
  const secrets = ctx.secrets ?? []
  const latest = deploymentOf(raw.latestDeployment, ctx.links, id, secrets)
  const activeRaw = newest(raw.activeDeployments)
  const active = deploymentOf(activeRaw, ctx.links, id, secrets) ?? (latest?.state === "success" ? latest : null)
  const instancesFrom = activeRaw ?? (latest?.state === "success" ? raw.latestDeployment : null)
  return {
    id,
    name,
    kind: serviceKind(name, image, repo),
    repo,
    image,
    region: str(raw.region),
    replicas: num(raw.numReplicas),
    latest,
    active,
    upSince: active ? (active.updatedAt ?? active.createdAt) : null,
    instances: instancesOf(instancesFrom),
    domains: domainsOf(raw.domains),
    volumes: ctx.volumes.filter((v) => v?.serviceId === id).map(volumeOf).filter((v): v is VolumeDto => v !== null),
    memory: null,
    errorsLastHour: null,
    errorsCapped: false,
    dashboardUrl: ctx.links.service(id),
  }
}

/** Services sorted: apps first, then databases, each by name. */
export function sortServices(list: ServiceDto[]): ServiceDto[] {
  return [...list].sort((a, b) => Number(isDatabase(a.kind)) - Number(isDatabase(b.kind)) || a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ */
/* Logs                                                                */
/* ------------------------------------------------------------------ */

export function severityOf(raw: unknown): Severity {
  const s = String(raw ?? "").toLowerCase()
  if (/^(err|error|fatal|crit|critical|alert|emerg|panic)/.test(s)) return "error"
  if (/^warn/.test(s)) return "warn"
  if (/^(debug|trace|verbose|silly)/.test(s)) return "debug"
  return "info"
}

/**
 * An error line: an error severity, an error word, or a 5xx status in an
 * access log line ("GET /store/carts 500", "status=503").
 */
export function isErrorLine(severity: Severity, message: string): boolean {
  if (severity === "error") return true
  /* "error", also as the end of a word ("TypeError", "SequelizeException"); not "errors" as a count. */
  if ((/(error|exception)\b/i.test(message) || /\b(fatal|unhandled|panic|traceback)\b/i.test(message)) && !/\b(0 errors?|no errors?|errors?: 0)\b/i.test(message)) return true
  if (/"\s(5\d\d)\s/.test(message) || /\s(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+(?:HTTP\/[\d.]+"?\s+)?5\d\d\b/.test(message)) return true
  if (/\b(status|statusCode|httpStatus)["']?\s*[=:]\s*5\d\d\b/i.test(message)) return true
  return false
}

export interface LogShape {
  lines: LogLineDto[]
  masked: number
}

/**
 * Railway's lines to the panel's: masked, newest first, optionally only
 * the error lines and only those containing `q` (case-insensitive, after
 * masking, so a search never finds a secret).
 */
export function shapeLogs(raw: RawLog[] | null | undefined, opts: { errorsOnly?: boolean; q?: string; sinceMs?: number | null; secrets?: readonly string[]; maxLength?: number } = {}): LogShape {
  const q = (opts.q ?? "").trim().toLowerCase()
  const maxLength = opts.maxLength ?? 4_000
  let masked = 0
  const lines: LogLineDto[] = []
  for (const l of raw ?? []) {
    const ts = iso(l?.timestamp)
    if (!ts) continue
    if (opts.sinceMs && Date.parse(ts) < opts.sinceMs) continue
    const m = maskSecretsCounted(String(l?.message ?? "").slice(0, maxLength), opts.secrets ?? [])
    const severity = severityOf(l?.severity)
    const error = isErrorLine(severity, m.text)
    if (opts.errorsOnly && !error) continue
    if (q && !m.text.toLowerCase().includes(q)) continue
    masked += m.masked
    lines.push({ ts, severity, error, message: m.text })
  }
  lines.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
  return { lines, masked }
}

/** Error lines in a scan (a capped read counts what it saw). */
export function countErrors(raw: RawLog[] | null | undefined, sinceMs: number): number {
  let n = 0
  for (const l of raw ?? []) {
    const ts = Date.parse(String(l?.timestamp ?? ""))
    if (!Number.isFinite(ts) || ts < sinceMs) continue
    if (isErrorLine(severityOf(l?.severity), String(l?.message ?? ""))) n += 1
  }
  return n
}

/* ------------------------------------------------------------------ */
/* Variables                                                           */
/* ------------------------------------------------------------------ */

/**
 * Names only. Railway answers a JSON object of name to value; the values
 * are looked at for one thing (empty, a reference, or set) and dropped here.
 */
export function variableNames(raw: unknown): VariableDto[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  const out: VariableDto[] = []
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name)) continue
    const v = value === null || value === undefined ? "" : String(value)
    out.push({ name, state: v.trim() === "" ? "empty" : /^\$\{\{[^}]+\}\}$/.test(v.trim()) ? "reference" : "set" })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

/** Points in time order, without duplicates and NaN, thinned to `max` by averaging neighbours. */
export function shapePoints(values: RawMetric["values"], max = MAX_POINTS, digits = 4): PointDto[] {
  const byT = new Map<number, number>()
  for (const p of values ?? []) {
    const t = num(p?.ts)
    const v = num(p?.value)
    if (t === null || v === null) continue
    byT.set(Math.floor(t), v)
  }
  const sorted = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }))
  if (sorted.length <= max) return sorted.map((p) => ({ t: p.t, v: round(p.v, digits) }))
  const size = Math.ceil(sorted.length / max)
  const out: PointDto[] = []
  for (let i = 0; i < sorted.length; i += size) {
    const chunk = sorted.slice(i, i + size)
    out.push({ t: chunk[chunk.length - 1].t, v: round(chunk.reduce((s, p) => s + p.v, 0) / chunk.length, digits) })
  }
  return out
}

export function seriesOf(results: RawMetric[] | null | undefined, measurement: string, serviceId?: string): RawMetric["values"] {
  const found = (results ?? []).filter((r) => r?.measurement === measurement && (serviceId === undefined || r?.tags?.serviceId === serviceId))
  return found.flatMap((r) => r.values ?? [])
}

export function lastValue(points: PointDto[]): number | null {
  return points.length ? points[points.length - 1].v : null
}

export function maxValue(points: PointDto[]): number | null {
  return points.length ? points.reduce((m, p) => (p.v > m ? p.v : m), -Infinity) : null
}

export function avgValue(points: PointDto[]): number | null {
  return points.length ? round(points.reduce((s, p) => s + p.v, 0) / points.length, 4) : null
}

export function sumValue(points: PointDto[]): number | null {
  return points.length ? round(points.reduce((s, p) => s + p.v, 0), 4) : null
}

/** Memory of every service from one grouped read: the last use against the last limit. */
export function memoryByService(results: RawMetric[] | null | undefined): Map<string, MemoryDto> {
  const out = new Map<string, MemoryDto>()
  const ids = new Set((results ?? []).map((r) => r?.tags?.serviceId).filter((x): x is string => typeof x === "string" && x.length > 0))
  for (const id of ids) {
    const used = lastValue(shapePoints(seriesOf(results, "MEMORY_USAGE_GB", id)))
    const limit = lastValue(shapePoints(seriesOf(results, "MEMORY_LIMIT_GB", id)))
    out.set(id, { usedGb: used === null ? null : round(used, 3), limitGb: limit === null ? null : round(limit, 2), pct: used !== null && limit ? Math.min(100, round((used / limit) * 100, 1)) : null })
  }
  return out
}
