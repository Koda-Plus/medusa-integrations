import { complianceIntegration } from "../../../../../workflows/compliance/integration"

/**
 * GET /admin/compliance/integration/summary?entity=product&id= (or ids=, up
 * to 50; entity product or customer): one line per record with its GPSR
 * record or its data requests.
 */
export const GET = complianceIntegration.summary
