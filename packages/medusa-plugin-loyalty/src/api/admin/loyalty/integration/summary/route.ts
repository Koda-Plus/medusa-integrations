import { loyaltyIntegration } from "../../../../../workflows/loyalty/integration"

/** GET /admin/loyalty/integration/summary?entity=customer&id= (or ids=, up to 50): one line per customer with points. */
export const GET = loyaltyIntegration.summary
