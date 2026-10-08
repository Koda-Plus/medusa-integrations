import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import ComplianceOperator from "./models/responsible-person"
import ComplianceProduct from "./models/product-compliance"
import ComplianceConsent from "./models/consent-record"
import ComplianceDsr from "./models/dsr-request"
import CompliancePriceSnapshot from "./models/price-snapshot"
import { resolveOptions, type CompliancePluginOptions, type ResolvedComplianceOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * EU Compliance module service: generated CRUD for the five tables plus the
 * resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The flows (assign a responsible person,
 * record consent, file a data subject request, snapshot prices) live in
 * `src/api/*` and the seed scripts and call the generated methods from
 * OUTSIDE the service, through the container. A custom method here that calls
 * `this.list*` breaks on the Koda Plus demo with a `fork` error of the entity
 * manager.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class ComplianceModuleService extends MedusaService({
  ComplianceOperator,
  ComplianceProduct,
  ComplianceConsent,
  ComplianceDsr,
  CompliancePriceSnapshot,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedComplianceOptions

  constructor(deps: InjectedDependencies, options?: CompliancePluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[compliance] Demo mode: sample operators, product records and price snapshots, flagged demo.")
    }
  }

  getOptions(): ResolvedComplianceOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }
}

export default ComplianceModuleService
