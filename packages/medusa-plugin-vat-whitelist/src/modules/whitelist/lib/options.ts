/**
 * Options of `@koda-plus/medusa-plugin-vat-whitelist`, passed in
 * `medusa-config.ts`:
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-vat-whitelist", options: { ... } }]
 *
 * Every key is optional and nothing here can stop Medusa from starting.
 * Demo mode is only ever on with `demo: true`: the checks answer with
 * simulated registry data and nothing is sent outside.
 */
export interface WhitelistPluginOptions {
  /** Demo mode: checks answer with simulated data, flagged demo. Default: false. */
  demo?: boolean
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
   * The API key of the GUS Business Registry (BIR 1.1), for the REGON and
   * legal form check next to the whitelist. Without it the GUS check is
   * skipped in real mode; demo mode always answers with simulated data.
   */
  gusApiKey?: string
}

export interface ResolvedWhitelistOptions {
  demo: boolean
  baseUrl: string
  staleHours: number
  gusApiKey: string | null
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/

function bool(value: unknown): boolean {
  return value === true || value === "true"
}

export function resolveOptions(o: WhitelistPluginOptions | undefined | null): ResolvedWhitelistOptions {
  const opts = o && typeof o === "object" ? o : {}
  const base = typeof opts.baseUrl === "string" && URL_PATTERN.test(opts.baseUrl.trim()) ? opts.baseUrl.trim().replace(/\/+$/, "") : "https://wl-api.mf.gov.pl"
  const hours = typeof opts.staleHours === "string" ? Number(opts.staleHours.trim()) : Number(opts.staleHours)
  return {
    demo: bool(opts.demo),
    baseUrl: base,
    staleHours: Number.isFinite(hours) ? Math.min(24 * 365, Math.max(0, Math.floor(hours))) : 24,
    gusApiKey: typeof opts.gusApiKey === "string" && opts.gusApiKey.trim() ? opts.gusApiKey.trim() : null,
  }
}
