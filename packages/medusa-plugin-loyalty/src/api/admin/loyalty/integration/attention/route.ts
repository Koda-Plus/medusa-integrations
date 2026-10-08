import { loyaltyIntegration } from "../../../../../workflows/loyalty/integration"

/** GET /admin/loyalty/integration/attention?scope=customers: the board counter of customers ready for a reward. */
export const GET = loyaltyIntegration.attention
