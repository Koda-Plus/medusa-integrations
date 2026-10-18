import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import KitSubscriberLog from "./models/subscriber-log"
import KitSetting from "./models/setting"
import { resolveOptions, type KitPluginOptions, type ResolvedKitOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Kit module service: generated CRUD for the subscription log and the
 * settings, plus the resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The subscribing lives in
 * `lib/subscribe.ts` and the routes run it and write the tables through the
 * generated methods from OUTSIDE the service, through the container.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class KitModuleService extends MedusaService({
  KitSubscriberLog,
  KitSetting,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedKitOptions

  constructor(deps: InjectedDependencies, options?: KitPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[kit] Demo mode: a sample Kit account in memory, Kit is never called.")
    } else if (!this.options_.apiKey) {
      this.logger_.info("[kit] No Kit API key: the store route answers politely and the admin shows the setup.")
    }
  }

  getOptions(): ResolvedKitOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }
}

export default KitModuleService
