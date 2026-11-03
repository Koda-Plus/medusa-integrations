import { railwayIntegration } from "../../../../workflows/railway/integration"

/** GET /admin/railway/integration: the koda.integration/1 manifest (who, mode, problems). */
export const GET = railwayIntegration.manifest
