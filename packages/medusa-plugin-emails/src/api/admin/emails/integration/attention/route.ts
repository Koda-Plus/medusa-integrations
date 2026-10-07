import { emailsIntegration } from "../../../../../workflows/emails/integration"

/** GET /admin/emails/integration/attention?scope=orders,customers: board counters of the last 7 days, each with its filtered list. */
export const GET = emailsIntegration.attention
