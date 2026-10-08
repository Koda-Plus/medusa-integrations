import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import CreditLimit from "./models/limit"
import CreditOrder from "./models/order"
import { resolveOptions, type CreditPluginOptions, type ResolvedCreditOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Trade Credit module service: generated CRUD for the two tables plus the
 * resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The flows (set a limit, place a credit
 * order, the overdue job) live in the routes, subscribers and jobs and work
 * on the tables through the generated methods from OUTSIDE the service.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class CreditModuleService extends MedusaService({
  CreditLimit,
  CreditOrder,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedCreditOptions

  constructor(deps: InjectedDependencies, options?: CreditPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[credit] Demo mode: sample limits, flagged demo.")
    }
  }

  getOptions(): ResolvedCreditOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }
}

export default CreditModuleService
