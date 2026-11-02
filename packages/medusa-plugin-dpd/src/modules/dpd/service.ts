import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import DpdDispatch from "./models/dpd-dispatch"
import DpdDocument from "./models/dpd-document"
import DpdEvent from "./models/dpd-event"
import DpdSetting from "./models/dpd-setting"
import DpdShipment from "./models/dpd-shipment"
import type { DpdMode } from "./lib/constants"
import { missingOptions, resolveOptions, secretsOf, type DpdPluginOptions, type ResolvedDpdOptions } from "./lib/options"
import { maskSecrets } from "./lib/security"
import { senderProblems, type SenderProblem } from "./lib/sender"

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
 * DPD module service: generated CRUD for the five tables (the shipments,
 * their documents, the history, the handovers, the settings) plus the
 * resolved options and masking. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The work (plans, shipments, labels,
 * handovers, statuses, the demo) lives in `src/workflows/dpd` and calls the
 * generated methods (`svc.listDpdShipments(...)`) from the outside. A custom
 * method here that calls `this.list*` breaks on the Koda Plus demo with a
 * `fork` error of the entity manager.
 *
 * MISSING OPTIONS DO NOT BREAK THE BOOT. Without credentials the module
 * registers, the admin says "not configured" and nothing is sent to DPD.
 * Demo mode only with `demo: true`.
 */
class DpdModuleService extends MedusaService({
  DpdShipment,
  DpdDocument,
  DpdEvent,
  DpdDispatch,
  DpdSetting,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedDpdOptions

  constructor(deps: InjectedDependencies, options?: DpdPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = loggerOf(deps)
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[dpd] Demo mode (demo: true): simulated shipments from the store's orders, nothing goes to DPD.")
    } else if (!this.isConfigured()) {
      this.logger_.warn(
        `[dpd] NOT CONFIGURED (${this.options_.mode}), missing: ${this.missingOptions().join(", ")}. Fulfillments are recorded and wait in "To create"; nothing goes to DPD until the credentials are set. For sample data set demo: true.`,
      )
    } else if (this.options_.mode === "sandbox") {
      this.logger_.info("[dpd] DPDServices sandbox (the DPD demo host). Set mode: \"live\" for production.")
    }
    if (this.options_.problems.length > 0) this.logger_.warn(`[dpd] Ignored option values: ${this.mask(this.options_.problems.join("; "))}.`)
    const sender = this.senderProblems()
    if (sender.length > 0) this.logger_.warn(`[dpd] Sender to fix before shipping: ${sender.map((p) => `${p.path} ${p.code}${p.max ? ` (max ${p.max})` : ""}`).join("; ")}.`)
  }

  /** Resolved options WITH the credentials. Server side only, never send to the admin. */
  getOptions(): ResolvedDpdOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  /** demo, sandbox or live. Every row and setting is kept per mode. */
  mode(): DpdMode {
    return this.options_.mode
  }

  /** Shipments can be created: demo mode, or a login, a password and a master FID. */
  isConfigured(): boolean {
    return missingOptions(this.options_).length === 0
  }

  missingOptions(): string[] {
    return missingOptions(this.options_)
  }

  /** The sender, orderer and per location senders checked against the DPD limits. */
  senderProblems(): SenderProblem[] {
    return senderProblems(this.options_)
  }

  /** Masks the passwords, the MyPudo key, Basic credentials, key= values and every token-like run of characters. */
  mask(text: string): string {
    return maskSecrets(text, secretsOf(this.options_))
  }
}

export default DpdModuleService
