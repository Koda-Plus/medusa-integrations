import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { boardView, listTasks } from "../../../../workflows/tasks/read"
import { createTask } from "../../../../workflows/tasks/tasks"
import { bodyOf, onBoard, queryOf } from "../helpers"

/**
 * GET /admin/tasks/tasks
 *
 * Tasks of the board of the person (or key) asking.
 *
 * - `view=board`: every open task and the latest closed ones
 *   (`closed_limit` per closed column, default 100), with the counters.
 *   What the admin page reads.
 * - otherwise a list for scripts: `status` and `priority` (comma separated),
 *   `assignee_id`, `assignee` (free text), `unassigned=true`, `tag`, `q`
 *   (title, description, assignee), `link_type` with `link_id`, `limit`
 *   (default 100, at most 500) and `offset`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const query = queryOf(req)
  await onBoard(req, res, (ctx) => (query.view === "board" ? boardView(req.scope, ctx, query) : listTasks(req.scope, ctx, query)))
}

/**
 * POST /admin/tasks/tasks
 *
 * A new task at the end of its column: `title` (required), `description`,
 * `status` (default todo), `priority` (default medium), the assignee
 * (`assignee_id`, `assignee_email` or free text `assignee`), `due_date`
 * (YYYY-MM-DD), `tags`, `links` (`[{ type: "order", id: "order_..." }]`).
 * Scripts and AI agents may sign with `author`. Answers `{ task }` (201).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, async (ctx) => ({ task: await createTask(req.scope, ctx, bodyOf(req)) }), 201)
}
