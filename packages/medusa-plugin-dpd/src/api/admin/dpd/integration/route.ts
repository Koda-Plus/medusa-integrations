import { dpdIntegration } from "../../../../workflows/dpd/integration"

/** GET /admin/dpd/integration: the koda.integration/1 manifest (who, mode, writers, widgets). */
export const GET = dpdIntegration.manifest
