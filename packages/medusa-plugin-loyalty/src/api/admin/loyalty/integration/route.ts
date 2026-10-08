import { loyaltyIntegration } from "../../../../workflows/loyalty/integration"

/** GET /admin/loyalty/integration: the koda.integration/1 manifest (who, mode, entities, setup problems for the team). */
export const GET = loyaltyIntegration.manifest
