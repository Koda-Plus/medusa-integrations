import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import VonHalskyOffer from "./models/offer"
import VonHalskyOrder from "./models/order"
import VonHalskySyncLog from "./models/sync-log"
import VonHalskySetting from "./models/setting"
import { resolveOptions, type ResolvedVonHalskyOptions, type VonHalskyPluginOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * InPost Von Halsky module service: generated CRUD for the offers, the
 * marketplace orders, the sync log and the settings, plus the resolved
 * options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. Building offers, importing orders and
 * sending tracking live in `lib/*` and `workflows/vonhalsky/*`, which call
 * the generated methods from OUTSIDE the service, through the container.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class VonHalskyModuleService extends MedusaService({
  VonHalskyOffer,
  VonHalskyOrder,
  VonHalskySyncLog,
  VonHalskySetting,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedVonHalskyOptions

  constructor(deps: InjectedDependencies, options?: VonHalskyPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[vonhalsky] Demo mode: offers, orders and tracking run on the store catalog; the marketplace is never called.")
    } else if (this.options_.mode === "off") {
      this.logger_.info("[vonhalsky] No InPost Von Halsky credentials: the routes answer politely and the admin shows the setup.")
    } else {
      this.logger_.info(`[vonhalsky] ${this.options_.mode} credentials are set; the seller API client waits for the official documentation, so nothing is sent yet.`)
    }
  }

  /** Demo mode (hosts use it to let a demo account write). */
  isDemo(): boolean {
    return this.options_.demo
  }

  getOptions(): ResolvedVonHalskyOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }
}

export default VonHalskyModuleService
