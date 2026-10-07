import { tasksIntegration } from "../../../../../workflows/tasks/integration"

/** GET /admin/tasks/integration/attention?scope=orders,products,customers,integration: board counters, each with its filtered board. */
export const GET = tasksIntegration.attention
