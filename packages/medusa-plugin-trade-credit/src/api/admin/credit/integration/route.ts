import { creditIntegration } from "../../../../workflows/credit/integration"

/** GET /admin/credit/integration: the koda.integration/1 manifest (who, mode, entities, setup problems for the team). */
export const GET = creditIntegration.manifest
