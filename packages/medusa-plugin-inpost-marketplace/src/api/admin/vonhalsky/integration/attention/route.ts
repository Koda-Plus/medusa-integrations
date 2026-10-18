import { vonHalskyIntegration } from "../../../../../workflows/vonhalsky/integration"

/** GET /admin/vonhalsky/integration/attention?scope=orders,products: held imports, failed tracking, orders to ship, blocked offers. */
export const GET = vonHalskyIntegration.attention
