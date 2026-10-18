import { inpostPayIntegration } from "../../../../../workflows/inpostpay/integration"

/** GET /admin/inpostpay/integration/summary?entity=order&id= (or ids=, up to 50): one line per InPost Pay order. */
export const GET = inpostPayIntegration.summary
