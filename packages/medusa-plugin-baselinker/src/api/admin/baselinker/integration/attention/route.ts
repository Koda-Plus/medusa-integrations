import { baselinkerIntegration } from "../../../../../workflows/baselinker/integration"

/** GET /admin/baselinker/integration/attention?scope=orders,products,inventory: board counters, each with its filtered list. */
export const GET = baselinkerIntegration.attention
