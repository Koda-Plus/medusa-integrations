import { vonHalskyIntegration } from "../../../../../workflows/vonhalsky/integration"

/** GET /admin/vonhalsky/integration/summary?entity=order|product&id= (or ids=, up to 50): one line per marketplace order or product with offers. */
export const GET = vonHalskyIntegration.summary
