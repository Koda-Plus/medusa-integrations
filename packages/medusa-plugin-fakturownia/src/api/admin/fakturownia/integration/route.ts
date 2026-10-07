import { fakturowniaIntegration } from "../../../../workflows/fakturownia/integration"

/** GET /admin/fakturownia/integration: the koda.integration/1 manifest (who, mode, writers, widgets). */
export const GET = fakturowniaIntegration.manifest
