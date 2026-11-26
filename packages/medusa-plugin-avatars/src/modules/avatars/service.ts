import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import AvatarsAvatar from "./models/avatar"
import AvatarsPresentation from "./models/presentation"
import AvatarsRenderJob from "./models/render-job"
import { configuredServices, resolveOptions, type AvatarsPluginOptions, type ConfiguredServices, type ResolvedAvatarsOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * AI Avatars module service: generated CRUD for the three tables plus the
 * resolved options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The flows (consent, approval, render)
 * live in lib and workflows and work on the tables through the generated
 * methods from OUTSIDE the service.
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: without keys the paid steps refuse
 * with a clear message, everything else works.
 */
class AvatarsModuleService extends MedusaService({
  AvatarsAvatar,
  AvatarsPresentation,
  AvatarsRenderJob,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedAvatarsOptions

  constructor(deps: InjectedDependencies, options?: AvatarsPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    if (this.options_.demo) {
      this.logger_.info("[avatars] Demo mode: a sample avatar and presentation, no call to Tavus, Claude or Gemini.")
    }
  }

  getOptions(): ResolvedAvatarsOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }

  configured(): ConfiguredServices {
    return configuredServices(this.options_)
  }
}

export default AvatarsModuleService
