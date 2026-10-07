import { stripeIntegration } from "../../../../workflows/stripe/integration"

/** GET /admin/stripe/integration: the koda.integration/1 manifest (who, mode, widgets, problems). */
export const GET = stripeIntegration.manifest
