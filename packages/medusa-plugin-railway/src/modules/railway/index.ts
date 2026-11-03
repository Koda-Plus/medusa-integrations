import { Module } from "@medusajs/framework/utils"
import KodaRailwayModuleService from "./service"
import { RAILWAY_MODULE } from "./lib/constants"

/**
 * Railway module of Railway by Koda Plus: options, the token and masking.
 * Read only by construction (see `lib/client.ts` and `lib/security.ts`),
 * no tables, no links, no jobs, no subscribers.
 *
 * Registered under `koda_railway`: see `lib/constants.ts`.
 */
export { RAILWAY_MODULE }
export type { RailwayPluginOptions } from "./lib/options"
export type {
  DeploymentDto,
  DeploymentsResponse,
  LogsResponse,
  MetricsResponse,
  OverviewResponse,
  ProblemDto,
  ServiceDto,
  StatusResponse,
  VariablesResponse,
} from "./lib/contract"

export default Module(RAILWAY_MODULE, {
  service: KodaRailwayModuleService,
})
