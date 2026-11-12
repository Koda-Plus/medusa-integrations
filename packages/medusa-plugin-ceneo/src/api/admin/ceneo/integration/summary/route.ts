import { ceneoIntegration } from "../../../../../workflows/ceneo/integration"

/** GET /admin/ceneo/integration/summary?entity=order|product&id= (or ids=, up to 50): one line per Kup Teraz order or product. */
export const GET = ceneoIntegration.summary
