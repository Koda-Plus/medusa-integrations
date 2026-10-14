import { couponsIntegration } from "../../../../../workflows/coupons/integration"

/** GET /admin/coupons/integration/summary?entity=order|customer|product&id= (or ids=, up to 50). */
export const GET = couponsIntegration.summary
