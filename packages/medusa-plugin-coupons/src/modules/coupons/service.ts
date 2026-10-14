import type { Logger } from "@medusajs/framework/types"
import { resolveOptions, type CouponsPluginOptions, type ResolvedCouponsOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Coupons module service: the resolved options and the logger. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The module keeps no tables: a coupon IS
 * a promotion of Medusa's own promotion module, and every read and write
 * lives in `src/workflows/coupons` (Query, the promotion module and Medusa's
 * own workflows), so nothing here can drift from what Medusa keeps.
 */
class KodaCouponsModuleService {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedCouponsOptions

  constructor(deps: InjectedDependencies, options?: CouponsPluginOptions) {
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.problems.length) {
      this.logger_.warn(`[coupons] Ignored option values: ${this.options_.problems.join("; ")}`)
    }
  }

  getOptions(): ResolvedCouponsOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }
}

export default KodaCouponsModuleService
