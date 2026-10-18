import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import InpostPayBasket from "./models/basket"
import InpostPaySetting from "./models/setting"
import { resolveOptions, type InpostPayPluginOptions, type ResolvedInpostPayOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * InPost Pay module service: generated CRUD for the baskets and the
 * settings, plus the resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. Binding, the Merchant API answers and
 * placing the order live in `lib/*` and `workflows/inpostpay/*`, which call
 * the generated methods from OUTSIDE the service, through the container.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class InpostPayModuleService extends MedusaService({
  InpostPayBasket,
  InpostPaySetting,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedInpostPayOptions

  constructor(deps: InjectedDependencies, options?: InpostPayPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[inpostpay] Demo mode: baskets are bound in memory and confirmed by a simulation; InPost is never called.")
    } else if (this.options_.mode === "off") {
      this.logger_.info("[inpostpay] No InPost Pay keys: the routes answer politely and the admin shows the setup.")
    }
  }

  /** Demo mode (hosts use it to let a demo account write). */
  isDemo(): boolean {
    return this.options_.demo
  }

  getOptions(): ResolvedInpostPayOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }
}

export default InpostPayModuleService
