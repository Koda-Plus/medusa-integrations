import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import PackagingProduct from "./models/product"
import PackagingUnit from "./models/unit"
import { resolveOptions, type PackagingPluginOptions, type ResolvedPackagingOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Packaging module service: generated CRUD for the two tables plus the
 * resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The flows (set a ladder, split a
 * quantity) live in the routes and lib and work on the tables through the
 * generated methods from OUTSIDE the service.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class PackagingModuleService extends MedusaService({
  PackagingProduct,
  PackagingUnit,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedPackagingOptions

  constructor(deps: InjectedDependencies, options?: PackagingPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[packaging] Demo mode: sample ladders, flagged demo.")
    }
  }

  getOptions(): ResolvedPackagingOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }
}

export default PackagingModuleService
