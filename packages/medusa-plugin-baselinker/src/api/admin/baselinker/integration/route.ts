import { baselinkerIntegration } from "../../../../workflows/baselinker/integration"

/** GET /admin/baselinker/integration: the koda.integration/1 manifest (who, mode, writers, widgets, the problems to fix). */
export const GET = baselinkerIntegration.manifest
