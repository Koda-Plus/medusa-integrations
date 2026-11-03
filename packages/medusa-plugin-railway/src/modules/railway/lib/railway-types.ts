/**
 * The parts of Railway's GraphQL answers the plugin reads, every field
 * optional: Railway's schema moves, and a missing field must show as "not
 * known", never crash the page. Shapes follow the documents in queries.ts.
 */

export interface RawDeployment {
  id?: string | null
  status?: string | null
  createdAt?: string | null
  statusUpdatedAt?: string | null
  updatedAt?: string | null
  url?: string | null
  staticUrl?: string | null
  /** JSON: commitHash, commitMessage, commitAuthor, branch, repo... */
  meta?: Record<string, unknown> | null
  creator?: { name?: string | null } | null
  instances?: Array<{ status?: string | null } | null> | null
  projectId?: string | null
  environmentId?: string | null
  serviceId?: string | null
}

export interface RawServiceInstance {
  serviceId?: string | null
  serviceName?: string | null
  region?: string | null
  numReplicas?: number | null
  source?: { repo?: string | null; image?: string | null } | null
  latestDeployment?: RawDeployment | null
  activeDeployments?: RawDeployment[] | null
  domains?: {
    serviceDomains?: Array<{ domain?: string | null; syncStatus?: string | null } | null> | null
    customDomains?: Array<{ domain?: string | null; status?: { verified?: boolean | null; certificateStatus?: string | null; certificateErrorMessage?: string | null } | null } | null> | null
  } | null
}

export interface RawVolumeInstance {
  id?: string | null
  serviceId?: string | null
  mountPath?: string | null
  sizeMB?: number | null
  currentSizeMB?: number | null
  state?: string | null
  volume?: { name?: string | null } | null
}

export interface RawEdges<T> {
  edges?: Array<{ node?: T | null } | null> | null
}

export interface RawOverview {
  project?: { id?: string | null; name?: string | null; environments?: RawEdges<{ id?: string | null; name?: string | null }> | null } | null
  environment?: {
    id?: string | null
    name?: string | null
    serviceInstances?: RawEdges<RawServiceInstance> | null
    volumeInstances?: RawEdges<RawVolumeInstance> | null
  } | null
}

export interface RawLog {
  timestamp?: string | null
  message?: string | null
  severity?: string | null
}

export interface RawMetric {
  measurement?: string | null
  tags?: { serviceId?: string | null } | null
  values?: Array<{ ts?: number | null; value?: number | null } | null> | null
}

export function nodesOf<T>(conn: RawEdges<T> | null | undefined): T[] {
  return (conn?.edges ?? []).map((e) => e?.node).filter((n): n is T => Boolean(n))
}
