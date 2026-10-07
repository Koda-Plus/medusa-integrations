import { emailsIntegration } from "../../../../workflows/emails/integration"

/** GET /admin/emails/integration: the koda.integration/1 manifest (who, mode, problems, the order card). */
export const GET = emailsIntegration.manifest
