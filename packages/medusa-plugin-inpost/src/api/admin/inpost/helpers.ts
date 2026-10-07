import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type InpostModuleService from "../../../modules/inpost/service"
import { GEOWIDGET_URLS, MANAGER_URLS, SYNC_SCHEDULE, WEBTRUCKER_URL } from "../../../modules/inpost/lib/constants"
import type { CheckResult, PanelGroup, ParcelFilter, StatusResponse, WriterDto, WriterKey } from "../../../modules/inpost/lib/contract"
import { groupOf, toEventDto, toParcelDto, toRunDto, toWriterDto, type EventRow, type ParcelRow } from "../../../modules/inpost/lib/dto"
import { describeError, InpostApiError } from "../../../modules/inpost/lib/errors"
import { IN_LOCKER_STATUSES, PRE_LABEL_STATUSES, PROBLEM_STATUSES, RETURNED_STATUSES } from "../../../modules/inpost/lib/statuses"
import { webhookPath } from "../../../modules/inpost/lib/webhook"
import { WRITERS } from "../../../modules/inpost/lib/writers"
import {
  ActionError,
  actorNames,
  getSetting,
  inpostService,
  isInpostProvider,
  isRunning,
  listEvents,
  queryOf,
  settingsOf,
  storeFor,
  writerStates,
  type Scope,
} from "../../../workflows/inpost/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { inpostService, ActionError }

/** The user id of an admin request (who created, who armed). */
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

/** An error as an answer: refusals with their status, ShipX errors masked, anything else 500. */
export function sendError(scope: Scope, res: MedusaResponse, err: unknown): void {
  const svc = inpostService(scope)
  if (err instanceof ActionError) {
    res.status(err.status).json({ code: err.code, message: err.message })
    return
  }
  if (err instanceof InpostApiError) {
    const d = describeError(err)
    res.status(err.status === 404 ? 404 : 502).json({ code: d.code, message: svc.mask(d.message) })
    return
  }
  /* The details (a SQL error, a stack) stay in the server log, masked; the browser gets a plain sentence. */
  svc.getLogger().error(`[inpost] ${svc.mask((err as Error)?.stack ?? (err as Error)?.message ?? String(err))}`)
  res.status(500).json({ code: "error", message: "Something went wrong on the server; the details are in the server log." })
}

/** The public origin of the backend as the admin reached it (behind a proxy: the forwarded host). */
export function originOf(req: MedusaRequest): string | null {
  const headers = req.headers ?? {}
  const pick = (v: unknown) => (Array.isArray(v) ? v[0] : typeof v === "string" ? v.split(",")[0].trim() : "")
  const host = pick(headers["x-forwarded-host"]) || pick(headers.host)
  if (!host || !/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) return null
  const proto = pick(headers["x-forwarded-proto"]) || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https")
  return `${proto === "http" ? "http" : "https"}://${host}`
}

/** The service filters of a Panel list, in the current mode. */
export function parcelFilters(filter: ParcelFilter, demo: boolean): Record<string, unknown> {
  const where: Record<string, unknown> = { demo }
  const known = [...PRE_LABEL_STATUSES, "confirmed", ...IN_LOCKER_STATUSES, "delivered", ...PROBLEM_STATUSES, ...RETURNED_STATUSES, "canceled"]
  switch (filter) {
    case "all":
      break
    case "to_create":
      where.state = ["pending", "creating", "failed", "unknown"]
      break
    case "waiting":
      where.state = "created"
      where.$or = [{ status: [...PRE_LABEL_STATUSES, "confirmed"] }, { status: null }]
      break
    case "in_transit":
      where.state = "created"
      where.status = { $nin: known }
      break
    case "in_locker":
      where.state = "created"
      where.status = [...IN_LOCKER_STATUSES]
      break
    case "delivered":
      where.state = "created"
      where.status = "delivered"
      break
    case "problems":
      where.state = "created"
      where.status = [...PROBLEM_STATUSES, ...RETURNED_STATUSES]
      break
    case "canceled":
      where.state = "canceled"
      break
    case "skipped":
      where.state = "skipped"
      break
  }
  return where
}

export const FILTERS: readonly ParcelFilter[] = ["all", "to_create", "waiting", "in_transit", "in_locker", "delivered", "problems", "canceled", "skipped"]

export function isFilter(v: unknown): v is ParcelFilter {
  return typeof v === "string" && (FILTERS as readonly string[]).includes(v)
}

/** A search over the list: the order number, the shipment, the tracking number, the locker, the reference. */
export function searchFilter(q: string): Record<string, unknown> | null {
  const s = q.trim().replace(/^#/, "")
  if (!s) return null
  const or: Array<Record<string, unknown>> = [
    { tracking_number: { $ilike: like(s) } },
    { shipment_id: { $ilike: like(s) } },
    { locker_code: { $ilike: like(s.toUpperCase()) } },
    { reference: { $ilike: like(s) } },
    { order_id: s },
  ]
  if (/^\d{1,9}$/.test(s)) or.push({ display_id: Number(s) })
  return { $or: or }
}

export async function writersDto(scope: Scope): Promise<Record<WriterKey, WriterDto>> {
  const svc = inpostService(scope)
  const states = await writerStates(svc)
  const names = await actorNames(scope, WRITERS.map((w) => states[w].updatedBy))
  const out = {} as Record<WriterKey, WriterDto>
  for (const w of WRITERS) out[w] = toWriterDto(states[w], names)
  return out
}

export function parcelDtos(rows: ParcelRow[]) {
  return rows.map((r) => toParcelDto(r))
}

/** Runs an action on one shipment and answers `{ parcel }`, or the refusal. */
export async function respondParcel(req: MedusaRequest, res: MedusaResponse, run: () => Promise<ParcelRow>, message?: string): Promise<void> {
  try {
    const row = await run()
    res.json({ parcel: toParcelDto(row), ...(message ? { message } : {}) })
  } catch (err) {
    sendError(req.scope, res, err)
  }
}

/** The JSON body of a request, or an empty object. */
export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

export async function eventDtos(scope: Scope, rows: EventRow[]) {
  const names = await actorNames(scope, rows.map((r) => r.actor))
  return rows.map((r) => ({ ...toEventDto(r), actor: r.actor ? (names[r.actor] ?? r.actor) : null }))
}

/* ------------------------------------------------------------------ */
/* The last connection check (per process, for the admin)              */
/* ------------------------------------------------------------------ */

const CHECK_KEY = Symbol.for("koda.inpost.lastCheck")
type CheckHolder = typeof globalThis & { [CHECK_KEY]?: CheckResult }

export function rememberCheck(result: CheckResult): void {
  ;(globalThis as CheckHolder)[CHECK_KEY] = result
}

export function lastCheck(mode: "demo" | "live"): CheckResult | null {
  const result = (globalThis as CheckHolder)[CHECK_KEY] ?? null
  return result && result.mode === mode ? result : null
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to ShipX
 * and not a single write while rendering. Demo mode builds its sample
 * shipments through POST /admin/inpost/demo/seed (the page asks for it) and
 * in the status pass.
 */
export async function buildStatus(req: MedusaRequest): Promise<StatusResponse> {
  const scope = req.scope
  const svc: InpostModuleService = inpostService(scope)
  const o = svc.getOptions()
  const demo = o.demo

  const counts: StatusResponse["counts"] = { to_create: 0, waiting: 0, in_transit: 0, in_locker: 0, delivered: 0, problems: 0, all: 0, canceled: 0, skipped: 0, attention: 0 }
  for (const c of await storeFor(scope).counts(demo)) {
    const group = groupOf(c.state, c.status)
    counts.all += c.count
    if (group in counts) counts[group as PanelGroup | "canceled" | "skipped"] += c.count
    if (c.state === "failed" || c.state === "unknown") counts.attention += c.count
  }

  const settings = await settingsOf(svc)
  let shippingOptions: StatusResponse["shippingOptions"] = null
  try {
    const { data } = await queryOf(scope).graph({ entity: "shipping_option", fields: ["id", "name", "provider_id", "data"] })
    shippingOptions = (data as Array<{ id: string; name?: string | null; provider_id?: string | null; data?: Record<string, unknown> | null }>)
      .filter((o) => isInpostProvider(o.provider_id))
      .slice(0, 50)
      .map((o) => ({ id: o.id, name: o.name ?? o.id, optionId: typeof o.data?.id === "string" ? o.data.id : null }))
  } catch {
    shippingOptions = null
  }
  const [lastRunRow] = await listEvents(svc, { kind: "run", demo }, { take: 1, order: { occurred_at: "DESC" } })
  const webhookLast = await getSetting(svc, "webhook:last")
  const last = (webhookLast?.value ?? null) as { at?: string; event?: string } | null
  const origin = originOf(req)
  const path = webhookPath(o.webhookSecret)

  return {
    mode: demo ? "demo" : "live",
    demoReason: o.demoReason,
    sandbox: o.sandbox,
    configured: svc.isConfigured(),
    missing: svc.missingOptions(),
    problems: o.problems,
    tokenSet: Boolean(o.apiToken),
    organizationId: o.organizationId || null,
    counts,
    writers: await writersDto(scope),
    autoCreate: o.autoCreate,
    settings: {
      sender: settings.sender,
      senderSent: settings.senderSent,
      senderAddress: settings.senderAddress,
      defaultParcelSize: settings.defaultParcelSize,
      labelFormat: settings.labelFormat,
      source: settings.source,
    },
    options: {
      sendingMethod: { locker: o.sendingMethod.locker, courier: o.sendingMethod.courier },
      dropoffPoint: o.dropoffPoint,
      referenceTemplate: o.referenceTemplate,
      weightUnit: o.weightUnit,
      defaultWeightKg: o.defaultWeightKg,
      skipMetadataKeys: o.skipMetadataKeys,
      verifyLockers: o.verifyLockers,
      pollEnabled: o.pollEnabled,
      pollMaxAgeDays: o.pollMaxAgeDays,
      requestsPerMinute: o.requestsPerMinute,
    },
    webhook: {
      enabled: Boolean(path),
      invalid: o.webhookSecretInvalid,
      url: !demo && path && origin ? `${origin}${path}` : null,
      lastAt: !demo ? (last?.at ?? null) : null,
      lastEvent: !demo ? (last?.event ?? null) : null,
    },
    links: {
      manager: o.sandbox ? MANAGER_URLS.sandbox : MANAGER_URLS.production,
      webtrucker: WEBTRUCKER_URL,
      geowidget: o.sandbox ? GEOWIDGET_URLS.sandbox : GEOWIDGET_URLS.production,
    },
    shippingOptions,
    lastRun: lastRunRow ? toRunDto(lastRunRow) : null,
    lastCheck: lastCheck(demo ? "demo" : "live"),
    running: isRunning("sync"),
    schedule: SYNC_SCHEDULE,
    references: o.references,
  }
}
