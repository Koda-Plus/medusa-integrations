import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import FakturowniaDocument from "./models/fakturownia-document"
import FakturowniaSyncRun from "./models/fakturownia-sync-run"
import { missingOptions, resolveOptions, type FakturowniaPluginOptions, type ResolvedFakturowniaOptions } from "./lib/options"
import { maskSecrets } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Fakturownia module service: generated CRUD for the two tables plus the
 * resolved options and masking. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The work (the outbox, the lookups, the
 * payments, the KSeF status) lives in `src/workflows/fakturownia` and calls
 * the generated methods (`svc.listFakturowniaDocuments(...)`) from the
 * outside. A custom method here that calls `this.list*` breaks on our Medusa
 * demo with a `fork` error of the entity manager, and every flow outside is
 * reusable from your own workflows anyway.
 *
 * MISSING OPTIONS DO NOT BREAK THE BOOT. Without a token the module runs in
 * demo mode; with `demo: false` and no token it registers, the admin says
 * "not configured" and nothing is issued.
 */
class FakturowniaModuleService extends MedusaService({
  FakturowniaDocument,
  FakturowniaSyncRun,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedFakturowniaOptions

  constructor(deps: InjectedDependencies, options?: FakturowniaPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info(
        this.options_.demoReason === "no_token"
          ? "[fakturownia] Demo mode (no apiToken): a simulated Fakturownia account, nothing leaves Medusa."
          : "[fakturownia] Demo mode: a simulated Fakturownia account, nothing leaves Medusa.",
      )
    } else if (!this.isConfigured()) {
      this.logger_.info(`[fakturownia] Waiting for configuration, missing: ${this.missingOptions().join(", ")}.`)
    }
  }

  /** Resolved options WITH the token. Server side only, never send to the admin. */
  getOptions(): ResolvedFakturowniaOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  /** Documents can be issued: demo mode, or a token and a valid account. */
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

export default FakturowniaModuleService
