import { TEMPLATES } from "../constants"
import type { EmailTemplateDefinition } from "../types"
import { cartAbandonedTemplate } from "./cart-abandoned"
import { customerWelcomeTemplate } from "./customer-welcome"
import { negotiationAcceptedTemplate, negotiationCounteredTemplate, negotiationRejectedTemplate } from "./negotiation"
import { orderCanceledTemplate } from "./order-canceled"
import { orderPlacedTemplate } from "./order-placed"
import { orderShippedTemplate } from "./order-shipped"
import { passwordResetTemplate } from "./password-reset"

/**
 * The built-in templates, in the order the admin lists them. Keys stay
 * stable: app code calling `createNotifications({ template: "order.placed" })`
 * keeps working across versions.
 */
export const BUILT_IN_TEMPLATES: ReadonlyArray<[string, EmailTemplateDefinition<any>]> = [
  [TEMPLATES.orderPlaced, orderPlacedTemplate],
  [TEMPLATES.orderShipped, orderShippedTemplate],
  [TEMPLATES.orderCanceled, orderCanceledTemplate],
  [TEMPLATES.customerWelcome, customerWelcomeTemplate],
  [TEMPLATES.passwordReset, passwordResetTemplate],
  [TEMPLATES.cartAbandoned, cartAbandonedTemplate],
  [TEMPLATES.negotiationCountered, negotiationCounteredTemplate],
  [TEMPLATES.negotiationAccepted, negotiationAcceptedTemplate],
  [TEMPLATES.negotiationRejected, negotiationRejectedTemplate],
]

export const BUILT_IN_KEYS: readonly string[] = BUILT_IN_TEMPLATES.map(([key]) => key)

export { COPY } from "./copy"
export { sampleCanceled, sampleCart, sampleNegotiation, sampleOrder, samplePasswordReset, sampleShipment, sampleWelcome } from "./samples"
