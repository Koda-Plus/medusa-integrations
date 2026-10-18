import { inpostPayIntegration } from "../../../../workflows/inpostpay/integration"

/** GET /admin/inpostpay/integration: the koda.integration/1 manifest (who, mode, entities, setup problems). */
export const GET = inpostPayIntegration.manifest
