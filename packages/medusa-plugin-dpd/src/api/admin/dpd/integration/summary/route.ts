import { dpdIntegration } from "../../../../../workflows/dpd/integration"

/** GET /admin/dpd/integration/summary?entity=order&id= (or ids=, up to 50): one line per order, with the delivery and payment facts. */
export const GET = dpdIntegration.summary
