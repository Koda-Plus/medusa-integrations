/**
 * THE E-MAIL OF EACH MEDUSA EVENT: read what the template needs with Query,
 * apply the skip rules, build the data, send it under the event's key.
 *
 *   order.placed            order.placed        key emails:order.placed:<order id>
 *   shipment.created        order.shipped       key emails:order.shipped:<fulfillment id>
 *   order.canceled          order.canceled      key emails:order.canceled:<order id>
 *   customer.created        customer.welcome    key emails:customer.welcome:<customer id>
 *   auth.password_reset     password.reset      key emails:password.reset:<hash of the token>
 *   negotiation.countered   negotiation.countered  key per offer (id, status, price, quantity)
 *   negotiation.accepted    negotiation.accepted   key per negotiation
 *   negotiation.rejected    negotiation.rejected   key per negotiation
 *
 * The same functions serve a person's retry from the admin (`retry: true`):
 * the data is read again, the key stays, the provider takes the failed row
 * over. Nothing here throws; every outcome is returned and logged.
 */

import { TEMPLATES } from "../../modules/emails/lib/constants"
import {
  canceledData,
  negotiationData,
  orderData,
  orderSkipReason,
  resetData,
  shipmentData,
  welcomeData,
  welcomeSkipReason,
  type CustomerRecord,
  type FulfillmentRecord,
  type NegotiationEvent,
  type OrderRecord,
} from "../../modules/emails/lib/data"
import { addressHash, eventKey, resetKey, retryNotificationKey, sha256 } from "../../modules/emails/lib/keys"
import { isEmail, maskEmail } from "../../modules/emails/lib/security"
import { SettingsUnavailableError } from "../../modules/emails/lib/settings"
import { isMissingTable, type MessageRow } from "../../modules/emails/lib/store"
import { recordPreSend, sendTemplate, type SendOutcome, type SendTemplateInput } from "./send-template"
import { sendAbandonedCart } from "./abandoned-carts"
import { adminResetLink, emailsService, graphOne, storeFor, templateStateOf, type Scope } from "./runtime"

export const ORDER_FIELDS: readonly string[] = [
  "id",
  /* Medusa 2.12 computes no totals without it ("Item version is required to load adjustments"). */
  "version",
  "display_id",
  "email",
  "currency_code",
  "created_at",
  "canceled_at",
  "metadata",
  "customer_id",
  "no_notification",
  "total",
  "item_total",
  "shipping_total",
  "discount_total",
  "tax_total",
  "items.*",
  "shipping_address.*",
  "shipping_methods.name",
  "customer.first_name",
  "customer.last_name",
  "customer.company_name",
  "customer.metadata",
]

/** Columns of newer Medusa versions, asked for when the store has them. */
export const ORDER_OPTIONAL_FIELDS: readonly string[] = ["locale", "custom_display_id"]

export const FULFILLMENT_FIELDS: readonly string[] = [
  "id",
  "shipped_at",
  "canceled_at",
  "created_at",
  "provider_id",
  "labels.tracking_number",
  "labels.tracking_url",
  "labels.label_url",
  "items.title",
  "items.sku",
  "items.quantity",
  "items.line_item_id",
  "order.id",
]

export const CUSTOMER_FIELDS: readonly string[] = ["id", "email", "first_name", "last_name", "company_name", "has_account", "created_at", "metadata"]

export interface HandlerOptions {
  /** A person's retry from the admin. */
  retry?: boolean
  requestedBy?: string | null
  /** The rotation the retry will get, for a fresh Medusa key. */
  rotation?: number
}

export type HandlerOutcome = { status: "sent" | "disabled" | "no_provider" } | { status: "skipped"; reason: string } | { status: "failed"; reason: string }

function fromSend(outcome: SendOutcome): HandlerOutcome {
  if (outcome.status === "queued") return { status: "sent" }
  if (outcome.status === "failed") return { status: "failed", reason: outcome.error }
  if (outcome.status === "skipped") return { status: "skipped", reason: outcome.reason }
  return { status: outcome.status }
}

function skipped(scope: Scope, template: string, id: string, reason: string): HandlerOutcome {
  const logger = emailsService(scope).getLogger() as { debug?: (m: string) => void; info: (m: string) => void }
  ;(logger.debug ?? logger.info).call(logger, `[emails] ${template} for ${id}: not sent (${reason}).`)
  return { status: "skipped", reason }
}

/**
 * An e-mail that failed before it reached the provider (Query could not read
 * the order, the settings could not be read): logged, and written to the send
 * log as failed under the event's key (`row`), so the page shows it and a
 * person can retry it. A person's own retry writes nothing: its row exists.
 */
async function failed(scope: Scope, template: string, id: string, err: unknown, row?: Omit<SendTemplateInput, "template" | "data" | "kind">): Promise<HandlerOutcome> {
  const svc = emailsService(scope)
  const reason = svc.mask((err as Error)?.message ?? String(err)).slice(0, 500)
  svc.getLogger().warn(`[emails] ${template} for ${id}: ${reason}`)
  if (row) await recordPreSend(scope, { ...row, template, data: {} }, err instanceof SettingsUnavailableError ? err.code : "PRE_SEND", reason)
  return { status: "failed", reason }
}

async function enabled(scope: Scope, template: string): Promise<boolean> {
  return Boolean((await templateStateOf(scope, template))?.enabled)
}

export async function loadOrder(scope: Scope, id: string, extra: readonly string[] = []): Promise<OrderRecord | null> {
  return graphOne<OrderRecord>(scope, "order", [...ORDER_FIELDS, ...extra], ORDER_OPTIONAL_FIELDS, { id })
}

function retryFields(key: string, opts: HandlerOptions): { retry?: boolean; requestedBy?: string | null; notificationKey?: string } {
  if (!opts.retry) return {}
  return { retry: true, requestedBy: opts.requestedBy ?? null, notificationKey: retryNotificationKey(key, opts.rotation ?? 1) }
}

/* ------------------------------------------------------------------ */

async function orderEmail(scope: Scope, template: typeof TEMPLATES.orderPlaced | typeof TEMPLATES.orderCanceled, orderId: string, opts: HandlerOptions): Promise<HandlerOutcome> {
  try {
    if (!(await enabled(scope, template))) return { status: "disabled" }
    const o = emailsService(scope).getOptions()
    const order = await loadOrder(scope, orderId)
    if (!order) return skipped(scope, template, orderId, "order not found")
    const reason = orderSkipReason(order, o)
    if (reason) return skipped(scope, template, orderId, reason)
    const data = template === TEMPLATES.orderPlaced ? orderData(order, o) : canceledData(order, o)
    const key = eventKey(template, order.id)
    return fromSend(
      await sendTemplate(scope, {
        template,
        to: String(order.email).trim(),
        data: data as unknown as Record<string, unknown>,
        key,
        trigger: template === TEMPLATES.orderPlaced ? "order.placed" : "order.canceled",
        resource: { type: "order", id: order.id },
        orderId: order.id,
        receiverId: order.customer_id ?? null,
        ...retryFields(key, opts),
      }),
    )
  } catch (err) {
    return failed(
      scope,
      template,
      orderId,
      err,
      opts.retry ? undefined : { to: "", key: eventKey(template, orderId), trigger: template === TEMPLATES.orderPlaced ? "order.placed" : "order.canceled", resource: { type: "order", id: orderId }, orderId },
    )
  }
}

export function onOrderPlaced(scope: Scope, orderId: string, opts: HandlerOptions = {}): Promise<HandlerOutcome> {
  return orderEmail(scope, TEMPLATES.orderPlaced, orderId, opts)
}

export function onOrderCanceled(scope: Scope, orderId: string, opts: HandlerOptions = {}): Promise<HandlerOutcome> {
  return orderEmail(scope, TEMPLATES.orderCanceled, orderId, opts)
}

/** `shipment.created` carries the fulfillment id and the `no_notification` flag of the shipment. */
export async function onShipmentCreated(scope: Scope, fulfillmentId: string, noNotification: boolean, opts: HandlerOptions = {}): Promise<HandlerOutcome> {
  const template = TEMPLATES.orderShipped
  let orderId: string | null = null
  try {
    if (noNotification && !opts.retry) return skipped(scope, template, fulfillmentId, "no_notification")
    if (!(await enabled(scope, template))) return { status: "disabled" }
    const o = emailsService(scope).getOptions()
    const f = await graphOne<FulfillmentRecord & { order?: { id?: string | null } | null }>(scope, "fulfillment", FULFILLMENT_FIELDS, [], { id: fulfillmentId })
    orderId = f?.order?.id ?? null
    if (!f || !orderId) return skipped(scope, template, fulfillmentId, "fulfillment or its order not found")
    const order = await loadOrder(scope, orderId, ["fulfillments.id", "fulfillments.shipped_at", "fulfillments.canceled_at", "fulfillments.items.quantity", "fulfillments.items.line_item_id"])
    if (!order) return skipped(scope, template, fulfillmentId, "order not found")
    const reason = orderSkipReason(order, o)
    if (reason) return skipped(scope, template, fulfillmentId, reason)
    const key = eventKey(template, f.id)
    return fromSend(
      await sendTemplate(scope, {
        template,
        to: String(order.email).trim(),
        data: shipmentData(order, f, o) as unknown as Record<string, unknown>,
        key,
        trigger: "shipment.created",
        resource: { type: "fulfillment", id: f.id },
        orderId: order.id,
        receiverId: order.customer_id ?? null,
        ...retryFields(key, opts),
      }),
    )
  } catch (err) {
    return failed(
      scope,
      template,
      fulfillmentId,
      err,
      opts.retry ? undefined : { to: "", key: eventKey(template, fulfillmentId), trigger: "shipment.created", resource: { type: "fulfillment", id: fulfillmentId }, orderId },
    )
  }
}

export async function onCustomerCreated(scope: Scope, customerId: string, opts: HandlerOptions = {}): Promise<HandlerOutcome> {
  const template = TEMPLATES.customerWelcome
  try {
    if (!(await enabled(scope, template))) return { status: "disabled" }
    const o = emailsService(scope).getOptions()
    const customer = await graphOne<CustomerRecord>(scope, "customer", CUSTOMER_FIELDS, [], { id: customerId })
    const reason = welcomeSkipReason(customer)
    if (reason || !customer) return skipped(scope, template, customerId, reason ?? "not_found")
    const key = eventKey(template, customerId)
    return fromSend(
      await sendTemplate(scope, {
        template,
        to: String(customer.email).trim(),
        data: welcomeData(customer, o) as unknown as Record<string, unknown>,
        key,
        trigger: "customer.created",
        resource: { type: "customer", id: customerId },
        receiverId: customerId,
        customerId,
        ...retryFields(key, opts),
      }),
    )
  } catch (err) {
    return failed(
      scope,
      template,
      customerId,
      err,
      opts.retry ? undefined : { to: "", key: eventKey(template, customerId), trigger: "customer.created", resource: { type: "customer", id: customerId }, customerId },
    )
  }
}

export interface PasswordResetEvent {
  entity_id?: string | null
  actor_type?: string | null
  token?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * `auth.password_reset`: `entity_id` is the address (the emailpass
 * provider), `actor_type` customer or user. The token is never logged and
 * never part of a key; it reaches only the link in the message, which never
 * passes through Medusa's notification table (the template is `sensitive`,
 * see `sendTemplate`).
 *
 * Asking for a reset needs no account, so a stranger can ask for anyone's
 * address: at most `passwordResetsPerHour` (3) e-mails go to one address in
 * an hour, the rest are logged as skipped (`THROTTLED`). Demo mode handles
 * no reset of an admin user: the outbox of a public demo is open to every
 * visitor.
 */
export async function onPasswordReset(scope: Scope, e: PasswordResetEvent): Promise<HandlerOutcome> {
  const template = TEMPLATES.passwordReset
  const email = String(e.entity_id ?? "").trim()
  const actor = String(e.actor_type ?? "")
  const key = e.token ? resetKey(String(e.token)) : null
  try {
    if (!(await enabled(scope, template))) return { status: "disabled" }
    if (!isEmail(email) || !e.token || !key) return skipped(scope, template, actor || "?", "no address or no token in the event")
    const svc = emailsService(scope)
    const o = svc.getOptions()
    if (svc.isDemo() && actor === "user") {
      await recordSkip(scope, { key, template, to: email, trigger: "auth.password_reset", code: "DEMO_ADMIN_RESET", message: "Demo mode does not handle the password reset of an admin user." })
      return skipped(scope, template, actor, "demo mode does not reset admin users")
    }
    let person: CustomerRecord | null = null
    try {
      if (actor === "customer") person = await graphOne<CustomerRecord>(scope, "customer", ["id", "first_name", "metadata"], [], { email, has_account: true })
      else if (actor === "user") person = await graphOne<CustomerRecord>(scope, "user", ["id", "first_name", "metadata"], [], { email })
    } catch {
      person = null
    }
    const data = resetData({ email, actorType: actor, token: String(e.token), metadata: e.metadata ?? null, person }, o, adminResetLink(scope, o.links))
    if (!data) {
      svc.getLogger().warn(
        actor === "user"
          ? "[emails] An admin user asked for a password reset, but the admin address is unknown: set adminUrl (or admin.backendUrl in medusa-config.ts)."
          : actor === "customer"
            ? "[emails] A customer asked for a password reset, but the reset link cannot be built: set storefrontUrl or links.passwordReset."
            : `[emails] A password reset for actor "${actor.slice(0, 30)}" has no page to link to; not sent.`,
      )
      return { status: "skipped", reason: "no reset link" }
    }
    return fromSend(
      await sendTemplate(scope, {
        template,
        to: email,
        data: data as unknown as Record<string, unknown>,
        key,
        trigger: "auth.password_reset",
        resource: person?.id ? { type: actor === "user" ? "user" : "customer", id: person.id } : null,
        receiverId: actor === "customer" ? person?.id ?? null : null,
        customerId: actor === "customer" ? person?.id ?? null : null,
        limitPerHour: o.passwordResetsPerHour,
      }),
    )
  } catch (err) {
    return failed(scope, template, actor || "?", err, key && isEmail(email) ? { to: email, key, trigger: "auth.password_reset", resource: null } : undefined)
  }
}

/** A skipped row written by a flow itself (nothing reached the provider): what the page shows for it. */
async function recordSkip(scope: Scope, row: { key: string; template: string; to: string; trigger: string; code: string; message: string }): Promise<void> {
  const svc = emailsService(scope)
  try {
    await storeFor(scope).record({
      key: row.key,
      template: row.template,
      locale: null,
      demo: svc.isDemo(),
      kind: "event",
      status: "skipped",
      recipient: maskEmail(row.to),
      subject: null,
      trigger: row.trigger,
      resource_type: null,
      resource_id: null,
      order_id: null,
      notification_id: null,
      requested_by: null,
      customer_id: null,
      recipient_hash: addressHash(row.to),
      error_code: row.code,
      error: row.message,
      retryable: false,
    })
  } catch (err) {
    if (!isMissingTable(err)) svc.getLogger().warn(`[emails] Could not write the skipped ${row.template} to the send log: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

const NEGOTIATION_TEMPLATES: Record<string, string> = {
  "negotiation.countered": TEMPLATES.negotiationCountered,
  "negotiation.accepted": TEMPLATES.negotiationAccepted,
  "negotiation.rejected": TEMPLATES.negotiationRejected,
}

/**
 * The events of `@koda-plus/medusa-plugin-negotiations`, by name only. A
 * negotiation flagged `demo` never e-mails anyone outside demo mode. Every
 * counter offer is its own message; acceptance and rejection once per
 * negotiation.
 */
export async function onNegotiation(scope: Scope, eventName: string, e: NegotiationEvent): Promise<HandlerOutcome> {
  const template = NEGOTIATION_TEMPLATES[eventName]
  const id = String(e?.id ?? "")
  if (!template || !id) return { status: "skipped", reason: "unknown event" }
  try {
    if (!(await enabled(scope, template))) return { status: "disabled" }
    const svc = emailsService(scope)
    const o = svc.getOptions()
    if (e.demo === true && !svc.isDemo()) return skipped(scope, template, id, "a demo negotiation in live mode")
    /* The customer who declined an offer knows it already: no "closed" e-mail for their own click. */
    if (template === TEMPLATES.negotiationRejected && e.actor === "customer") return skipped(scope, template, id, "declined by the customer")
    if (!e.customer_id) return skipped(scope, template, id, "no customer")
    const customer = await graphOne<CustomerRecord>(scope, "customer", CUSTOMER_FIELDS, [], { id: e.customer_id })
    if (!customer || !isEmail(String(customer.email ?? "").trim())) return skipped(scope, template, id, "customer without an address")
    let productTitle: string | null = null
    let variantTitle: string | null = null
    let sku: string | null = null
    try {
      if (e.variant_id) {
        const v = await graphOne<{ title?: string | null; sku?: string | null; product?: { title?: string | null } | null }>(scope, "product_variant", ["id", "title", "sku", "product.title"], [], {
          id: e.variant_id,
        })
        productTitle = v?.product?.title ?? null
        variantTitle = v?.title ?? null
        sku = v?.sku ?? null
      } else if (e.product_id) {
        const p = await graphOne<{ title?: string | null }>(scope, "product", ["id", "title"], [], { id: e.product_id })
        productTitle = p?.title ?? null
      }
    } catch {
      /* the product line is a courtesy */
    }
    const data = negotiationData(e, { customer, productTitle, variantTitle, sku }, o)
    /* Every counter offer is its own message: the key carries the offer, so a new price or quantity mails again. */
    const offer = template === TEMPLATES.negotiationCountered ? `:${sha256(`${e.status ?? ""}|${String(e.price_amount ?? e.price ?? "")}|${String(e.qty ?? "")}`).slice(0, 12)}` : ""
    return fromSend(
      await sendTemplate(scope, {
        template,
        to: String(customer.email).trim(),
        data: data as unknown as Record<string, unknown>,
        key: eventKey(template, `${id}${offer}`),
        trigger: eventName,
        resource: { type: "negotiation", id },
        receiverId: e.customer_id,
      }),
    )
  } catch (err) {
    return failed(scope, template, id, err)
  }
}

/** A person's retry of a failed message of a built-in event template. */
export async function retryMessage(scope: Scope, row: MessageRow, requestedBy: string | null): Promise<HandlerOutcome> {
  const opts: HandlerOptions = { retry: true, requestedBy, rotation: Number(row.rotation ?? 0) + 1 }
  const id = String(row.resource_id ?? "")
  switch (row.template) {
    case TEMPLATES.orderPlaced:
      return onOrderPlaced(scope, id, opts)
    case TEMPLATES.orderCanceled:
      return onOrderCanceled(scope, id, opts)
    case TEMPLATES.orderShipped:
      return onShipmentCreated(scope, id, false, opts)
    case TEMPLATES.customerWelcome:
      return onCustomerCreated(scope, id, opts)
    case TEMPLATES.cartAbandoned:
      return sendAbandonedCart(scope, id, opts)
    default:
      return { status: "skipped", reason: "this template cannot be retried from the admin" }
  }
}
