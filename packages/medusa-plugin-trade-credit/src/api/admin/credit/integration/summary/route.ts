import { creditIntegration } from "../../../../../workflows/credit/integration"

/** GET /admin/credit/integration/summary?entity=customer&id= (or ids=, up to 50): one line per customer with credit terms. */
export const GET = creditIntegration.summary
