import { defineMiddlewares } from "@medusajs/framework/http"
import { writeGuard } from "../modules/tasks/lib/kit-guards"
import { tasksAdminGuard } from "../workflows/tasks/guard"

/**
 * Writes to /admin/tasks come from the admin or a server (a JSON body or the
 * x-koda-request header), never from a form on another site.
 *
 * On every /admin route: a secret API key whose title starts with the agent
 * prefix ("tasks:") reaches only Tasks, and with `sandboxGuard` on, sandbox
 * accounts stay away from invites, admin users, API keys and every write
 * outside Tasks (see `lib/guard.ts`).
 *
 * The plugin reads no order or cart metadata, so no store route needs a
 * metadata guard.
 */
export default defineMiddlewares({
  routes: [
    { matcher: "/admin/tasks*", middlewares: [writeGuard()] },
    { matcher: "/admin*", middlewares: [tasksAdminGuard()] },
  ],
})
