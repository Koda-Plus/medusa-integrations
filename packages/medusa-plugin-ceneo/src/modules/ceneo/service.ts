import { MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import CeneoFeed from "./models/feed"
import CeneoOffer from "./models/offer"
import CeneoCategory from "./models/category"
import CeneoCategoryMap from "./models/category-map"
import { feedGaps, resolveOptions, type CeneoPluginOptions, type ResolvedCeneoOptions } from "./lib/options"

type InjectedDependencies = {
  logger: Logger
}

/**
 * Ceneo module service: generated CRUD for the tables plus the resolved
 * options. Nothing else.
 *
 * THE SERVICE STAYS THIN ON PURPOSE. The feed builder, the Ceneo client and
 * the writers live in `lib/*` and `workflows/*` and call the generated
 * methods from OUTSIDE the service, through the container (own methods that
 * call `this.listX()` break when the module runs as app code).
 *
 * MISSING OPTIONS NEVER BREAK THE BOOT: every option has a default, and the
 * log says once what is still missing.
 */
class CeneoModuleService extends MedusaService({
  CeneoFeed,
  CeneoOffer,
  CeneoCategory,
  CeneoCategoryMap,
}) {
  protected readonly logger_: Logger
  protected readonly options_: ResolvedCeneoOptions

  constructor(deps: InjectedDependencies, options?: CeneoPluginOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [InjectedDependencies]))
    this.logger_ = deps.logger
    this.options_ = resolveOptions(options)
    const o = this.options_
    if (o.demo) this.logger_.info("[ceneo] Demo mode: the Ceneo API is simulated, rows are flagged demo. The feed is built from the real catalog.")
    if (o.feed.tokenRejected) this.logger_.warn("[ceneo] feed.token is not 16 to 128 letters, digits, - or _: the feed is not served.")
    if (o.feed.productUrlRejected) this.logger_.warn("[ceneo] feed.productUrl is not an http(s) address with {handle}, {product_id}, {variant_id} or {sku}: the feed is not built.")
    if (o.reviews.accountGuidRejected) this.logger_.warn("[ceneo] reviews.accountGuid is not a GUID: Zaufane Opinie stay off.")
    /* Rejected values were warned about above; the missing ones are listed here. */
    const missing = feedGaps(o).filter((g) => g === "token" || g === "product_url")
    if (missing.length > 0) {
      this.logger_.info(`[ceneo] The feed waits for: ${missing.map((g) => (g === "token" ? "feed.token" : "feed.productUrl")).join(", ")}.`)
    }
  }

  getOptions(): ResolvedCeneoOptions {
    return this.options_
  }

  getLogger(): Logger {
    return this.logger_
  }

  isDemo(): boolean {
    return this.options_.demo
  }
}

export default CeneoModuleService
