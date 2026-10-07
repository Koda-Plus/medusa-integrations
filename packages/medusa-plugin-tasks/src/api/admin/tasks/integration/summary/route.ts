import { tasksIntegration } from "../../../../../workflows/tasks/integration"

/**
 * GET /admin/tasks/integration/summary?entity=order&id= (or ids=, up to 50;
 * entity order, product or customer): one line per record with linked tasks,
 * on the board of the person or key asking.
 */
export const GET = tasksIntegration.summary
