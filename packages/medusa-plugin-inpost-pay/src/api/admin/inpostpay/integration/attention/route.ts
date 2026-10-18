import { inpostPayIntegration } from "../../../../../workflows/inpostpay/integration"

/** GET /admin/inpostpay/integration/attention?scope=orders: orders without payment, baskets whose order failed. */
export const GET = inpostPayIntegration.attention
