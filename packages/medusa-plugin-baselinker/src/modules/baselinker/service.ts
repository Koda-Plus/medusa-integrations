import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import BaseLinkerImport from "./models/baselinker-import"
import BaseLinkerInvoice from "./models/baselinker-invoice"
import BaseLinkerOrder from "./models/baselinker-order"
import BaseLinkerPlanItem from "./models/baselinker-plan-item"
import BaseLinkerProduct from "./models/baselinker-product"
import BaseLinkerQuarantine from "./models/baselinker-quarantine"
import BaseLinkerReturn from "./models/baselinker-return"
import BaseLinkerSetting from "./models/baselinker-setting"
import BaseLinkerStockChange from "./models/baselinker-stock-change"
import BaseLinkerSyncRun from "./models/baselinker-sync-run"
import { missingOptions, resolveOptions, type BaseLinkerPluginOptions, type ResolvedBaseLinkerOptions } from "./lib/options"
import { maskSecrets } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/**
 * BaseLinker module service: generated CRUD for the tables plus the resolved
 * options and masking. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The work (reading the catalog, the
 * outbox, the status read, the stock plan) lives in `src/workflows/baselinker`
 * and calls the generated methods (`svc.listBaseLinkerOrders(...)`) from the
 * outside. A custom method here that calls `this.list*` breaks on our Medusa
 * demo with a `fork` error of the entity manager, and every flow outside is
 * reusable from your own workflows anyway.
 *
 * MISSING OPTIONS DO NOT BREAK THE BOOT. The module always registers; the
 * admin lists what is missing and each job waits for the options it needs.
 */
class BaseLinkerModuleService extends MedusaService({
  BaseLinkerProduct,
  BaseLinkerOrder,
  BaseLinkerStockChange,
  BaseLinkerSyncRun,
  BaseLinkerSetting,
  BaseLinkerPlanItem,
  BaseLinkerQuarantine,
  BaseLinkerImport,
  BaseLinkerReturn,
  BaseLinkerInvoice,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedBaseLinkerOptions

  constructor(deps: InjectedDependencies, options?: BaseLinkerPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[baselinker] Demo mode: a simulated BaseLinker built from the catalog, nothing leaves Medusa.")
    } else if (!this.isConfigured()) {
      this.logger_.info(`[baselinker] Waiting for configuration, missing: ${this.missingOptions().join(", ")}.`)
    }
  }

  /** Resolved options WITH the token. Server side only, never send to the admin. */
  getOptions(): ResolvedBaseLinkerOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  /** Every option the enabled features need is present (always true in demo mode). */
  isConfigured(): boolean {
    return missingOptions(this.options_).length === 0
  }

  missingOptions(): string[] {
    return missingOptions(this.options_)
  }

  /** Masks the API token and every token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, [this.options_.apiToken])
  }
}

export default BaseLinkerModuleService
