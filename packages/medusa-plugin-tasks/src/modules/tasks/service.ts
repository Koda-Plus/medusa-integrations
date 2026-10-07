import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import TasksActivity from "./models/task-activity"
import TasksComment from "./models/task-comment"
import TasksLink from "./models/task-link"
import TasksSetting from "./models/task-setting"
import TasksTask from "./models/task"
import { resolveOptions, type ResolvedTasksOptions, type TasksPluginOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Tasks module service: generated CRUD for the five tables plus the resolved
 * options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The flows (create, update, move,
 * delete, comments, links, the sandbox board) live in `src/workflows/tasks`
 * and work on the tables through `lib/store.ts`: SQL on Medusa's own
 * connection, every statement bound to one board. A custom method here that
 * calls `this.list*` breaks on the Koda Plus demo with a `fork` error of the
 * entity manager, and the flows are reusable from your own workflows anyway.
 * The generated methods (`listTasksTasks`, `listTasksComments`...) stay
 * available for custom code that only reads; they do not know about boards,
 * so filter by `board` yourself.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default.
 */
class TasksModuleService extends MedusaService({
  TasksTask,
  TasksComment,
  TasksActivity,
  TasksLink,
  TasksSetting,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedTasksOptions

  constructor(deps: InjectedDependencies, options?: TasksPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.sandboxAccounts.length > 0) {
      this.logger_.info(`[tasks] Sandbox board for ${this.options_.sandboxAccounts.length} account(s): they never see the main board.`)
    }
  }

  getOptions(): ResolvedTasksOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }
}

export default TasksModuleService
