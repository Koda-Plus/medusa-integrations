/**
 * The reads behind the admin page, for your own code (a daily report, a
 * message when a deployment fails). Every function takes the Medusa
 * container (or a request scope) and goes through the same cache as the admin:
 *
 *   import { loadRailwayOverview } from "@koda-plus/medusa-plugin-railway/workflows"
 *   const { problems } = await loadRailwayOverview(container)
 *
 * All of them only read, with GraphQL queries: the client refuses any
 * document with a mutation.
 */
export { loadRailwayDeployments, loadRailwayLogs, loadRailwayMetrics, loadRailwayOverview, loadRailwayVariables, resolveIdentity } from "./railway/reads"
/** koda.integration/1 for in-process hosts: `railwayIntegration.build.attention(ctx, ["integration"])` answers without HTTP. */
export { railwayIntegration } from "./railway/integration"
