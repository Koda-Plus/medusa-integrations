import { creditIntegration } from "../../../../../workflows/credit/integration"

/** GET /admin/credit/integration/attention?scope=customers: the board counter of credit limits to check. */
export const GET = creditIntegration.attention
