import { complianceIntegration } from "../../../../../workflows/compliance/integration"

/** GET /admin/compliance/integration/attention?scope=products,customers: board counters, each linking to the Compliance page. */
export const GET = complianceIntegration.attention
