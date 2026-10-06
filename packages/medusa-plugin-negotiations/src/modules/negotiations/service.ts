import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import Negotiation from "./models/negotiation"
import NegotiationDraftOrder from "./models/negotiation-draft-order"
import NegotiationMessage from "./models/negotiation-message"
import NegotiationRun from "./models/negotiation-run"
import NegotiationSetting from "./models/negotiation-setting"
import { resolveOptions, type NegotiationsPluginOptions, type ResolvedNegotiationsOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Negotiations module service: generated CRUD for the five tables plus the
 * resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The flows (open, reply, counter,
 * accept, reject, expire, the demo story, the draft order writer) live in
 * `src/workflows/negotiations` and work on the tables through `lib/store.ts`
 * (SQL on Medusa's own connection, see why there). A custom method here that
 * calls `this.list*` breaks on the Koda Plus demo with a `fork` error of the
 * entity manager, and every flow outside is reusable from your own
 * workflows anyway. The generated methods (`listNegotiations`,
 * `listNegotiationMessages`...) stay available for custom code that only
 * reads.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class NegotiationsModuleService extends MedusaService({
  Negotiation,
  NegotiationMessage,
  NegotiationSetting,
  NegotiationRun,
  NegotiationDraftOrder,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedNegotiationsOptions

  constructor(deps: InjectedDependencies, options?: NegotiationsPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[negotiations] Demo mode: sample threads from the catalog, flagged demo, apart from real ones.")
    }
  }

  getOptions(): ResolvedNegotiationsOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }
}

export default NegotiationsModuleService
