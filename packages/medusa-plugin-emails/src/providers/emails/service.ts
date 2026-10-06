import { AbstractNotificationProviderService, ContainerRegistrationKeys, MedusaError, generateEntityId } from "@medusajs/framework/utils"
import type { Logger, ProviderSendNotificationDTO, ProviderSendNotificationResultsDTO } from "@medusajs/framework/types"
import { PROVIDER_IDENTIFIER } from "../../modules/emails/lib/constants"
import { resolveOptions, type EmailsPluginOptions, type ResolvedEmailsOptions } from "../../modules/emails/lib/options"
import { noteProvider } from "../../modules/emails/lib/provider-status"
import { createResendClient, type ResendClient } from "../../modules/emails/lib/resend"
import { maskAll } from "../../modules/emails/lib/security"
import { deliver, DeliveryError, type IncomingNotification, type LoggerLike } from "../../modules/emails/lib/send"
import { cachedSettings } from "../../modules/emails/lib/settings"
import { createSqlStore, type MessageStore, type SqlRunner } from "../../modules/emails/lib/store"

type Cradle = Record<string, unknown>

/** A dependency of the notification module's container, or null (Awilix throws for unknown keys). */
function optional<T>(cradle: Cradle, key: string): T | null {
  try {
    return (cradle[key] as T | undefined) ?? null
  } catch {
    return null
  }
}

/**
 * THE NOTIFICATION PROVIDER: renders a template and sends it through Resend.
 * Register it in medusa-config.ts under Medusa's notification module, with
 * the same options as the plugin and the email channel:
 *
 *   { resolve: "@koda-plus/medusa-plugin-emails/providers/emails", id: "emails",
 *     options: { channels: ["email"], ...emails } }
 *
 * It never breaks the boot: without an API key it logs messages instead of
 * sending them, in demo mode it fills the simulated outbox. Every send goes
 * through `deliver` (lib/send.ts): the send log claim, the idempotency key,
 * the bounded retries, masking.
 */
class EmailsNotificationProvider extends AbstractNotificationProviderService {
  static identifier = PROVIDER_IDENTIFIER

  /** Called by Medusa at boot. Never throws: it only leaves a note for the admin page. */
  static validateOptions(options: Record<string, unknown>): void {
    try {
      noteProvider(options as EmailsPluginOptions)
    } catch {
      /* the note is a courtesy */
    }
  }

  protected readonly options_: ResolvedEmailsOptions
  protected readonly logger_: LoggerLike
  protected readonly store_: MessageStore | null
  protected client_: ResendClient | null = null

  constructor(cradle: Cradle, options: EmailsPluginOptions) {
    super()
    this.options_ = resolveOptions(options)
    this.logger_ = optional<Logger>(cradle, "logger") ?? console
    const pg = optional<SqlRunner>(cradle, ContainerRegistrationKeys.PG_CONNECTION)
    this.store_ = pg ? createSqlStore({ sql: pg, newId: (prefix) => generateEntityId(undefined, prefix) }) : null
    noteProvider(options)
    if (!this.options_.channels.includes("email")) {
      this.logger_.warn('[emails] The provider options have no "email" channel: add channels: ["email"], or Medusa never routes e-mails to it.')
    }
  }

  private client(): ResendClient {
    if (!this.client_) {
      const o = this.options_
      this.client_ = createResendClient({ apiKey: o.apiKey, timeoutMs: o.timeoutMs, maxRetries: o.maxRetries, requestsPerSecond: o.requestsPerSecond })
    }
    return this.client_
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const store = this.store_
    try {
      const result = await deliver(
        {
          options: this.options_,
          store,
          loadSettings: () => cachedSettings(this.options_.demo, () => (store ? store.settings() : Promise.resolve([]))),
          client: () => this.client(),
          logger: this.logger_,
        },
        notification as unknown as IncomingNotification,
      )
      return result.id ? { id: result.id } : {}
    } catch (err) {
      const message = err instanceof DeliveryError ? err.message : maskAll((err as Error)?.message ?? String(err), [this.options_.apiKey])
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `[emails] ${message}`)
    }
  }
}

export default EmailsNotificationProvider
