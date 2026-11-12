import { ceneoIntegration } from "../../../../../workflows/ceneo/integration"

/** GET /admin/ceneo/integration/attention?scope=orders|products|integration: the board counters. */
export const GET = ceneoIntegration.attention
