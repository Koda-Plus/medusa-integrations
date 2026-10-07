import { allegroIntegration } from "../../../../workflows/allegro/integration"

/** GET /admin/allegro/integration: the koda.integration/1 manifest (mode, entities, widgets, counters, problems). */
export const GET = allegroIntegration.manifest
