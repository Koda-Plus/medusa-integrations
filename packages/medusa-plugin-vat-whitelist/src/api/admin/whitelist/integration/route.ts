import { whitelistIntegration } from "../../../../workflows/whitelist/integration"

/** GET /admin/whitelist/integration: the koda.integration/1 manifest (who, mode, entities, setup problems for the team). */
export const GET = whitelistIntegration.manifest
