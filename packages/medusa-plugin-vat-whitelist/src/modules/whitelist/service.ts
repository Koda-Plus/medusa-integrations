import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import WhitelistEntity from "./models/entity"
import WhitelistCheck from "./models/check"
import { resolveOptions, type ResolvedWhitelistOptions, type WhitelistPluginOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * VAT Whitelist module service: generated CRUD for the two tables plus the
 * resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The checks live in `lib/check.ts` and
 * the routes run them and write the tables through the generated methods from
 * OUTSIDE the service, through the container.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class WhitelistModuleService extends MedusaService({
  WhitelistEntity,
  WhitelistCheck,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedWhitelistOptions

  constructor(deps: InjectedDependencies, options?: WhitelistPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[whitelist] Demo mode: checks answer with simulated registry data.")
    }
  }

  getOptions(): ResolvedWhitelistOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }
}

export default WhitelistModuleService
