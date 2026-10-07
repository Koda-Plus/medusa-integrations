import { allegroIntegration } from "../../../../../workflows/allegro/integration"

/** GET /admin/allegro/integration/attention?scope=orders,products: the board counters, each with the page link it counts. */
export const GET = allegroIntegration.attention
