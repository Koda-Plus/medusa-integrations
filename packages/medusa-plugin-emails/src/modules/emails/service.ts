import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import EmailsMessage from "./models/emails-message"
import EmailsSetting from "./models/emails-setting"
import { missingOptions, resolveOptions, type EmailsPluginOptions, type ResolvedEmailsOptions } from "./lib/options"
import { maskAll } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/**
 * E-mails module service: generated CRUD for the send log and the settings,
 * plus the resolved options and masking. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. Sending lives in the notification
 * provider (`src/providers/emails`), the flows in `src/workflows/emails`;
 * they use the shared database connection and the generated methods from the
 * outside. A custom method here that calls `this.list*` breaks on the Koda
 * Plus demo with a `fork` error of the entity manager.
 *
 * MISSING OPTIONS DO NOT BREAK THE BOOT. Without an API key the provider
 * logs instead of sending, and the admin says what is missing.
 */
class EmailsModuleService extends MedusaService({
  EmailsMessage,
  EmailsSetting,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedEmailsOptions

  constructor(deps: InjectedDependencies, options?: EmailsPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[emails] Demo mode: messages go to a simulated outbox in the admin, nothing leaves the server.")
    } else if (this.options_.mode === "dev") {
      this.logger_.info("[emails] No Resend API key: messages are logged and recorded, not sent.")
    } else if (!this.isConfigured()) {
      this.logger_.warn(`[emails] Missing options: ${this.missingOptions().join(", ")}. Nothing is sent until they are set.`)
    }
    if (this.options_.problems.length > 0) this.logger_.warn(`[emails] Ignored option values: ${this.options_.problems.join("; ")}.`)
  }

  /** Resolved options WITH the API key. Server side only, never send to the admin. */
  getOptions(): ResolvedEmailsOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  /** Messages can go out: demo mode, or an API key and a valid From. */
  isConfigured(): boolean {
    return missingOptions(this.options_).length === 0
  }

  missingOptions(): string[] {
    return missingOptions(this.options_)
  }

  /** Masks addresses, the API key and every key-like run of characters. */
  mask(text: string): string {
    return maskAll(text, [this.options_.apiKey])
  }
}

export default EmailsModuleService
