import { packagingIntegration } from "../../../../workflows/packaging/integration"

/** GET /admin/packaging/integration: the koda.integration/1 manifest (who, mode, entities, setup problems for the team). */
export const GET = packagingIntegration.manifest
