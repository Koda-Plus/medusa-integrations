import { railwayIntegration } from "../../../../../workflows/railway/integration"

/** GET /admin/railway/integration/summary: Railway has no entities, so every entity answers 400 (unsupported_entity). */
export const GET = railwayIntegration.summary
