import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import LoyaltyAccount from "./models/account"
import LoyaltyTransaction from "./models/transaction"
import { resolveOptions, type LoyaltyPluginOptions, type ResolvedLoyaltyOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Loyalty module service: generated CRUD for the two tables plus the
 * resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The flows (earn, redeem, adjust) live
 * in `src/workflows/loyalty` and work on the tables through the generated
 * methods from OUTSIDE the service: a custom method here that calls
 * `this.list*` breaks on the Koda Plus demo with a `fork` error of the
 * entity manager (the original app module hit exactly that).
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class LoyaltyModuleService extends MedusaService({
  LoyaltyAccount,
  LoyaltyTransaction,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedLoyaltyOptions

  constructor(deps: InjectedDependencies, options?: LoyaltyPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[loyalty] Demo mode: accounts and transactions flagged demo.")
    }
  }

  getOptions(): ResolvedLoyaltyOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }
}

export default LoyaltyModuleService
