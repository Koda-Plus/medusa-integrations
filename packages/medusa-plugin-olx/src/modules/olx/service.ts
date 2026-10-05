import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import OlxAdvert from "./models/olx-advert"
import OlxAlert from "./models/olx-alert"
import OlxConnection from "./models/olx-connection"
import OlxPlanItem from "./models/olx-plan-item"
import OlxPublication from "./models/olx-publication"
import OlxState from "./models/olx-state"
import OlxSyncRun from "./models/olx-sync-run"
import OlxThread from "./models/olx-thread"
import OlxWriterRun from "./models/olx-writer-run"
import { missingOptions, resolveOptions, type OlxPluginOptions, type ResolvedOlxOptions } from "./lib/options"
import { maskSecrets } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/**
 * OLX module service: generated CRUD for the tables plus the resolved
 * options. The business logic (OAuth, the Partner API, plans, writers) lives
 * in `lib/*` and `workflows/olx`, which call the generated methods from the
 * outside. The service itself stays thin: no custom method touches the
 * database.
 *
 * MISSING CREDENTIALS DO NOT BREAK THE BOOT. The module always registers;
 * without them the admin tells what is missing and the scheduled jobs wait.
 */
class OlxModuleService extends MedusaService({
  OlxConnection,
  OlxAdvert,
  OlxSyncRun,
  OlxAlert,
  OlxPlanItem,
  OlxPublication,
  OlxWriterRun,
  OlxThread,
  OlxState,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedOlxOptions

  constructor(deps: InjectedDependencies, options?: OlxPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[olx] Demo mode: a simulated OLX account from the catalog, no requests to OLX.")
    } else if (!this.isConfigured()) {
      this.logger_.info(`[olx] Waiting for configuration, missing: ${this.missingOptions().join(", ")}.`)
    }
  }

  /** Resolved options WITH secrets. Server side only, never send to the admin. */
  getOptions(): ResolvedOlxOptions {
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

  /** Masks the client secret and every long token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, [this.options_.clientSecret, this.options_.encryptionKey])
  }
}

export default OlxModuleService
