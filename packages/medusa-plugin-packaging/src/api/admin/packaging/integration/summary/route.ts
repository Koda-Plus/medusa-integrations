import { packagingIntegration } from "../../../../../workflows/packaging/integration"

/** GET /admin/packaging/integration/summary?entity=product&id= (or ids=, up to 50): one line per product with its ladder. */
export const GET = packagingIntegration.summary
