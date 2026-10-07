import { stripeIntegration } from "../../../../../workflows/stripe/integration"

/** GET /admin/stripe/integration/attention?scope=orders,integration: board counters, each with its filtered list. */
export const GET = stripeIntegration.attention
