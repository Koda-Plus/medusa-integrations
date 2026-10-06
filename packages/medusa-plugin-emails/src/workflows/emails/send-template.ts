/**
 * ONE E-MAIL THROUGH MEDUSA'S NOTIFICATION MODULE, the way every flow of the
 * plugin sends: the template's switch first (a template that is off creates
 * no notification at all), then `createNotifications` with the idempotency
 * key, which reaches the provider of the email channel.
 *
 * Never throws: a subscriber must not fail because an e-mail did not go
 * out. The provider records what happened in the send log.
 */

import type { MessageKind } from "../../modules/emails/lib/store"
import { emailsService, notificationModule, templateStateOf, type Scope } from "./runtime"

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
  requestedBy?: string | null
  /** A person's retry: the provider takes the failed row over. */
  retry?: boolean
  /** The key Medusa gets; the event key when not given. */
  notificationKey?: string
  /** A test send goes out even when the template is off. */
  ignoreSwitch?: boolean
}

export type SendOutcome = { status: "queued"; notification: Record<string, unknown> | null } | { status: "disabled" | "no_provider" } | { status: "failed"; error: string }

export async function sendTemplate(scope: Scope, input: SendTemplateInput): Promise<SendOutcome> {
  const svc = emailsService(scope)
  try {
    if (!input.ignoreSwitch) {
      const state = await templateStateOf(scope, input.template)
      if (!state || !state.enabled) return { status: "disabled" }
    }
    const notifications = notificationModule(scope)
    if (!notifications) {
      svc.getLogger().warn("[emails] Medusa's notification module is not available; nothing was sent.")
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
      provider_data: {
        emails: {
          key: input.key,
          kind: input.kind ?? "event",
          orderId: input.orderId ?? null,
          requestedBy: input.requestedBy ?? null,
          retry: input.retry === true,
        },
      },
    })) as Record<string, unknown> | null
    return { status: "queued", notification: created && typeof created === "object" ? created : null }
  } catch (err) {
    const message = svc.mask((err as Error)?.message ?? String(err)).slice(0, 1000)
    svc.getLogger().warn(`[emails] ${input.template} (${input.trigger}) was not sent: ${message}`)
    return { status: "failed", error: message }
  }
}
