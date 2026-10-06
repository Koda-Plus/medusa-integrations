/**
 * DATA FOR PREVIEWS AND TEST SENDS: the template's sample, or the store's
 * own newest order (or shipped parcel, cart, registered customer) with the
 * person replaced by the sample one. The products, amounts, numbers and
 * dates are real; no name, company or address of a customer ever reaches a
 * preview or a test e-mail.
 */

import { TEMPLATES, type EmailLocale } from "../../modules/emails/lib/constants"
import { anonymize, cartData, canceledData, orderData, shipmentData, welcomeData, type CartRecord, type CustomerRecord, type FulfillmentRecord, type OrderRecord } from "../../modules/emails/lib/data"
import { applyBrandOverrides } from "../../modules/emails/lib/settings"
import { renderTemplate, type PreviewTheme, type RenderedEmail } from "../../modules/emails/lib/render"
import { sampleData, type ResolvedTemplate } from "../../modules/emails/lib/registry"
import type { PreviewSource } from "../../modules/emails/lib/contract"
import { CART_FIELDS, CART_OPTIONAL_FIELDS } from "./abandoned-carts"
import { CUSTOMER_FIELDS, FULFILLMENT_FIELDS, ORDER_FIELDS, ORDER_OPTIONAL_FIELDS } from "./events"
import { emailsService, graphList, settingsFor, type Scope } from "./runtime"

/** Templates whose preview can use the store's newest data. */
export const LATEST_TEMPLATES: readonly string[] = [TEMPLATES.orderPlaced, TEMPLATES.orderCanceled, TEMPLATES.orderShipped, TEMPLATES.cartAbandoned, TEMPLATES.customerWelcome]

export interface PreviewData {
  data: Record<string, unknown>
  source: PreviewSource
  sourceRef: string | null
}

async function latestOrder(scope: Scope, extra: readonly string[] = []): Promise<OrderRecord | null> {
  const rows = await graphList<OrderRecord>(scope, "order", [...ORDER_FIELDS, ...extra], ORDER_OPTIONAL_FIELDS, {}, { take: 1, order: { created_at: "DESC" } })
  return rows[0] ?? null
}

function ref(order: OrderRecord): string {
  const nr = order.custom_display_id || (order.display_id !== null && order.display_id !== undefined ? `#${order.display_id}` : order.id)
  return String(nr)
}

async function fromStore(scope: Scope, key: string, locale: EmailLocale): Promise<PreviewData | null> {
  const o = emailsService(scope).getOptions()
  const lo = { ...o, defaultLocale: locale }
  if (key === TEMPLATES.orderPlaced || key === TEMPLATES.orderCanceled) {
    const order = await latestOrder(scope)
    if (!order) return null
    const data = key === TEMPLATES.orderPlaced ? orderData(order, lo) : canceledData(order, lo)
    return { data: { ...anonymize(data, locale), locale }, source: "latest", sourceRef: ref(order) }
  }
  if (key === TEMPLATES.orderShipped) {
    const fs = await graphList<FulfillmentRecord & { order?: { id?: string | null } | null }>(scope, "fulfillment", FULFILLMENT_FIELDS, [], { shipped_at: { $ne: null } }, { take: 1, order: { created_at: "DESC" } })
    const f = fs[0]
    if (!f?.order?.id) return null
    const orders = await graphList<OrderRecord>(scope, "order", [...ORDER_FIELDS, "fulfillments.id", "fulfillments.shipped_at", "fulfillments.canceled_at", "fulfillments.items.quantity"], ORDER_OPTIONAL_FIELDS, { id: f.order.id }, { take: 1 })
    const order = orders[0]
    if (!order) return null
    return { data: { ...anonymize(shipmentData(order, f, lo), locale), locale }, source: "latest", sourceRef: ref(order) }
  }
  if (key === TEMPLATES.cartAbandoned) {
    const carts = await graphList<CartRecord>(scope, "cart", CART_FIELDS, CART_OPTIONAL_FIELDS, {}, { take: 10, order: { updated_at: "DESC" } })
    const cart = carts.find((c) => Array.isArray(c.items) && c.items.length > 0)
    if (!cart) return null
    return { data: { ...anonymize(cartData(cart, lo), locale), locale }, source: "latest", sourceRef: cart.id }
  }
  if (key === TEMPLATES.customerWelcome) {
    const customers = await graphList<CustomerRecord>(scope, "customer", CUSTOMER_FIELDS, [], { has_account: true }, { take: 1, order: { created_at: "DESC" } })
    const c = customers[0]
    if (!c) return null
    return { data: { ...anonymize(welcomeData(c, lo), locale), locale }, source: "latest", sourceRef: null }
  }
  return null
}

/** The data of a preview: the store's newest when asked for and available, else the sample. */
export async function previewData(scope: Scope, template: ResolvedTemplate, locale: EmailLocale, source: PreviewSource): Promise<PreviewData> {
  if (source === "latest" && template.source === "builtin" && LATEST_TEMPLATES.includes(template.key)) {
    try {
      const found = await fromStore(scope, template.key, locale)
      if (found) return found
    } catch (err) {
      const svc = emailsService(scope)
      svc.getLogger().warn(`[emails] Preview of ${template.key} from the store failed, the sample is shown: ${svc.mask((err as Error)?.message ?? String(err))}`)
    }
  }
  return { data: { ...sampleData(template, locale), locale }, source: "sample", sourceRef: null }
}

/** A preview as the provider would render it: the options, the admin's branding, the language asked for. */
export async function renderPreview(scope: Scope, template: ResolvedTemplate, input: { locale: EmailLocale; theme: PreviewTheme | null; source: PreviewSource }): Promise<RenderedEmail & PreviewData> {
  const svc = emailsService(scope)
  const o = svc.getOptions()
  const settings = await settingsFor(scope)
  const prepared = await previewData(scope, template, input.locale, input.source)
  const rendered = renderTemplate(template, prepared.data, { locale: input.locale, options: o, brand: applyBrandOverrides(o.brand, settings.brand), theme: input.theme })
  return { ...rendered, ...prepared }
}
