import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import AllegroConnection from "./models/allegro-connection"
import AllegroOffer from "./models/allegro-offer"
import AllegroOrder from "./models/allegro-order"
import AllegroSyncRun from "./models/allegro-sync-run"
import { missingOptions, resolveOptions, type AllegroPluginOptions, type ResolvedAllegroOptions } from "./lib/options"
import { maskSecrets } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Allegro module service: generated CRUD for the four tables plus the
 * resolved options. The business logic (device login, token refresh, reading
 * offers and orders) lives in `lib/connection.ts` and the syncs in
 * `workflows/allegro`, all calling the generated methods from the outside.
 * The service itself stays thin: no custom method touches the database.
 *
 * MISSING CREDENTIALS DO NOT BREAK THE BOOT. The module always registers;
 * without them the admin tells what is missing and the scheduled jobs wait.
 */
class AllegroModuleService extends MedusaService({
  AllegroConnection,
  AllegroOffer,
  AllegroOrder,
  AllegroSyncRun,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedAllegroOptions

  constructor(deps: InjectedDependencies, options?: AllegroPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[allegro] Demo mode: sample offers and orders from the catalog, no requests to Allegro.")
    } else if (!this.isConfigured()) {
      this.logger_.info(`[allegro] Waiting for configuration, missing: ${this.missingOptions().join(", ")}.`)
    }
  }

  /** Resolved options WITH secrets. Server side only, never send to the admin. */
  getOptions(): ResolvedAllegroOptions {
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

  /** Masks the client secret, the key and every long token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, [this.options_.clientSecret, this.options_.encryptionKey])
  }
}

export default AllegroModuleService
