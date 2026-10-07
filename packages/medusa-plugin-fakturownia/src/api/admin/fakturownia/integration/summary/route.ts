import { fakturowniaIntegration } from "../../../../../workflows/fakturownia/integration"

/** GET /admin/fakturownia/integration/summary?entity=order|customer&id= (or ids=, up to 50): one line per record, with the document and buyer facts. */
export const GET = fakturowniaIntegration.summary
