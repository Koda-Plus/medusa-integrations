import { ceneoIntegration } from "../../../../workflows/ceneo/integration"

/** GET /admin/ceneo/integration: the koda.integration/1 manifest (who, mode, writers, widgets). */
export const GET = ceneoIntegration.manifest
