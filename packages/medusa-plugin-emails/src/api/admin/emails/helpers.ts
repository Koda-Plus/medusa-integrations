import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PLUGIN_VERSION, TEST_LIMIT_PER_HOUR, TEST_LIMIT_PER_USER, TEST_WINDOW_MS } from "../../../modules/emails/lib/constants"
import type { MessageFilter, ProviderDto, StatusResponse, TemplateDto } from "../../../modules/emails/lib/contract"
import { toBrandDto } from "../../../modules/emails/lib/dto"
import { fingerprintDifferences, missingOptions, optionsFingerprint, recommendedOptions } from "../../../modules/emails/lib/options"
import { providerNote } from "../../../modules/emails/lib/provider-status"
import { listTemplates } from "../../../modules/emails/lib/registry"
import { applyBrandOverrides, BRAND_FIELDS, templateState } from "../../../modules/emails/lib/settings"
import type { StatRow } from "../../../modules/emails/lib/store"
import { LATEST_TEMPLATES } from "../../../workflows/emails/preview"
import { actorNames, adminResetLink, emailsService, resolveOptional, settingsFor, storeFor, type Scope } from "../../../workflows/emails/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { emailsService }

/** The user id of an admin request (who changed a setting, who sent a test). */
export function actorOf(req: MedusaRequest): string | null {
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } }).auth_context
  return typeof ctx?.actor_id === "string" && ctx.actor_id ? ctx.actor_id : null
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function strParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

/** `%q%` for `$ilike`, with the wildcard characters of the search escaped. */
export function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** The table filter as service filters, in the current mode. */
export function messageFilters(filter: MessageFilter, demo: boolean): Record<string, unknown> {
  const where: Record<string, unknown> = { demo }
  switch (filter) {
    case "sent":
      where.status = "sent"
      break
    case "attention":
      where.status = ["failed", "unknown"]
      break
    case "skipped":
      where.status = "skipped"
      break
    case "test":
      where.kind = "test"
      break
  }
  return where
}

/** Enabled providers of the email channel in Medusa's own table, or null when it cannot be read. */
async function emailProviders(scope: Scope): Promise<string[] | null> {
  const pg = resolveOptional<{ raw(sql: string, b?: unknown[]): Promise<{ rows?: Array<{ id: string }> }> }>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  if (!pg) return null
  try {
    const r = await pg.raw(`select "id" from "notification_provider" where "is_enabled" = true and 'email' = any("channels") order by "id"`)
    return (r.rows ?? []).map((row) => row.id)
  } catch {
    return null
  }
}

function emptyStats(): TemplateDto["stats"] {
  return { sent: 0, failed: 0, skipped: 0, lastAt: null }
}

function statsByTemplate(rows: readonly StatRow[]): Record<string, TemplateDto["stats"]> {
  const out: Record<string, TemplateDto["stats"]> = {}
  for (const r of rows) {
    const s = (out[r.template] ??= emptyStats())
    if (r.status === "sent") s.sent += r.count
    else if (r.status === "failed" || r.status === "unknown") s.failed += r.count
    else if (r.status === "skipped") s.skipped += r.count
    const at = r.last_at ? new Date(r.last_at).toISOString() : null
    if (at && (!s.lastAt || at > s.lastAt)) s.lastAt = at
  }
  return out
}

/**
 * Status for the admin. Reads the database and the options only, never
 * Resend. Counters cover the last 30 days of the current mode.
 */
export async function buildStatus(scope: Scope): Promise<StatusResponse> {
  const svc = emailsService(scope)
  const o = svc.getOptions()
  const now = new Date()
  const store = storeFor(scope)
  const settings = await settingsFor(scope)

  let logReady = true
  let counts = { sent24h: 0, sent30d: 0, attention30d: 0, tests30d: 0, skipped30d: 0 }
  let stats: Record<string, TemplateDto["stats"]> = {}
  try {
    counts = await store.counts(o.demo, now)
    stats = statsByTemplate(await store.stats(o.demo, new Date(now.getTime() - 30 * 24 * 3600 * 1000)))
  } catch {
    logReady = false
  }

  const names = await actorNames(scope, [settings.brandUpdatedBy, ...Object.values(settings.templates).map((t) => t.updatedBy)])
  const templates: TemplateDto[] = listTemplates(o).map((t) => {
    const state = templateState(t.key, t.def.enabledByDefault !== false, o, settings)
    const label = t.def.label
    const description = t.def.description
    const text = (v: typeof label) => (v === undefined ? null : typeof v === "string" ? { en: v, pl: v } : { en: v.en ?? null, pl: v.pl ?? null })
    return {
      key: t.key,
      source: t.source === "builtin" ? "builtin" : "app",
      label: text(label),
      description: text(description),
      trigger: { kind: t.def.trigger?.kind ?? "manual", name: t.def.trigger?.name ?? null },
      optional: state.optional,
      allowed: state.allowed,
      on: state.on,
      enabled: state.enabled,
      updatedBy: state.updatedBy ? names[state.updatedBy] ?? state.updatedBy : null,
      updatedAt: state.updatedAt,
      latest: t.source === "builtin" && LATEST_TEMPLATES.includes(t.key),
      stats: stats[t.key] ?? emptyStats(),
    }
  })

  const note = providerNote()
  const provider: ProviderDto = {
    loaded: Boolean(note),
    loadedAt: note?.loadedAt ?? null,
    channels: note?.channels ?? [],
    emailProviders: await emailProviders(scope),
    sameOptions: note ? fingerprintDifferences(note.fingerprint, optionsFingerprint(o)).length === 0 : null,
    differences: note ? fingerprintDifferences(note.fingerprint, optionsFingerprint(o)) : [],
  }

  const overrides = settings.brand ?? {}
  return {
    version: PLUGIN_VERSION,
    mode: o.mode,
    configured: missingOptions(o).length === 0,
    missing: missingOptions(o),
    recommended: recommendedOptions(o),
    problems: o.problems,
    sender: { from: o.sender?.value ?? null, domain: o.sender?.domain ?? null, replyTo: o.replyTo, apiKeySet: Boolean(o.apiKey) },
    brand: toBrandDto(applyBrandOverrides(o.brand, settings.brand)),
    brandOptions: toBrandDto(o.brand),
    brandOverridden: BRAND_FIELDS.filter((f) => (overrides as Record<string, unknown>)[f] !== undefined && (overrides as Record<string, unknown>)[f] !== null),
    brandUpdatedBy: settings.brandUpdatedBy ? names[settings.brandUpdatedBy] ?? settings.brandUpdatedBy : null,
    brandUpdatedAt: settings.brandUpdatedAt,
    defaultLocale: o.defaultLocale,
    timeZone: o.timeZone,
    storefrontUrl: o.storefrontUrl,
    links: { ...o.links, adminPasswordReset: adminResetLink(scope, o.links) },
    provider,
    templates,
    counts,
    abandonedCart: o.abandonedCart,
    limits: { testsPerUser: TEST_LIMIT_PER_USER, testWindowMinutes: Math.round(TEST_WINDOW_MS / 60000), testsPerHour: TEST_LIMIT_PER_HOUR },
    retentionDays: o.logRetentionDays,
    references: o.references,
    logReady,
  }
}
