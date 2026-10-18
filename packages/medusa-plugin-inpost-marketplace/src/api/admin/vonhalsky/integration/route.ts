import { vonHalskyIntegration } from "../../../../workflows/vonhalsky/integration"

/** GET /admin/vonhalsky/integration: the koda.integration/1 manifest (who, mode, entities, setup problems). */
export const GET = vonHalskyIntegration.manifest
