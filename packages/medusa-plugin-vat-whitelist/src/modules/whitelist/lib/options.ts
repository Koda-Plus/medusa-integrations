/**
 * Options of `@koda-plus/medusa-plugin-vat-whitelist`, passed in
 * `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-vat-whitelist", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting.
 * Demo mode is only ever on with `demo: true`: the checks answer with
 * simulated registry data and nothing is sent outside, unless `live` names
 * the registries that keep answering for real.
 */

import type { GusEnvironment } from "./gus"

/** The registries a Polish NIP can be checked in. EU VAT numbers always go to VIES. */
export const PL_REGISTRIES = ["gus", "whitelist", "vies"] as const
export type PlRegistry = (typeof PL_REGISTRIES)[number]

export interface WhitelistPluginOptions {
  /** Demo mode: checks answer with simulated data, flagged demo. Default: false. */
  demo?: boolean
  /**
   * The registries that answer for real in demo mode, for every number
   * outside the demo samples (a public demo that shows real company data).
   * A list or a comma-separated string. Default: none.
   */
  live?: string[] | string
  /**
   * The base URL of the whitelist API, for a proxy or a mirror.
   * Default: https://wl-api.mf.gov.pl
   */
  baseUrl?: string
  /**
   * A check of the same NIP is repeated after this many hours without asking
   * the registry again (the whitelist answers are valid for the day).
   * Default 24. 0: always ask.
   */
  staleHours?: number | string
  /**
   * The user key of the GUS Business Registry (BIR 1.1), free from GUS on
   * request. Without it GUS is skipped in real mode.
   */
  gusApiKey?: string
  /** "production" (default) or "test" (the GUS test environment and its public key). */
  gusEnvironment?: GusEnvironment | string
  /**
   * The registries of a Polish NIP, in order: the first one that knows the
   * company gives its card. Default ["gus", "whitelist"]: GUS for the
   * company data, the MF whitelist for the VAT status and bank accounts.
   * Add "vies" to check the VAT-UE registration for sales within the EU.
   */
  plRegistries?: string[] | string
  /** How long one registry call may take, in milliseconds. Default 8000. */
  timeoutMs?: number | string
}

export interface ResolvedWhitelistOptions {
  demo: boolean
  live: PlRegistry[]
  baseUrl: string
  staleHours: number
  gusApiKey: string | null
  gusEnvironment: GusEnvironment
  plRegistries: PlRegistry[]
  timeoutMs: number
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/

function bool(value: unknown): boolean {
  return value === true || value === "true"
}

function registries(value: unknown, fallback: PlRegistry[]): PlRegistry[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null
  if (!list) return fallback
  const out: PlRegistry[] = []
  for (const v of list) {
    const k = typeof v === "string" ? v.trim().toLowerCase() : ""
    if ((PL_REGISTRIES as readonly string[]).includes(k) && !out.includes(k as PlRegistry)) out.push(k as PlRegistry)
  }
  return out
}

function number(value: unknown): number {
  return typeof value === "string" ? Number(value.trim()) : Number(value)
}

export function resolveOptions(o: WhitelistPluginOptions | undefined | null): ResolvedWhitelistOptions {
  const opts = o && typeof o === "object" ? o : {}
  const base = typeof opts.baseUrl === "string" && URL_PATTERN.test(opts.baseUrl.trim()) ? opts.baseUrl.trim().replace(/\/+$/, "") : "https://wl-api.mf.gov.pl"
  const hours = number(opts.staleHours)
  const timeout = number(opts.timeoutMs)
  const pl = registries(opts.plRegistries, ["gus", "whitelist"])
  return {
    demo: bool(opts.demo),
    live: registries(opts.live, []),
    baseUrl: base,
    staleHours: opts.staleHours === undefined || opts.staleHours === "" || !Number.isFinite(hours) ? 24 : Math.min(24 * 365, Math.max(0, Math.floor(hours))),
    gusApiKey: typeof opts.gusApiKey === "string" && opts.gusApiKey.trim() ? opts.gusApiKey.trim() : null,
    gusEnvironment: opts.gusEnvironment === "test" ? "test" : "production",
    /* An empty list would check nothing: the default order instead. */
    plRegistries: pl.length > 0 ? pl : ["gus", "whitelist"],
    timeoutMs: opts.timeoutMs === undefined || opts.timeoutMs === "" || !Number.isFinite(timeout) ? 8000 : Math.min(30_000, Math.max(1000, Math.floor(timeout))),
  }
}

/** The GUS key in use: the configured one, or the public key of the test environment. */
export function gusKey(o: ResolvedWhitelistOptions): string | null {
  return o.gusApiKey ?? (o.gusEnvironment === "test" ? "abcde12345abcde12345" : null)
}

/**
 * How a registry answers with these options: for real, simulated (demo), or
 * not at all (GUS without a key, or a registry left out of plRegistries).
 */
export type RegistryMode = "live" | "demo" | "missing_key" | "off"

export function registryMode(o: ResolvedWhitelistOptions, r: PlRegistry): RegistryMode {
  if (r !== "vies" && !o.plRegistries.includes(r)) return "off"
  if (o.demo && !o.live.includes(r)) return "demo"
  if (r === "gus" && !gusKey(o)) return "missing_key"
  return "live"
}
