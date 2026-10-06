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
import { eventKey, resetKey, retryNotificationKey, sha256 } from "../../modules/emails/lib/keys"
import { isEmail } from "../../modules/emails/lib/security"
import type { MessageRow } from "../../modules/emails/lib/store"
import { sendTemplate, type SendOutcome } from "./send-template"
import { sendAbandonedCart } from "./abandoned-carts"
import { adminResetLink, emailsService, graphOne, templateStateOf, type Scope } from "./runtime"

export const ORDER_FIELDS: readonly string[] = [
  "id",
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
  return { status: outcome.status }
}

function skipped(scope: Scope, template: string, id: string, reason: string): HandlerOutcome {
  const logger = emailsService(scope).getLogger() as { debug?: (m: string) => void; info: (m: string) => void }
  ;(logger.debug ?? logger.info).call(logger, `[emails] ${template} for ${id}: not sent (${reason}).`)
  return { status: "skipped", reason }
}

function failed(scope: Scope, template: string, id: string, err: unknown): HandlerOutcome {
  const svc = emailsService(scope)
  const reason = svc.mask((err as Error)?.message ?? String(err)).slice(0, 500)
  svc.getLogger().warn(`[emails] ${template} for ${id}: ${reason}`)
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
    return failed(scope, template, orderId, err)
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
  try {
    if (noNotification && !opts.retry) return skipped(scope, template, fulfillmentId, "no_notification")
    if (!(await enabled(scope, template))) return { status: "disabled" }
    const o = emailsService(scope).getOptions()
    const f = await graphOne<FulfillmentRecord & { order?: { id?: string | null } | null }>(scope, "fulfillment", FULFILLMENT_FIELDS, [], { id: fulfillmentId })
    const orderId = f?.order?.id
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
    return failed(scope, template, fulfillmentId, err)
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
        ...retryFields(key, opts),
      }),
    )
  } catch (err) {
    return failed(scope, template, customerId, err)
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
 * never part of a key; it reaches only the link in the message.
 */
export async function onPasswordReset(scope: Scope, e: PasswordResetEvent): Promise<HandlerOutcome> {
  const template = TEMPLATES.passwordReset
  const email = String(e.entity_id ?? "").trim()
  const actor = String(e.actor_type ?? "")
  try {
    if (!(await enabled(scope, template))) return { status: "disabled" }
    if (!isEmail(email) || !e.token) return skipped(scope, template, actor || "?", "no address or no token in the event")
    const svc = emailsService(scope)
    const o = svc.getOptions()
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
        key: resetKey(String(e.token)),
        trigger: "auth.password_reset",
        resource: person?.id ? { type: actor === "user" ? "user" : "customer", id: person.id } : null,
        receiverId: actor === "customer" ? person?.id ?? null : null,
      }),
    )
  } catch (err) {
    return failed(scope, template, actor || "?", err)
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
