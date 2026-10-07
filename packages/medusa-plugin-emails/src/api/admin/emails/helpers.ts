import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TEST_LIMIT_PER_HOUR, TEST_LIMIT_PER_USER, TEST_WINDOW_MS } from "../../../modules/emails/lib/constants"
import type { MessageFilter, MessageWindow, ProviderDto, StatusResponse, TemplateDto } from "../../../modules/emails/lib/contract"
import { localized, toBrandDto } from "../../../modules/emails/lib/dto"
import { KIT_META } from "../../../modules/emails/lib/kit-meta"
import { fingerprintDifferences, missingOptions, optionsFingerprint, recommendedOptions } from "../../../modules/emails/lib/options"
import { providerNote } from "../../../modules/emails/lib/provider-status"
import { listTemplates } from "../../../modules/emails/lib/registry"
import { applyBrandOverrides, BRAND_FIELDS, templateState } from "../../../modules/emails/lib/settings"
import type { Counts, StatRow } from "../../../modules/emails/lib/store"
import { demoSeedState } from "../../../workflows/emails/demo"
import { LATEST_TEMPLATES } from "../../../workflows/emails/preview"
import { actorNames, adminResetLink, emailsService, resolveOptional, settingsForDisplay, storeFor, type Scope } from "../../../workflows/emails/runtime"

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

/**
 * An unexpected error of a route: a plain sentence for the browser, the
 * details (masked) in the server log. Never an SQL text or a stack.
 */
export function serverError(req: MedusaRequest, res: MedusaResponse, err: unknown, publicMessage: string, status = 500): void {
  try {
    const svc = emailsService(req.scope)
    svc.getLogger().error(`[emails] ${req.method ?? "GET"} ${String(req.path ?? req.url ?? "").split("?")[0]}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  } catch {
    /* no logger in tests */
  }
  res.status(status).json({ code: "emails_unavailable", message: publicMessage })
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
    case "bounced":
      where.status = "failed"
      where.error_code = "INVALID_RECIPIENT"
      break
  }
  return where
}

const WINDOW_MS: Record<MessageWindow, number> = { "24h": 24 * 3600 * 1000, "7d": 7 * 24 * 3600 * 1000, "30d": 30 * 24 * 3600 * 1000 }

/** The start of a list window (`since=24h|7d|30d`), or null for the whole log. */
export function sinceOf(value: unknown, now: Date = new Date()): Date | null {
  const v = strParam(value) as MessageWindow
  return WINDOW_MS[v] ? new Date(now.getTime() - WINDOW_MS[v]) : null
}

/** Enabled providers of a channel in Medusa's own table, or null when it cannot be read. */
async function channelProviders(scope: Scope, channel: "email" | "feed"): Promise<string[] | null> {
  const pg = resolveOptional<{ raw(sql: string, b?: unknown[]): Promise<{ rows?: Array<{ id: string }> }> }>(scope, ContainerRegistrationKeys.PG_CONNECTION)
  if (!pg) return null
  try {
    const r = await pg.raw(`select "id" from "notification_provider" where "is_enabled" = true and ? = any("channels") order by "id"`, [channel])
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
  const settings = await settingsForDisplay(scope)

  let logReady = true
  let counts: Counts = { sent24h: 0, sent30d: 0, attention30d: 0, tests30d: 0, testsSent30d: 0, skipped30d: 0, refused30d: 0 }
  let stats: Record<string, TemplateDto["stats"]> = {}
  try {
    counts = await store.counts(o.demo, now)
    stats = statsByTemplate(await store.stats(o.demo, new Date(now.getTime() - 30 * 24 * 3600 * 1000)))
    /* A log older than this version (the migrations of 0.2.0 did not run) is "not ready" too: the page asks for db:migrate. */
    logReady = await store.schemaReady()
  } catch {
    logReady = false
  }

  const names = await actorNames(scope, [settings.brandUpdatedBy, ...Object.values(settings.templates).map((t) => t.updatedBy)])
  const templates: TemplateDto[] = listTemplates(o).map((t) => {
    const state = templateState(t.key, t.def.enabledByDefault !== false, o, settings)
    return {
      key: t.key,
      source: t.source === "builtin" ? "builtin" : "app",
      label: localized(t.def.label),
      description: localized(t.def.description),
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
    mode: note?.mode ?? null,
    emailProviders: await channelProviders(scope, "email"),
    feedProviders: await channelProviders(scope, "feed"),
    sameOptions: note ? fingerprintDifferences(note.fingerprint, optionsFingerprint(o)).length === 0 : null,
    differences: note ? fingerprintDifferences(note.fingerprint, optionsFingerprint(o)) : [],
  }

  const overrides = settings.brand ?? {}
  return {
    version: KIT_META.version,
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
    demo: await demoSeedState(scope, now),
    abandonedCart: o.abandonedCart,
    limits: { testsPerUser: TEST_LIMIT_PER_USER, testWindowMinutes: Math.round(TEST_WINDOW_MS / 60000), testsPerHour: TEST_LIMIT_PER_HOUR, passwordResetsPerHour: o.passwordResetsPerHour },
    retentionDays: o.logRetentionDays,
    references: o.references,
    logReady,
  }
}
