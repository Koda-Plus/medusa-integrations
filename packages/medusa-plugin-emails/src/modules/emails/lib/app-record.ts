/**
 * APP MODE: the store keeps its own notification provider on the email
 * channel (`appProvider` in the options), and that provider reports every
 * message here, so the plugin's page lists them, counts them and shows them
 * on the order:
 *
 *   import { recordAppEmail } from "@koda-plus/medusa-plugin-emails/app"
 *
 *   class MyProvider extends AbstractNotificationProviderService {
 *     constructor(cradle, options) { super(); this.pg = cradle[ContainerRegistrationKeys.PG_CONNECTION] }
 *     async send(notification) {
 *       try {
 *         const { id } = await sendItSomehow(notification)
 *         await recordAppEmail(this.pg, { notification, status: "sent", subject, externalId: id })
 *         return { id }
 *       } catch (err) {
 *         await recordAppEmail(this.pg, { notification, status: "failed", subject, error: err.message })
 *         throw err
 *       }
 *     }
 *   }
 *
 * It never throws and never slows a send down for long: a missing table (the
 * migrations did not run yet) or any database error is swallowed, the
 * provider's own result stands. What is stored follows the plugin's rules:
 * the address masked, a one-way hash next to it, the error masked, no body.
 *
 * The key is the plugin's own key when the message came from the plugin (a
 * test from the admin), else the notification's idempotency key, else one
 * per Medusa notification. When Medusa retries a failed notification the
 * provider reports the same key again and the row gets the new outcome.
 */

import { generateEntityId } from "@medusajs/framework/utils"
import { addressHash, cleanKey, customerIdOf, notificationKey } from "./keys"
import { normalizeLocale } from "./locale"
import { isEmail, maskAll, maskEmail } from "./security"
import type { EmailsMeta, IncomingNotification } from "./send"
import { createSqlStore, type MessageKind, type MessagePatch, type MessageStatus, type NewMessage, type SqlRunner } from "./store"

export interface AppEmailReport {
  /** The notification Medusa handed to the provider (the whole row, or at least `to` and `template`). */
  notification: IncomingNotification
  /** sent: the e-mail service took it; failed: it did not; skipped: the provider chose not to send it. */
  status: "sent" | "failed" | "skipped"
  /** The subject the provider rendered. */
  subject?: string | null
  /** The e-mail service's message id. */
  externalId?: string | null
  /** Why it failed or was skipped, in plain words (masked before it is stored). */
  error?: string | null
  /** A short code for the error, for the filters ("PROVIDER_ERROR" when not given). */
  errorCode?: string | null
  /** The order the message is about, when the provider knows it better than the notification does. */
  orderId?: string | null
  /** The Medusa customer (`cus_...`) the message is about. */
  customerId?: string | null
  /** Secrets that must never reach the log (an API key), masked wherever they appear. */
  secrets?: ReadonlyArray<string | null | undefined>
}

const MAX_SUBJECT = 300
const MAX_ERROR = 1000

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** The order id in an app's notification data: order_id, orderId or order.id. */
function orderIdInData(data: Record<string, unknown> | null | undefined): string | null {
  if (!data || typeof data !== "object") return null
  const direct = strOrNull(data.order_id) ?? strOrNull(data.orderId)
  if (direct && direct.startsWith("order_")) return direct
  const order = data.order as { id?: unknown } | null | undefined
  const nested = order && typeof order === "object" ? strOrNull(order.id) : null
  return nested && nested.startsWith("order_") ? nested : null
}

/** The row for one reported message. Pure, for the tests. */
export function appEmailRow(report: AppEmailReport, now: Date = new Date()): NewMessage & MessagePatch & { status: MessageStatus } {
  const n = report.notification ?? ({ to: "" } as IncomingNotification)
  const meta = ((n.provider_data as { emails?: EmailsMeta } | null | undefined)?.emails ?? {}) as EmailsMeta
  const addresses = String(n.to ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
  const valid = addresses.filter((a) => isEmail(a))
  const kind: MessageKind = meta.kind === "test" ? "test" : "app"
  const key = cleanKey(meta.key) ?? cleanKey(n.idempotency_key) ?? notificationKey(n.id ?? null)
  const data = (n.data ?? {}) as Record<string, unknown>
  const resourceOrder = n.resource_type === "order" ? strOrNull(n.resource_id) : null
  const failed = report.status === "failed"
  const skipped = report.status === "skipped"
  const errorText = failed || skipped ? maskAll(report.error ?? (failed ? "The provider did not send it." : "The provider skipped it."), report.secrets ?? []).slice(0, MAX_ERROR) : null
  const external = strOrNull(report.externalId)
  return {
    key,
    template: strOrNull(n.template) ?? "unknown",
    locale: normalizeLocale(data.locale),
    demo: false,
    kind,
    status: report.status,
    recipient: valid.length > 0 ? valid.map((a) => maskEmail(a)).join(", ") : addresses.length > 0 ? "***" : null,
    recipient_hash: valid.length > 0 ? addressHash(valid[0]) : null,
    subject: strOrNull(report.subject)?.slice(0, MAX_SUBJECT) ?? null,
    trigger: strOrNull(n.trigger_type) ?? (kind === "test" ? "test" : null),
    resource_type: strOrNull(n.resource_type),
    resource_id: strOrNull(n.resource_id),
    order_id: strOrNull(report.orderId) ?? strOrNull(meta.orderId) ?? resourceOrder ?? orderIdInData(data),
    notification_id: strOrNull(n.id),
    requested_by: strOrNull(meta.requestedBy),
    customer_id: customerIdOf(report.customerId) ?? customerIdOf(meta.customerId) ?? customerIdOf(n.receiver_id),
    external_id: external && external !== "skipped" && external !== "unknown" ? external : null,
    error_code: failed ? strOrNull(report.errorCode) ?? "PROVIDER_ERROR" : skipped ? strOrNull(report.errorCode) ?? "SKIPPED" : null,
    error: errorText,
    retryable: false,
    sent_at: report.status === "sent" ? now : null,
  }
}

/**
 * Records one message the store's own provider handled. True when a row was
 * written or updated, false when it could not be (no database handle, no
 * table yet, any error): the e-mail itself is never affected.
 */
export async function recordAppEmail(pg: SqlRunner | null | undefined, report: AppEmailReport, deps: { newId?: (prefix: string) => string; now?: Date } = {}): Promise<boolean> {
  if (!pg || typeof pg.raw !== "function") return false
  try {
    const store = createSqlStore({ sql: pg, newId: deps.newId ?? ((prefix) => generateEntityId(undefined, prefix)) })
    const row = await store.recordApp(appEmailRow(report, deps.now ?? new Date()))
    return Boolean(row)
  } catch {
    /* No table yet (before db:migrate) or any database error: the log is a courtesy, the provider's result stands. */
    return false
  }
}
