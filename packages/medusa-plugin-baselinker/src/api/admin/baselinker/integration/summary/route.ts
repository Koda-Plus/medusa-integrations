import { baselinkerIntegration } from "../../../../../workflows/baselinker/integration"

/**
 * GET /admin/baselinker/integration/summary?entity=order|product|inventory_item&id= (or ids=, up to 50):
 * one line per record, the worst row speaking, with the channel, delivery, document, payment and stock facts.
 */
export const GET = baselinkerIntegration.summary
