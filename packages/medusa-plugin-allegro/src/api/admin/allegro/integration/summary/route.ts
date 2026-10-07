import { allegroIntegration } from "../../../../../workflows/allegro/integration"

/** GET /admin/allegro/integration/summary?entity=order|product|variant&id= (or ids=, up to 50): one line per record, with its facts. */
export const GET = allegroIntegration.summary
