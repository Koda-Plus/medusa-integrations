import type { Logger } from "@medusajs/framework/types"
import { missingOptions, resolveOptions, type RailwayPluginOptions, type ResolvedRailwayOptions } from "./lib/options"
import { maskSecrets } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Railway module service: the resolved options, masking, and nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The module keeps no tables: every read
 * lives in `src/workflows/railway` (one client and one cache per service)
 * and is reusable from your own code.
 *
 * A MISSING TOKEN NEVER BREAKS THE BOOT. The module always registers;
 * without a token the admin page shows the setup, a token Railway refuses
 * shows up on the page as an error, never as a crash.
 */
class KodaRailwayModuleService {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedRailwayOptions

  constructor(deps: InjectedDependencies, options?: RailwayPluginOptions) {
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    const o = this.options_
    if (o.demo) {
      this.logger_.info("[railway] Demo mode: a sample Railway project, no requests to Railway.")
      if (process.env.NODE_ENV === "production") this.logger_.warn("[railway] Demo mode is on in production: the admin shows a sample project, not your hosting. Remove demo: true unless this is a demo store.")
    } else if (!o.token) {
      this.logger_.info(`[railway] Waiting for configuration: set ${o.tokenEnv} (a Railway project token). The admin page shows the setup.`)
    } else {
      this.logger_.info("[railway] Reading Railway with queries only: the client refuses any mutation, because Railway tokens are not read only.")
    }
  }

  /** Resolved options WITH the token. Server side only, never send to the admin. */
  getOptions(): ResolvedRailwayOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  isConfigured(): boolean {
    return missingOptions(this.options_).length === 0
  }

  missingOptions(): string[] {
    return missingOptions(this.options_)
  }

  /** Masks the token and every secret shape in a text for logs and the admin. */
  mask(text: unknown): string {
    return maskSecrets(text, [this.options_.token])
  }
}

export default KodaRailwayModuleService
