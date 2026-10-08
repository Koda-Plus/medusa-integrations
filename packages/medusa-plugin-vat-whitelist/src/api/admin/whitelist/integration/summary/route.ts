import { whitelistIntegration } from "../../../../../workflows/whitelist/integration"

/** GET /admin/whitelist/integration/summary?entity=customer&id= (or ids=, up to 50): one line per customer whose company was checked. */
export const GET = whitelistIntegration.summary
