import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import InpostParcel from "./models/inpost-parcel"
import InpostParcelEvent from "./models/inpost-parcel-event"
import InpostSetting from "./models/inpost-setting"
import { missingOptions, resolveOptions, type InpostPluginOptions, type ResolvedInpostOptions } from "./lib/options"
import { maskSecrets } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/** The container's logger; the console where a container has none (a bare module test), so the boot never breaks on a log line. */
function loggerOf(deps: InjectedDependencies | undefined): Logger {
  try {
    if (deps?.logger) return deps.logger
  } catch {
    /* not registered in this container */
  }
  return console as unknown as Logger
}

/**
 * InPost module service: generated CRUD for the three tables (the shipments,
 * their history, the settings) plus the resolved options and masking.
 * Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The work (plans, creating shipments,
 * statuses, the webhook, the demo) lives in `src/workflows/inpost` and calls
 * the generated methods (`svc.listInpostParcels(...)`) from the outside. A
 * custom method here that calls `this.list*` breaks on the Koda Plus demo
 * with a `fork` error of the entity manager.
 *
 * MISSING OPTIONS DO NOT BREAK THE BOOT. Without a token the module runs in
 * demo mode; with `demo: false` and no token it registers, the admin says
 * "not configured" and nothing is sent to InPost.
 */
class InpostModuleService extends MedusaService({
  InpostParcel,
  InpostParcelEvent,
  InpostSetting,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedInpostOptions

  constructor(deps: InjectedDependencies, options?: InpostPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = loggerOf(deps)
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[inpost] Demo mode (demo: true): simulated shipments from the store's orders, nothing goes to InPost.")
    } else if (!this.isConfigured()) {
      this.logger_.warn(
        `[inpost] NOT CONFIGURED, missing: ${this.missingOptions().join(", ")}. Fulfillments are recorded and wait in "To ship"; nothing goes to InPost until the token and the organization are set. For sample data set demo: true.`,
      )
    } else if (this.options_.sandbox) {
      this.logger_.info("[inpost] ShipX sandbox.")
    }
    if (this.options_.problems.length > 0) this.logger_.warn(`[inpost] Ignored option values: ${this.options_.problems.join("; ")}.`)
  }

  /** Resolved options WITH the token. Server side only, never send to the admin. */
  getOptions(): ResolvedInpostOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  /** Shipments can be read and created: demo mode, or a token and an organization. */
  isConfigured(): boolean {
    return missingOptions(this.options_).length === 0
  }

  missingOptions(): string[] {
    return missingOptions(this.options_)
  }

  /** Masks the token, the webhook secret and every token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, [this.options_.apiToken, this.options_.webhookSecret])
  }
}

export default InpostModuleService
