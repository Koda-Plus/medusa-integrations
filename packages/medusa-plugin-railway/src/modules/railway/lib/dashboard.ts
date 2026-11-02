/**
 * Links into the Railway dashboard. No runtime imports beyond the pure helpers.
 *
 *   project      https://railway.com/project/<project>?environmentId=<env>
 *   service      https://railway.com/project/<project>/service/<service>?environmentId=<env>
 *   deployment   https://railway.com/project/<project>/service/<service>?environmentId=<env>&id=<deployment>
 *
 * Ids pass `safeId` first; anything else yields no link.
 */
import type { Links } from "./normalize"
import { safeId } from "./security"

export class DashboardLinks implements Links {
  readonly base: string
  private readonly projectId: string | null
  private readonly environmentId: string | null

  constructor(base: string, projectId: string | null, environmentId: string | null) {
    this.base = base.replace(/\/+$/, "")
    this.projectId = safeId(projectId)
    this.environmentId = safeId(environmentId)
  }

  private env(): string {
    return this.environmentId ? `?environmentId=${encodeURIComponent(this.environmentId)}` : ""
  }

  project(): string {
    return this.projectId ? `${this.base}/project/${this.projectId}${this.env()}` : `${this.base}/dashboard`
  }

  service(serviceId: string): string | null {
    const s = safeId(serviceId)
    return this.projectId && s ? `${this.base}/project/${this.projectId}/service/${s}${this.env()}` : null
  }

  deployment(serviceId: string | null, deploymentId: string): string | null {
    const s = safeId(serviceId)
    const d = safeId(deploymentId)
    if (!this.projectId || !s || !d) return null
    return `${this.base}/project/${this.projectId}/service/${s}${this.env() ? `${this.env()}&` : "?"}id=${encodeURIComponent(d)}`
  }

  tokens(): string {
    return this.projectId ? `${this.base}/project/${this.projectId}/settings/tokens` : `${this.base}/account/tokens`
  }
}
