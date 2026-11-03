/**
 * THE ONLY GRAPHQL DOCUMENTS THE PLUGIN SENDS. No runtime imports.
 *
 * Fixed strings: ids, dates and filters travel as variables. Each one is a
 * query (the client's guard refuses anything else), checked against
 * Railway's public schema (backboard.railway.com/graphql/v2). Fields the
 * panel does not show are not asked for; variable VALUES are asked for
 * unrendered (a reference stays `${{Postgres.DATABASE_URL}}`) and reduced
 * to names on the server.
 */

/** A project token names its project and environment. */
export const Q_PROJECT_TOKEN = `query KodaRailwayProjectToken { projectToken { projectId environmentId } }`

const DEPLOYMENT_FIELDS = `id status createdAt statusUpdatedAt updatedAt url staticUrl meta creator { name } instances { status }`

/** The project, its environments, and the chosen environment's services with their latest and active deployments, domains and volumes. */
export const Q_OVERVIEW = `query KodaRailwayOverview($projectId: String!, $environmentId: String!) {
  project(id: $projectId) {
    id
    name
    environments(first: 20) { edges { node { id name } } }
  }
  environment(id: $environmentId, projectId: $projectId) {
    id
    name
    serviceInstances(first: 50) {
      edges {
        node {
          serviceId
          serviceName
          region
          numReplicas
          source { repo image }
          latestDeployment { ${DEPLOYMENT_FIELDS} }
          activeDeployments { ${DEPLOYMENT_FIELDS} }
          domains {
            serviceDomains { domain syncStatus }
            customDomains { domain status { verified certificateStatus certificateErrorMessage } }
          }
        }
      }
    }
    volumeInstances(first: 50) {
      edges { node { id serviceId mountPath sizeMB currentSizeMB state volume { name } } }
    }
  }
}`

/** The environments of a project, for an account token without environmentId. */
export const Q_ENVIRONMENTS = `query KodaRailwayEnvironments($projectId: String!) {
  project(id: $projectId) { id name environments(first: 20) { edges { node { id name } } } }
}`

/** Memory use and limit of every service of the environment, for the overview (one request for all). */
export const Q_MEMORY = `query KodaRailwayMemory($projectId: String!, $environmentId: String!, $startDate: DateTime!) {
  metrics(projectId: $projectId, environmentId: $environmentId, startDate: $startDate, sampleRateSeconds: 300, measurements: [MEMORY_USAGE_GB, MEMORY_LIMIT_GB], groupBy: [SERVICE_ID]) {
    measurement
    tags { serviceId }
    values { ts value }
  }
}`

/** The metrics of one service. */
export const Q_SERVICE_METRICS = `query KodaRailwayServiceMetrics($projectId: String!, $environmentId: String!, $serviceId: String!, $startDate: DateTime!, $endDate: DateTime, $sampleRateSeconds: Int) {
  metrics(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, startDate: $startDate, endDate: $endDate, sampleRateSeconds: $sampleRateSeconds, measurements: [CPU_USAGE, CPU_LIMIT, MEMORY_USAGE_GB, MEMORY_LIMIT_GB, NETWORK_RX_GB, NETWORK_TX_GB]) {
    measurement
    values { ts value }
  }
}`

/** The deployment history of one service. */
export const Q_DEPLOYMENTS = `query KodaRailwayDeployments($projectId: String!, $environmentId: String!, $serviceId: String!, $first: Int!) {
  deployments(first: $first, input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId }) {
    edges { node { ${DEPLOYMENT_FIELDS} } }
  }
}`

/** Runtime logs of a deployment, with the deployment's own ids so the server can check it belongs to the project. */
export const Q_DEPLOYMENT_LOGS = `query KodaRailwayDeploymentLogs($deploymentId: String!, $limit: Int, $filter: String, $startDate: DateTime) {
  deployment(id: $deploymentId) { id projectId environmentId serviceId status }
  deploymentLogs(deploymentId: $deploymentId, limit: $limit, filter: $filter, startDate: $startDate) { timestamp message severity }
}`

/** Build logs of a deployment. */
export const Q_BUILD_LOGS = `query KodaRailwayBuildLogs($deploymentId: String!, $limit: Int, $filter: String, $startDate: DateTime) {
  deployment(id: $deploymentId) { id projectId environmentId serviceId status }
  buildLogs(deploymentId: $deploymentId, limit: $limit, filter: $filter, startDate: $startDate) { timestamp message severity }
}`

/** The variables of one service, unrendered: only the names and whether a value is set leave the server. */
export const Q_VARIABLES = `query KodaRailwayVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
  variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, unrendered: true)
}`

/**
 * Error lines of the last hour, one alias per deployment (d0, d1...). Built
 * from a fixed template: the aliases are generated, the ids are variables.
 */
export function errorScanDocument(count: number): string {
  const n = Math.max(0, Math.min(20, Math.floor(count)))
  const vars = Array.from({ length: n }, (_, i) => `$d${i}: String!`).join(", ")
  const fields = Array.from({ length: n }, (_, i) => `  d${i}: deploymentLogs(deploymentId: $d${i}, limit: $limit, startDate: $startDate) { timestamp message severity }`).join("\n")
  return `query KodaRailwayErrorScan($limit: Int, $startDate: DateTime${n ? `, ${vars}` : ""}) {\n${fields || "  __typename"}\n}`
}

export const ALL_DOCUMENTS: readonly string[] = [Q_PROJECT_TOKEN, Q_OVERVIEW, Q_ENVIRONMENTS, Q_MEMORY, Q_SERVICE_METRICS, Q_DEPLOYMENTS, Q_DEPLOYMENT_LOGS, Q_BUILD_LOGS, Q_VARIABLES, errorScanDocument(3)]
