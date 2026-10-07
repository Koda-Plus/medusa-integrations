import { stripeIntegration } from "../../../../../workflows/stripe/integration"

/**
 * GET /admin/stripe/integration/summary?entity=order&id= (or ids=, up to 50), or entity=customer:
 * one line per record from its Stripe payments, with the payment fact (method, fee, net).
 */
export const GET = stripeIntegration.summary
