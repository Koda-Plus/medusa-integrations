import { complianceIntegration } from "../../../../workflows/compliance/integration"

/** GET /admin/compliance/integration: the koda.integration/1 manifest (who, mode, entities, setup problems for the team). */
export const GET = complianceIntegration.manifest
