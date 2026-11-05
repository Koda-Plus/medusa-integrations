import { dpdIntegration } from "../../../../../workflows/dpd/integration"

/** GET /admin/dpd/integration/attention?scope=orders: the board counters (problems, to ship, to hand to the courier). */
export const GET = dpdIntegration.attention
