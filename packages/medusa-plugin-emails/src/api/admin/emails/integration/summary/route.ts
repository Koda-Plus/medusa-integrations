import { emailsIntegration } from "../../../../../workflows/emails/integration"

/** GET /admin/emails/integration/summary?entity=order|customer&id= (or ids=, up to 50): one line per record, the worst message speaking. */
export const GET = emailsIntegration.summary
