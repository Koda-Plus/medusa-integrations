import type { Logger } from "@medusajs/framework/types"
import type { KeyInfoDto } from "./lib/contract"
import { missingOptions, resolveOptions, type ResolvedStripeOptions, type StripePluginOptions } from "./lib/options"
import { keyInfo, maskSecrets } from "./lib/security"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Stripe module service: the resolved options, the key's kind and mode, and
 * masking. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The module keeps no tables: every read
 * (Stripe through `lib/client.ts`, Medusa through Query) lives in
 * `src/workflows/stripe` and is cached in memory there. A custom method
 * here that reached for the database would break on the Koda Plus demo with
 * a `fork` error of the entity manager, and the flows outside are reusable
 * from your own code anyway.
 *
 * A MISSING OR WRONG KEY NEVER BREAKS THE BOOT. The module always
 * registers. Without a key the admin page shows the setup; with a
 * publishable key it says why that cannot work; a key Stripe refuses shows
 * up on the page as a failed check, never as a crash.
 */
class KodaStripeModuleService {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedStripeOptions

  constructor(deps: InjectedDependencies, options?: StripePluginOptions) {
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    const key = keyInfo(this.options_.apiKey)
    if (this.options_.demo) {
      this.logger_.info("[stripe] Demo mode: sample Stripe data built from the store's orders, no requests to Stripe.")
      if (process.env.NODE_ENV === "production") {
        this.logger_.warn("[stripe] Demo mode is on in production: the admin shows sample payments, fees and disputes, not your Stripe account. Remove demo: true unless this is a demo store.")
      }
    } else if (!key.kind) {
      this.logger_.info("[stripe] Waiting for configuration: set the apiKey option (a restricted key with read permissions). The admin page shows the setup.")
    } else if (key.kind === "publishable") {
      this.logger_.warn("[stripe] The apiKey option holds a publishable key (pk_), which cannot read from Stripe. Use a restricted key (rk_).")
    } else if (key.kind === "secret") {
      this.logger_.warn(`[stripe] Reading Stripe with a secret ${key.mode ?? ""} key (sk_), which can move money. The plugin only sends GET requests, but a restricted key with Read or None per resource is safer if it leaks.`.replace(/\s+/g, " "))
    } else {
      /* Stripe shows no API that lists a key's permissions: the plugin only promises its own GET requests. */
      this.logger_.info(`[stripe] Reading Stripe with a ${key.kind} ${key.mode ?? ""} key. The plugin only sends GET requests; Stripe does not show it the key's permissions, so keep every resource at Read or None.`.replace(/\s+/g, " "))
    }
  }

  /** Resolved options WITH the key. Server side only, never send to the admin. */
  getOptions(): ResolvedStripeOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  /** The plugin can read: demo mode, or a key is set. */
  isConfigured(): boolean {
    return missingOptions(this.options_).length === 0
  }

  missingOptions(): string[] {
    return missingOptions(this.options_)
  }

  /** Kind, mode and last four characters of the key: what the admin may see. */
  keyInfo(): KeyInfoDto {
    return keyInfo(this.options_.apiKey)
  }

  /** Masks the key and every Stripe secret shape in a text for logs and the admin. */
  mask(text: unknown): string {
    return maskSecrets(text, [this.options_.apiKey])
  }
}

export default KodaStripeModuleService
