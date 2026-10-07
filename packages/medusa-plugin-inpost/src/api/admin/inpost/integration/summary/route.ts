import { inpostIntegration } from "../../../../../workflows/inpost/integration"

/** GET /admin/inpost/integration/summary?entity=order&id= (or ids=, up to 50): one line per order, with the delivery facts. */
export const GET = inpostIntegration.summary
