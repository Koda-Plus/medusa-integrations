import { railwayIntegration } from "../../../../../workflows/railway/integration"

/** GET /admin/railway/integration/attention?scope=integration: failing deployments, resources near the limit, many errors. */
export const GET = railwayIntegration.attention
