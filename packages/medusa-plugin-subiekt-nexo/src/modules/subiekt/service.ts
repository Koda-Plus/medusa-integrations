import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import SubiektConnection from "./models/subiekt-connection"
import SubiektDocument from "./models/subiekt-document"
import SubiektSyncRun from "./models/subiekt-sync-run"
import SubiektTask from "./models/subiekt-task"
import { missingOptions, resolveOptions, type ResolvedSubiektOptions, type SubiektPluginOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Subiekt nexo module service: generated CRUD for the four tables plus the
 * resolved options. The work (calling the bridge, the task queue, stock and
 * events) lives in `src/workflows/subiekt` and calls the generated methods
 * from the outside, so the service stays thin and every flow is reusable
 * from your own workflows.
 *
 * MISSING CREDENTIALS DO NOT BREAK THE BOOT. The module always registers;
 * without them the admin lists what is missing and the jobs wait.
 */
class SubiektModuleService extends MedusaService({
  SubiektConnection,
  SubiektTask,
  SubiektDocument,
  SubiektSyncRun,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedSubiektOptions

  constructor(deps: InjectedDependencies, options?: SubiektPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[subiekt] Demo mode: a simulated bridge issues ZK and WZ numbers, nothing leaves Medusa.")
    } else if (!this.isConfigured()) {
      this.logger_.info(`[subiekt] Waiting for configuration, missing: ${this.missingOptions().join(", ")}.`)
    }
  }

  /** Resolved options WITH secrets. Server side only, never send to the admin. */
  getOptions(): ResolvedSubiektOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  isConfigured(): boolean {
    return missingOptions(this.options_).length === 0
  }

  missingOptions(): string[] {
    return missingOptions(this.options_)
  }

  /** Removes the configured secrets from a text before it is logged or stored. */
  mask(text: string): string {
    let out = text
    for (const secret of [this.options_.secret, this.options_.previousSecret, this.options_.cfAccessClientSecret]) {
      if (secret && secret.length >= 6) out = out.split(secret).join("***")
    }
    return out
  }
}

export default SubiektModuleService
