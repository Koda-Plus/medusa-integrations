/**
 * ONE E-MAIL, the way every flow of the plugin sends: the template's switch
 * first (a template that is off creates no notification at all), then
 * Medusa's notification module (`createNotifications` with the idempotency
 * key), which reaches the provider of the email channel.
 *
 * A template with secret fields (`sensitive`, the password reset link) does
 * not go through the notification module: Medusa keeps a notification's data
 * in its own table, and `GET /admin/notifications` returns it to every admin
 * user and every secret API key. Such a message goes straight to the
 * provider's delivery (`sendDirect`), with the options the provider of this
 * process was registered with; without that provider it is not sent at all.
 *
 * Never throws: a subscriber must not fail because an e-mail did not go
 * out. The provider records what happened in the send log; a message that
 * failed before it reached the provider gets a failed row here (`PRE_SEND`),
 * so the page shows it and a person can retry it.
 */

import { addressHash, customerIdOf } from "../../modules/emails/lib/keys"
import { resolveOptions } from "../../modules/emails/lib/options"
import { providerOptions } from "../../modules/emails/lib/provider-status"
import { resolveTemplate, sensitiveFields } from "../../modules/emails/lib/registry"
import { createResendClient, type ResendClient } from "../../modules/emails/lib/resend"
import { isEmail, maskEmail } from "../../modules/emails/lib/security"
import { deliver } from "../../modules/emails/lib/send"
import { cachedSettings, SettingsUnavailableError } from "../../modules/emails/lib/settings"
import { isMissingTable, type MessageKind, type MessageStore } from "../../modules/emails/lib/store"
import { emailsService, notificationModule, resolveOptional, storeFor, templateStateOf, type Scope } from "./runtime"

export interface SendTemplateInput {
  template: string
  to: string
  data: Record<string, unknown>
  /** The idempotency key of the event (`emails:<template>:<resource id>`). */
  key: string
  /** The event or job that sends it. */
  trigger: string
  kind?: MessageKind
  resource?: { type: string; id: string } | null
  orderId?: string | null
  receiverId?: string | null
  /** The Medusa customer the message is about (`cus_...`); `receiverId` when that is a customer id. */
  customerId?: string | null
  requestedBy?: string | null
  /** A person's retry: the provider takes the failed row over. */
  retry?: boolean
  /** The key Medusa gets; the event key when not given. */
  notificationKey?: string
  /** A test send goes out even when the template is off. */
  ignoreSwitch?: boolean
  /** At most this many messages of the template to one address in an hour (password resets). */
  limitPerHour?: number
}

export type SendOutcome =
  | { status: "queued"; notification: Record<string, unknown> | null }
  | { status: "disabled" | "no_provider" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string }

/** Container key of a Resend client to use instead of a new one (the tests register a fake one). */
export const CLIENT_KEY = "emailsResendClient"

/** A second delivery of the same event, refused by the unique key of Medusa's notification table: not an error. */
export function isDuplicateNotification(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  if (e?.code === "23505") return true
  const message = String(e?.message ?? "")
  return /idempotency_key/i.test(message) && /already exists|duplicate key/i.test(message)
}

function emailsMeta(input: SendTemplateInput, customerId: string | null): Record<string, unknown> {
  return {
    key: input.key,
    kind: input.kind ?? "event",
    orderId: input.orderId ?? null,
    customerId,
    requestedBy: input.requestedBy ?? null,
    retry: input.retry === true,
    ...(input.limitPerHour ? { limitPerHour: input.limitPerHour } : {}),
  }
}

/**
 * A failed row for a message that never reached the provider, under the
 * message's own key: the page shows it, the counters count it, and "Retry"
 * works when the template can be retried. Written with "on conflict do
 * nothing", so a row the provider wrote (or a send in flight) always wins.
 * Not for a person's retry (its row exists) or a test send.
 */
export async function recordPreSend(scope: Scope, input: SendTemplateInput, code: string, message: string): Promise<void> {
  if (input.retry || input.kind === "test") return
  const svc = emailsService(scope)
  const to = String(input.to ?? "").trim()
  const customerId = input.customerId ?? customerIdOf(input.receiverId)
  try {
    await storeFor(scope).record({
      key: input.key,
      template: input.template,
      locale: null,
      demo: svc.isDemo(),
      kind: input.kind ?? "event",
      status: "failed",
      recipient: isEmail(to) ? maskEmail(to) : null,
      subject: null,
      trigger: input.trigger,
      resource_type: input.resource?.type ?? null,
      resource_id: input.resource?.id ?? null,
      order_id: input.orderId ?? (input.resource?.type === "order" ? input.resource.id : null),
      notification_id: null,
      requested_by: input.requestedBy ?? null,
      customer_id: customerId,
      recipient_hash: isEmail(to) ? addressHash(to) : null,
      error_code: code,
      error: svc.mask(message).slice(0, 1000),
      retryable: true,
    })
  } catch (err) {
    if (!isMissingTable(err)) svc.getLogger().warn(`[emails] Could not write the failed ${input.template} to the send log: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export async function sendTemplate(scope: Scope, input: SendTemplateInput): Promise<SendOutcome> {
  const svc = emailsService(scope)
  const customerId = input.customerId ?? customerIdOf(input.receiverId)
  try {
    if (!input.ignoreSwitch) {
      const state = await templateStateOf(scope, input.template)
      if (!state || !state.enabled) return { status: "disabled" }
    }
    const template = resolveTemplate(input.template, svc.getOptions())
    if (template && sensitiveFields(template).length > 0) return await sendDirect(scope, { ...input, customerId })
    const notifications = notificationModule(scope)
    if (!notifications) {
      const why = "Medusa's notification module is not available; nothing was sent."
      svc.getLogger().warn(`[emails] ${why}`)
      await recordPreSend(scope, { ...input, customerId }, "NO_NOTIFICATION_MODULE", why)
      return { status: "no_provider" }
    }
    const created = (await notifications.createNotifications({
      to: input.to,
      channel: "email",
      template: input.template,
      data: input.data,
      trigger_type: input.trigger,
      resource_type: input.resource?.type ?? null,
      resource_id: input.resource?.id ?? null,
      receiver_id: input.receiverId ?? null,
      idempotency_key: input.notificationKey ?? input.key,
      provider_data: { emails: emailsMeta(input, customerId) },
    })) as Record<string, unknown> | null
    return { status: "queued", notification: created && typeof created === "object" ? created : null }
  } catch (err) {
    const message = svc.mask((err as Error)?.message ?? String(err)).slice(0, 1000)
    if (isDuplicateNotification(err)) {
      svc.getLogger().info(`[emails] ${input.template} (${input.trigger}): the same event is being sent already under ${input.key}.`)
      return { status: "skipped", reason: "duplicate" }
    }
    svc.getLogger().warn(`[emails] ${input.template} (${input.trigger}) was not sent: ${message}`)
    await recordPreSend(scope, { ...input, customerId }, err instanceof SettingsUnavailableError ? err.code : "PRE_SEND", message)
    return { status: "failed", error: message }
  }
}

/**
 * A message with a secret in its data, straight to the provider's delivery
 * (`deliver`, the same code the provider runs): the send log, the switch,
 * the limit per address, the idempotency key and the bounded retries all
 * apply, and Medusa's notification table never sees it.
 */
export async function sendDirect(scope: Scope, input: SendTemplateInput): Promise<SendOutcome> {
  const svc = emailsService(scope)
  const logger = svc.getLogger()
  const customerId = input.customerId ?? customerIdOf(input.receiverId)
  const raw = providerOptions()
  if (!raw) {
    const why = `The e-mail provider of this plugin is not registered in this process, so ${input.template} was not sent (it carries a secret link and never goes through Medusa's notification table).`
    logger.warn(`[emails] ${why}`)
    await recordPreSend(scope, { ...input, customerId }, "NO_PROVIDER", why)
    return { status: "no_provider" }
  }
  const o = resolveOptions(raw)
  let store: MessageStore | null = null
  try {
    store = storeFor(scope)
  } catch {
    store = null
  }
  const registered = resolveOptional<ResendClient>(scope, CLIENT_KEY)
  try {
    const result = await deliver(
      {
        options: o,
        store,
        loadSettings: () => cachedSettings(o.demo, () => (store ? store.settings() : Promise.resolve([])), Date.now(), logger),
        client: () => registered ?? createResendClient({ apiKey: o.apiKey, timeoutMs: o.timeoutMs, maxRetries: o.maxRetries, requestsPerSecond: o.requestsPerSecond }),
        logger,
      },
      {
        id: null,
        to: input.to,
        channel: "email",
        template: input.template,
        data: input.data,
        idempotency_key: input.key,
        trigger_type: input.trigger,
        resource_type: input.resource?.type ?? null,
        resource_id: input.resource?.id ?? null,
        receiver_id: input.receiverId ?? null,
        provider_data: { emails: emailsMeta(input, customerId) },
      },
    )
    if (result.outcome === "skipped") return { status: "skipped", reason: result.code ?? "skipped" }
    return { status: "queued", notification: { external_id: result.id ?? null, outcome: result.outcome } }
  } catch (err) {
    return { status: "failed", error: svc.mask((err as Error)?.message ?? String(err)).slice(0, 1000) }
  }
}
