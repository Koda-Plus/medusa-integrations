/**
 * Options of `@koda-plus/medusa-plugin-railway`, passed in `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-railway", options: { token: process.env.RAILWAY_READ_TOKEN } }]
 *
 * Every key is optional. A missing token never breaks the boot: the module
 * registers, the admin page shows the setup, and nothing calls Railway until
 * a token is there. Numbers and booleans may come as strings (environment
 * variables); broken values fall back to the defaults.
 */
import {
  DEFAULT_CACHE_SECONDS,
  DEFAULT_DASHBOARD_URL,
  DEFAULT_REQUESTS_PER_HOUR,
  DEFAULT_REQUESTS_PER_SECOND,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOKEN_ENV,
  MAX_CACHE_SECONDS,
  MAX_REQUESTS_PER_HOUR,
  MAX_REQUESTS_PER_SECOND,
  MAX_TIMEOUT_MS,
  MIN_CACHE_SECONDS,
  MIN_TIMEOUT_MS,
} from "./constants"
import type { TokenKindOption } from "./contract"
import { safeId } from "./security"

export interface RailwayPluginOptions {
  /**
   * The token. A project token (Railway, Project Settings, Tokens) names its
   * project and environment by itself; an account or workspace token needs
   * `projectId`. Railway has no read-only token: the plugin only sends
   * queries, a guard refuses any mutation. Never sent to the browser.
   */
  token?: string
  /** The environment variable the token is read from when `token` is not set. Default RAILWAY_READ_TOKEN. */
  tokenEnv?: string
  /** "project" (header Project-Access-Token), "account" (Authorization: Bearer), or "auto" (default: project first). */
  tokenKind?: TokenKindOption | string
  /** The project to show. A project token implies it. */
  projectId?: string
  /** The environment to show. A project token implies it; with an account token the project's production environment (or its first one). */
  environmentId?: string
  /** The Railway dashboard, for the links. Default https://railway.com. */
  dashboardUrl?: string
  /** Sample data, Railway is never called. Only `true` turns it on. */
  demo?: boolean | string
  /** How long a read is reused, in seconds. Default 60 (15 to 3600). */
  cacheSeconds?: number | string
  /** Requests per second the plugin allows itself. Default 2. */
  requestsPerSecond?: number | string
  /** Requests per rolling hour the plugin allows itself. Default 300 (Railway Hobby allows 1 000 for the whole account). */
  requestsPerHour?: number | string
  /** Timeout of one request in ms. Default 15000. */
  timeoutMs?: number | string
  /** Count error lines of the last hour for the problems tile (one more request per overview). Default true. */
  scanErrors?: boolean | string
}

export interface ResolvedRailwayOptions {
  token: string
  tokenEnv: string
  tokenKind: TokenKindOption
  projectId: string | null
  environmentId: string | null
  dashboardUrl: string
  demo: boolean
  cacheSeconds: number
  requestsPerSecond: number
  requestsPerHour: number
  timeoutMs: number
  scanErrors: boolean
}

/** true for true, "true", "1", "yes", "on"; false for false, "false", "0", "no", "off"; otherwise the fallback. */
export function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const v = value.trim().toLowerCase()
    if (["true", "1", "yes", "on"].includes(v)) return true
    if (["false", "0", "no", "off"].includes(v)) return false
  }
  return fallback
}

export function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** An https base address without a trailing slash, or the fallback. */
export function httpsBase(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback
  try {
    const u = new URL(value.trim())
    if (u.protocol !== "https:") return fallback
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`
  } catch {
    return fallback
  }
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/

export function resolveOptions(input: RailwayPluginOptions | null | undefined, env: Record<string, string | undefined> = process.env): ResolvedRailwayOptions {
  const o = (input ?? {}) as RailwayPluginOptions
  const tokenEnv = typeof o.tokenEnv === "string" && ENV_NAME.test(o.tokenEnv.trim()) ? o.tokenEnv.trim() : DEFAULT_TOKEN_ENV
  const fromOption = typeof o.token === "string" ? o.token.trim() : ""
  const kind = typeof o.tokenKind === "string" ? o.tokenKind.trim().toLowerCase() : ""
  return {
    token: fromOption || String(env[tokenEnv] ?? "").trim(),
    tokenEnv,
    tokenKind: kind === "project" || kind === "account" ? kind : "auto",
    projectId: safeId(o.projectId),
    environmentId: safeId(o.environmentId),
    dashboardUrl: httpsBase(o.dashboardUrl, DEFAULT_DASHBOARD_URL),
    demo: bool(o.demo, false),
    cacheSeconds: int(o.cacheSeconds, DEFAULT_CACHE_SECONDS, MIN_CACHE_SECONDS, MAX_CACHE_SECONDS),
    requestsPerSecond: int(o.requestsPerSecond, DEFAULT_REQUESTS_PER_SECOND, 1, MAX_REQUESTS_PER_SECOND),
    requestsPerHour: int(o.requestsPerHour, DEFAULT_REQUESTS_PER_HOUR, 10, MAX_REQUESTS_PER_HOUR),
    timeoutMs: int(o.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    scanErrors: bool(o.scanErrors, true),
  }
}

/** What keeps the plugin from reading Railway. Empty in demo mode. */
export function missingOptions(o: Pick<ResolvedRailwayOptions, "demo" | "token" | "tokenKind" | "projectId">): string[] {
  if (o.demo) return []
  if (!o.token) return ["token"]
  if (o.tokenKind === "account" && !o.projectId) return ["projectId"]
  return []
}
